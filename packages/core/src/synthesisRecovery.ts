import { captureAuthSessionScope, subscribeAuthSessionScope, type AuthSessionScope } from './authLifecycle.ts';
import { SYNTHESIS_CONFIG } from './rewards.ts';
import type { RepositoryStorage } from './syncRepository.ts';

export const synthesisRecoveryKey = (owner: string) => `life-quest:cloud:${owner}:synthesis:v1`;

export interface SavedSynthesis {
    version: 1;
    userId: string;
    key: string;
    itemIds: readonly string[];
}

type RecoveryStatus = 'inactive' | 'loading' | 'ready' | 'unreadable' | 'unavailable';
export interface SynthesisRecoveryState {
    userId: string | null;
    status: RecoveryStatus;
    pending: SavedSynthesis | null;
}

const inactive: SynthesisRecoveryState = { userId: null, status: 'inactive', pending: null };
const failure = () => new Error('合成の保存状態を確認できません。');
const validId = (value: unknown): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= 200 && value === value.trim();

function normalizeIngredients(ids: unknown): string[] {
    if (!Array.isArray(ids) || ids.length !== SYNTHESIS_CONFIG.REQUIRED_COUNT) throw failure();
    const items = Array.from(ids);
    if (!items.every(validId) || new Set(items).size !== items.length) throw failure();
    return items;
}

function decode(raw: string, userId: string): SavedSynthesis {
    if (raw.length > 4096) throw failure();
    const value = JSON.parse(raw) as Partial<SavedSynthesis> | null;
    if (!value || value.version !== 1 || value.userId !== userId || !validId(value.key)) throw failure();
    return Object.freeze({ version: 1, userId, key: value.key, itemIds: Object.freeze(normalizeIngredients(value.itemIds)) });
}

function sameIngredients(a: readonly string[], b: readonly string[]) {
    return a.length === b.length && a.every((id) => b.includes(id));
}

export function createSynthesisRecovery(deps: {
    storage: RepositoryStorage;
    withLock?: <T>(userId: string, work: () => Promise<T>) => Promise<T>;
}) {
    let snapshot = inactive;
    let loadRevision = 0;
    const listeners = new Set<() => void>();
    const tails = new Map<string, Promise<unknown>>();
    const retired = new Set<string>();
    const savedRaw = new WeakMap<SynthesisRecoveryState, string>();
    const publish = (next: SynthesisRecoveryState, raw?: string) => {
        if (raw !== undefined) savedRaw.set(next, raw);
        snapshot = next;
        listeners.forEach((listener) => listener());
    };
    const allowed = (scope: AuthSessionScope, userId: string) =>
        scope.userId === userId && scope.isCurrent() && !retired.has(userId);
    const assert = (scope: AuthSessionScope, userId: string) => {
        if (!allowed(scope, userId)) throw failure();
    };
    function queue<T>(userId: string, work: () => Promise<T>): Promise<T> {
        const result = (tails.get(userId) ?? Promise.resolve()).catch(() => {}).then(work);
        tails.set(userId, result);
        void result.finally(() => { if (tails.get(userId) === result) tails.delete(userId); }).catch(() => {});
        return result;
    }
    const transact = <T>(userId: string, work: () => Promise<T>) =>
        queue(userId, () => deps.withLock ? deps.withLock(userId, work) : work());
    const read = (userId: string) => deps.storage.getItem(synthesisRecoveryKey(userId));
    function showStored(userId: string, raw: string | null) {
        let pending: SavedSynthesis | null = null;
        if (raw !== null) {
            try { pending = decode(raw, userId); }
            catch { publish({ userId, status: 'unreadable', pending: null }, raw); return null; }
        }
        publish({ userId, status: 'ready', pending }, raw ?? undefined);
        return pending;
    }
    async function load() {
        const scope = captureAuthSessionScope();
        const { userId } = scope;
        const revision = ++loadRevision;
        if (!userId || retired.has(userId)) { publish(inactive); return; }
        // Preserve the existing button during a same-owner storage refresh.
        if (snapshot.userId !== userId || snapshot.status === 'inactive') publish({ userId, status: 'loading', pending: null });
        try {
            await queue(userId, async () => {
                assert(scope, userId);
                const raw = await read(userId);
                if (allowed(scope, userId) && revision === loadRevision) showStored(userId, raw);
            });
        } catch {
            if (allowed(scope, userId) && revision === loadRevision) publish({ userId, status: 'unavailable', pending: null });
        }
    }
    return {
        getState: () => snapshot.userId === captureAuthSessionScope().userId ? snapshot : inactive,
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        load,
        register: () => {
            const stop = subscribeAuthSessionScope(() => { publish(inactive); void load(); });
            void load();
            return () => { stop(); loadRevision += 1; publish(inactive); };
        },
        prepare: (userId: string, itemIds: readonly string[], createKey: () => string, retry?: SavedSynthesis) => {
            const scope = captureAuthSessionScope();
            return transact(userId, async () => {
                assert(scope, userId);
                const normalized = normalizeIngredients(itemIds);
                const raw = await read(userId);
                assert(scope, userId);
                if (raw !== null) {
                    const existing = showStored(userId, raw);
                    if (!existing || !sameIngredients(existing.itemIds, normalized)
                        || (retry && (retry.userId !== userId || retry.key !== existing.key))) throw failure();
                    return { record: existing, fresh: false };
                }
                if (retry) { showStored(userId, null); throw failure(); }
                const key = createKey();
                if (!validId(key)) throw failure();
                const record: SavedSynthesis = { version: 1, userId, key, itemIds: normalized };
                const serialized = JSON.stringify(record);
                const verified = decode(serialized, userId);
                await deps.storage.setItem(synthesisRecoveryKey(userId), serialized);
                assert(scope, userId);
                publish({ userId, status: 'ready', pending: verified }, serialized);
                return { record: verified, fresh: true };
            });
        },
        acknowledge: (record: SavedSynthesis, scope: AuthSessionScope) => {
            const { userId } = record;
            return transact(userId, async () => {
                assert(scope, userId);
                const raw = await read(userId);
                assert(scope, userId);
                const current = raw === null ? null : decode(raw, userId);
                if (!current || current.key !== record.key || !sameIngredients(current.itemIds, record.itemIds)) {
                    showStored(userId, raw);
                    return false;
                }
                await deps.storage.removeItem(synthesisRecoveryKey(userId));
                assert(scope, userId);
                showStored(userId, null);
                return true;
            });
        },
        discard: async (expected: SynthesisRecoveryState, scope: AuthSessionScope) => {
            const { userId } = scope;
            const expectedRaw = savedRaw.get(expected);
            if (!userId || expected.userId !== userId || expected !== snapshot || expectedRaw === undefined || !allowed(scope, userId)) return false;
            return transact(userId, async () => {
                assert(scope, userId);
                const raw = await read(userId);
                assert(scope, userId);
                if (raw !== expectedRaw || expected !== snapshot) { showStored(userId, raw); return false; }
                await deps.storage.removeItem(synthesisRecoveryKey(userId));
                assert(scope, userId);
                showStored(userId, null);
                return true;
            });
        },
        retire: async (userId: string) => {
            retired.add(userId);
            if (snapshot.userId === userId) { loadRevision += 1; publish(inactive); }
            await queue(userId, async () => {});
        },
    };
}
