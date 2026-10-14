import { getGameRewardAuthorityState, subscribeGameRewardAuthority } from '@life-quest/core/gameRewardAuthority';
import { applyCharacterXp } from '@life-quest/core/progression';
import { CANONICAL_STORAGE_KEYS } from '@life-quest/core/syncRepository';
import { createJSONStorage, type PersistStorage } from 'zustand/middleware';
import { getWebLocalStorage } from './storage';

export const COMPLETION_REWARD_LOCK = 'life-quest:anonymous-completion-rewards';
let authorityGeneration = 0;
let replacingGameStorageScope: 'anonymous' | 'cloud' | undefined;
subscribeGameRewardAuthority(() => { authorityGeneration += 1; });
export const getCompletionRewardGeneration = () => authorityGeneration;

/** Explicit logout/reset is not a stale-tab write and must not resurrect receipts. */
export function resetCompletionRewardStorage<T>(work: () => T): T {
    return replaceCompletionRewardStorage('anonymous', work);
}

/** A confirmed cloud seed replaces account-local receipts, not a stale anonymous write. */
export function seedCloudCompletionRewardStorage<T>(work: () => T): T {
    return replaceCompletionRewardStorage('cloud', work);
}

function replaceCompletionRewardStorage<T>(scope: 'anonymous' | 'cloud', work: () => T): T {
    const previousScope = replacingGameStorageScope;
    replacingGameStorageScope = scope;
    try { return work(); } finally { replacingGameStorageScope = previousScope; }
}

export function sanitizeCompletionRewardKeys(value: unknown): string[] {
    return Array.isArray(value) ? [...new Set(value.filter((key): key is string =>
        typeof key === 'string' && /^(task|subtask):.+$/.test(key) && key.length <= 256))] : [];
}

export function completionKeysToLedger(keys: readonly string[], habitBonusDates: string[] = []) {
    return {
        rewardedTaskIds: keys.filter((key) => key.startsWith('task:')).map((key) => key.slice(5)),
        rewardedSubtaskIds: keys.filter((key) => key.startsWith('subtask:')).map((key) => key.slice(8)),
        habitBonusDates,
    };
}

export function completionLedgerToKeys(ledger: { rewardedTaskIds: string[]; rewardedSubtaskIds: string[] }) {
    return [...ledger.rewardedTaskIds.map((id) => `task:${id}`), ...ledger.rewardedSubtaskIds.map((id) => `subtask:${id}`)];
}

/** Preserve canonical evidence and completed legacy work without recalculating XP. */
export function readLegacyCompletionRewardKeys(): string[] {
    const storage = getWebLocalStorage();
    if (!storage) return [];
    const raw = storage.getItem('quest-board-tasks');
    const tasks = raw ? JSON.parse(raw)?.state?.tasks : [];
    if (!Array.isArray(tasks)) throw new Error('旧タスク保存データを確認できません。');
    let canonicalKeys: string[] = [];
    const canonical = storage.getItem(CANONICAL_STORAGE_KEYS.game);
    if (canonical) {
        try {
            const envelope = JSON.parse(canonical);
            const ledger = envelope?.data?.rewardLedger;
            if (envelope?.repositoryVersion === 1 && envelope?.data?.schemaVersion === 1
                && Array.isArray(ledger?.rewardedTaskIds) && Array.isArray(ledger?.rewardedSubtaskIds)) {
                canonicalKeys = completionLedgerToKeys(ledger);
            }
        } catch { /* corrupt canonical data is not evidence; preserve its source */ }
    }
    return sanitizeCompletionRewardKeys([...canonicalKeys, ...tasks.flatMap((task) => [
        ...(task?.completed === true && typeof task.id === 'string' ? [`task:${task.id}`] : []),
        ...(Array.isArray(task?.subtasks) ? task.subtasks.flatMap((subtask: { id?: unknown; completed?: unknown }) =>
            subtask?.completed === true && typeof subtask.id === 'string' ? [`subtask:${subtask.id}`] : []) : []),
    ])]);
}

export function withCompletionRewardLock<T>(work: () => T): Promise<T> {
    if (typeof navigator === 'undefined' || !navigator.locks?.request) {
        return Promise.reject(new Error('安全に報酬を保存できません。Web Locks対応ブラウザーで再度お試しください。'));
    }
    return navigator.locks.request(COMPLETION_REWARD_LOCK, work);
}

