import { captureAuthSessionScope, subscribeAuthSessionScope, type AuthSessionScope } from './authLifecycle.ts';
import { BATTLE_REPLAY_MAX_ACTIONS, type BattleAction } from './battle.ts';
import type { RepositoryStorage } from './syncRepository.ts';
import type { CloudCache } from './cloudCache.ts';
import type { ResolveBattleAttemptResponse } from './gameCloud.ts';

export const battleResultRecoveryKey = (userId: string) => `life-quest:cloud:${userId}:battle-result:v1`;
export interface SavedBattleResult {
    version: 1; userId: string; attemptId: string; key: string; actions: readonly BattleAction[];
}
export interface BattleResultRecoveryState {
    userId: string | null;
    phase: 'inactive' | 'loading' | 'ready' | 'sending' | 'failed' | 'blocked';
    pending: SavedBattleResult | null;
}
const inactive: BattleResultRecoveryState = Object.freeze({ userId: null, phase: 'inactive', pending: null });
export const blocksBattleStart = (state: BattleResultRecoveryState) => state.phase !== 'inactive' && (state.phase !== 'ready' || state.pending !== null);
export function isBattleResultAcknowledgement(value: unknown): value is ResolveBattleAttemptResponse {
    if (typeof value !== 'object' || value === null) return false;
    const { outcome, granted } = value as Partial<ResolveBattleAttemptResponse>;
    return (outcome === 'victory' || outcome === 'defeat') && typeof granted === 'boolean';
}
const failure = () => new Error('戦闘結果の保存状態を確認できません。');
class UnreadableBattleResult extends Error {
    constructor(readonly raw: string) { super('保存した戦闘結果を読み込めません。'); }
}
const token = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value;
/** Never truncate or filter an action sequence: an invalid record remains on disk. */
export function decodeSavedBattleResult(raw: string, userId: string): SavedBattleResult {
    if (raw.length > 256 * 1024) throw failure();
    let value;
    try { value = JSON.parse(raw); } catch { throw failure(); }
    if (!value || Array.isArray(value) || value.version !== 1 || value.userId !== userId
        || !token(value.userId) || !token(value.attemptId) || !token(value.key)
        || !Array.isArray(value.actions) || value.actions.length === 0 || value.actions.length > BATTLE_REPLAY_MAX_ACTIONS) throw failure();
    const actions: BattleAction[] = value.actions.map((action: unknown) => {
        if (typeof action !== 'object' || action === null || Array.isArray(action)) throw failure();
        const item = action as Record<string, unknown>;
        if (item.type === 'attack') return Object.freeze({ type: 'attack' as const });
        if (item.type === 'skill' && token(item.skillId)) return Object.freeze({ type: 'skill' as const, skillId: item.skillId });
        throw failure();
    });
    return Object.freeze({ version: 1, userId, attemptId: value.attemptId, key: value.key, actions: Object.freeze(actions) });
}