interface RewardPersistence {
    completionRewardScope?: 'anonymous' | 'cloud';
    completionRewardKeys: string[];
    character: Parameters<typeof applyCharacterXp>[0];
    gachaCount: number;
    chestQueue: Array<{ id: string; opened: boolean }>;
}

/** A stale anonymous tab must never overwrite receipts committed by another tab. */
export function createRewardAwareGameStorage<S extends RewardPersistence>(): PersistStorage<S> | undefined {
    return createJSONStorage<S>(() => ({
        getItem: (key) => getWebLocalStorage()?.getItem(key) ?? null,
        removeItem: (key) => getWebLocalStorage()?.removeItem(key),
        setItem: (key, value) => {
            const storage = getWebLocalStorage();
            if (!storage) throw new Error('保存領域を利用できません。');
            if (replacingGameStorageScope) {
                const reset = JSON.parse(value);
                reset.state.completionRewardScope = replacingGameStorageScope;
                storage.setItem(key, JSON.stringify(reset));
                return;
            }
            if (getGameRewardAuthorityState() === 'resolving') {
                // Startup may persist before INITIAL_SESSION. Do not label an
                // anonymous save as cloud-owned just because auth is unresolved.
                const previous = storage.getItem(key);
                const next = JSON.parse(value);
                next.state.completionRewardScope = previous && JSON.parse(previous)?.state?.completionRewardScope === 'cloud'
                    ? 'cloud' : 'anonymous';
                value = JSON.stringify(next);
            }
            if (getGameRewardAuthorityState() === 'anonymous') {
                const previous = storage.getItem(key);
                if (previous) {
                    const disk = JSON.parse(previous)?.state as S | undefined;
                    if (!disk || typeof disk !== 'object' || Array.isArray(disk)) {
                        throw new Error('ゲーム保存データを確認できません。');
                    }
                    if (Object.prototype.hasOwnProperty.call(disk, 'completionRewardKeys') && !Array.isArray(disk.completionRewardKeys)) {
                        throw new Error('報酬台帳を確認できません。');
                    }
                    if (disk.completionRewardScope === 'cloud') {
                        throw new Error('クラウド用保存状態へ匿名の変更を上書きできません。再読み込みしてください。');
                    }
                    const next = JSON.parse(value) as { state: S; version: number };
                    const diskKeys = sanitizeCompletionRewardKeys(disk?.completionRewardKeys);
                    const incomingKeys = new Set(next.state.completionRewardKeys);
                    if (diskKeys.some((claim) => !incomingKeys.has(claim))) {
                        next.state.completionRewardKeys = [...new Set([...diskKeys, ...next.state.completionRewardKeys])];
                        // Preserve the newer reward balance when a stale profile/UI write arrives.
                        if (disk && disk.character.totalXp > next.state.character.totalXp) {
                            next.state.character = { ...next.state.character,
                                ...applyCharacterXp(next.state.character, disk.character.totalXp - next.state.character.totalXp).character };
                        }
                        next.state.gachaCount = Math.max(next.state.gachaCount, disk?.gachaCount ?? 0);
                        const chests = new Map(next.state.chestQueue.map((chest) => [chest.id, chest]));
                        for (const chest of disk?.chestQueue ?? []) {
                            if (!chests.has(chest.id) || chest.opened) chests.set(chest.id, chest);
                        }
                        next.state.chestQueue = [...chests.values()];
                        value = JSON.stringify(next);
                    }
                }
            }
            storage.setItem(key, value);
        },
    }));
}

export function registerCompletionRewardStorageSync(rehydrate: () => void | Promise<void>): () => void {
    const handle = (event: StorageEvent) => {
        if (event.key === 'quest-board-game' && getGameRewardAuthorityState() === 'anonymous' && event.newValue) {
            try {
                // Do not hydrate another tab's signed-in cache into anonymous UI.
                if (JSON.parse(event.newValue)?.state?.completionRewardScope === 'anonymous') {
                    void Promise.resolve(rehydrate()).catch(() => undefined);
                }
            } catch { /* malformed/foreign events are not a seed source */ }
        }
    };
    window.addEventListener('storage', handle);
    return () => window.removeEventListener('storage', handle);
}