export function createBattleResultRecovery(deps: {
    storage: RepositoryStorage;
    send: (record: SavedBattleResult, isActive: () => boolean) => Promise<ResolveBattleAttemptResponse>;
    onResolved?: () => Promise<unknown>;
    withLock?: <T>(userId: string, work: () => Promise<T>) => Promise<T>;
}) {
    let state = inactive;
    const getState = () => state.userId === captureAuthSessionScope().userId ? state : inactive;
    const listeners = new Set<() => void>();
    const queues = new Map<string, Promise<unknown>>();
    const retired = new Set<string>();
    const sending = new Map<string, object>();
    const unreadable = new WeakMap<BattleResultRecoveryState, string>();
    let readGeneration = 0;
    const publish = (next: BattleResultRecoveryState) => { state = next; listeners.forEach((fn) => fn()); };
    const allowed = (scope: AuthSessionScope, userId: string) => scope.userId === userId && scope.isCurrent() && !retired.has(userId);
    const assert = (scope: AuthSessionScope, userId: string) => { if (!allowed(scope, userId)) throw failure(); };
    function serial<T>(userId: string, work: () => Promise<T>): Promise<T> {
        const next = (queues.get(userId) ?? Promise.resolve()).catch(() => {}).then(work);
        queues.set(userId, next);
        void next.finally(() => { if (queues.get(userId) === next) queues.delete(userId); }).catch(() => {});
        return next;
    }
    const transact = <T>(userId: string, work: () => Promise<T>) => serial(userId, () => deps.withLock ? deps.withLock(userId, work) : work());
    async function read(userId: string) {
        const raw = await deps.storage.getItem(battleResultRecoveryKey(userId));
        if (raw === null) return null;
        try { return decodeSavedBattleResult(raw, userId); }
        catch { throw new UnreadableBattleResult(raw); }
    }
    function publishBlocked(userId: string, error: unknown) {
        const blocked: BattleResultRecoveryState = { userId, phase: 'blocked', pending: null };
        if (error instanceof UnreadableBattleResult) unreadable.set(blocked, error.raw);
        publish(blocked);
    }
    async function load() {
        const scope = captureAuthSessionScope(); const userId = scope.userId; const generation = ++readGeneration;
        if (!userId || retired.has(userId)) { publish(inactive); return; }
        if (state.phase !== 'sending' || state.userId !== userId) publish({ userId, phase: 'loading', pending: null });
        try {
            await serial(userId, async () => {
                assert(scope, userId); const pending = await read(userId);
                if (allowed(scope, userId) && generation === readGeneration) {
                    if (state.phase === 'sending' && pending?.key === state.pending?.key
                        && pending?.attemptId === state.pending?.attemptId) return;
                    publish({ userId, phase: 'ready', pending });
                }
            });
        } catch (error) {
            if (allowed(scope, userId) && generation === readGeneration) publishBlocked(userId, error);
        }
    }
    async function acknowledge(record: SavedBattleResult, scope = captureAuthSessionScope()) {
        return transact(record.userId, async () => {
            assert(scope, record.userId); const saved = await read(record.userId); assert(scope, record.userId);
            if (saved && (saved.key !== record.key || saved.attemptId !== record.attemptId)) throw failure();
            if (saved) await deps.storage.removeItem(battleResultRecoveryKey(record.userId));
            if (allowed(scope, record.userId)) publish({ userId: record.userId, phase: 'ready', pending: null });
        });
    }
    return {
        getState,
        canDiscard: (snapshot: BattleResultRecoveryState) => snapshot.phase !== 'sending'
            && (snapshot.pending !== null || unreadable.has(snapshot)),
        discard: async (snapshot: BattleResultRecoveryState): Promise<boolean> => {
            const scope = captureAuthSessionScope();
            const userId = scope.userId;
            if (!userId || snapshot.userId !== userId || state !== snapshot || sending.has(userId) || !allowed(scope, userId)) return false;
            try {
                return await transact(userId, async () => {
                    assert(scope, userId);
                    const key = battleResultRecoveryKey(userId);
                    const raw = await deps.storage.getItem(key);
                    assert(scope, userId);
                    if (state !== snapshot || sending.has(userId)) return false;
                    if (raw !== null) {
                        if (snapshot.pending) {
                            if (JSON.stringify(decodeSavedBattleResult(raw, userId)) !== JSON.stringify(snapshot.pending)) return false;
                        } else if (unreadable.get(snapshot) !== raw) {
                            return false;
                        }
                        await deps.storage.removeItem(key);
                    }
                    if (allowed(scope, userId)) publish({ userId, phase: 'ready', pending: null });
                    return true;
                });
            } catch { return false; }
        },
        subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
        isBlocking: () => blocksBattleStart(getState()),
        load,
        register: () => {
            const off = subscribeAuthSessionScope(() => { sending.clear(); void load(); }); void load();
            return () => { off(); readGeneration += 1; sending.clear(); publish(inactive); };
        },
        prepare: async (userId: string, packet: { attemptId: string; key: string; actions: readonly BattleAction[] }) => {
            const scope = captureAuthSessionScope();
            return transact(userId, async () => {
                assert(scope, userId); const saved = await read(userId); assert(scope, userId);
                if (saved && saved.attemptId !== packet.attemptId) {
                    publish({ userId, phase: 'ready', pending: saved });
                    throw failure();
                }
                const record = saved ?? decodeSavedBattleResult(JSON.stringify({ ...packet, version: 1, userId }), userId);
                await deps.storage.setItem(battleResultRecoveryKey(userId), JSON.stringify(record));
                assert(scope, userId); publish({ userId, phase: 'ready', pending: record }); return record;
            });
        },
        acknowledge,
        reconcile: async (cache: CloudCache, scope: AuthSessionScope, liveAttemptId?: string) => {
            const userId = scope.userId;
            if (!userId || !allowed(scope, userId)) return;
            // A canonical pull may arrive before the account's saved result has loaded.
            if (!liveAttemptId && state.userId === userId && state.phase === 'ready' && !state.pending) return;
            const confirmed = (id: string) => {
                const row = cache.battle_attempts[id];
                return Boolean(row && row.id === id && row.user_id === userId && row.status === 'resolved' && row.deleted_at == null
                    && (row.outcome === 'victory' || row.outcome === 'defeat') && Number.isSafeInteger(row.version) && Number(row.version) > 0);
            };
            await transact(userId, async () => {
                assert(scope, userId);
                const saved = await read(userId);
                assert(scope, userId);
                if (!saved || !confirmed(saved.attemptId)) return;
                await deps.storage.removeItem(battleResultRecoveryKey(userId));
                if (allowed(scope, userId)) publish({ userId, phase: 'ready', pending: null });
            });
        },
        retry: async (requested: SavedBattleResult) => {
            const scope = captureAuthSessionScope(); const userId = scope.userId;
            if (!userId || userId !== requested.userId || state.pending !== requested || sending.has(userId) || !allowed(scope, userId)) return;
            const operation = {}; sending.set(userId, operation);
            const active = () => allowed(scope, userId) && sending.get(userId) === operation;
            let sent: SavedBattleResult | null = null;
            try {
                const record = await serial(userId, async () => { assert(scope, userId); return read(userId); });
                if (!active()) return;
                if (!record || record.key !== requested.key || record.attemptId !== requested.attemptId) { await load(); return; }
                sent = record;
                publish({ userId, phase: 'sending', pending: record });
                const response = await deps.send(record, active);
                if (!active()) return;
                if (!isBattleResultAcknowledgement(response)) throw failure();
                await acknowledge(record, scope);
                if (active()) { try { await deps.onResolved?.(); } catch { /* Normal sync will retry receipt delivery. */ } }
            } catch (error) {
                if (!active()) return;
                if (!sent) {
                    publishBlocked(userId, error);
                } else if (state.pending?.key === sent.key && state.pending.attemptId === sent.attemptId) {
                    publish({ ...state, phase: 'failed' });
                }
            }
            finally { if (sending.get(userId) === operation) sending.delete(userId); }
        },
        /** Stop future writes first, then wait for already-started saves before account cleanup removes the key. */
        retire: async (userId: string) => {
            retired.add(userId); sending.delete(userId);
            if (state.userId === userId) { readGeneration += 1; publish(inactive); }
            await serial(userId, async () => {});
        },
    };
}
