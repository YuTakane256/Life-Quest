import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { useGameStore, sanitizeGameStoreState, syncAnonymousGameFromStorage } from './useGameStore';
import { flushCompletionRewardWrites, getCompletionRewardGeneration, registerCompletionRewardStorageSync, resetCompletionRewardStorage, withoutCompletionRewardPersistence, withSettledGamePersistence, COMPLETION_REWARD_LOCK } from '../platform/completionRewards';
import { exportAllData, importAllData } from '../utils/dataBackup';
import { CANONICAL_STORAGE_KEYS } from '@life-quest/core/syncRepository';
import { seedGame } from '../platform/canonicalSync';
import { convertLegacyGameSnapshot } from '@life-quest/core/syncSnapshots';

function locks() {
    let tail = Promise.resolve();
    return { request: vi.fn((_name, work) => {
        const result = tail.then(work);
        tail = result.then(() => undefined, () => undefined);
        return result;
    }) };
}
const grant = (key: string, xp = 20) => useGameStore.getState().grantCompletionReward(key, xp, getCompletionRewardGeneration());
const disk = () => JSON.parse(localStorage.getItem('quest-board-game')!).state;

beforeEach(async () => {
    await flushCompletionRewardWrites();
    vi.stubGlobal('navigator', { locks: locks() });
    setGameRewardAuthorityState('anonymous');
    localStorage.clear();
    resetCompletionRewardStorage(() => useGameStore.setState({
        ...sanitizeGameStoreState(undefined), completionRewardError: null, levelUpEvent: null, pendingChestReveal: null,
    }));
    await flushCompletionRewardWrites();
});
afterEach(async () => { await flushCompletionRewardWrites(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('anonymous completion receipts and reward balance', () => {
    it('does not discard an ongoing battle snapshot/actions when a delayed task reward arrives', async () => {
        useGameStore.setState({ battle: { ...useGameStore.getState().battle, battleUnlocked: true } });
        useGameStore.getState().startBattle(1);
        useGameStore.getState().processBattleTurn();
        await flushCompletionRewardWrites();
        const battle = useGameStore.getState().battle;
        expect(battle.status).toBe('fighting');
        expect(await grant('task:during-battle')).toBe(true);
        expect(useGameStore.getState().battle).toBe(battle);
        expect(disk().battle.playerSnapshot).toEqual(battle.playerSnapshot);
        expect(disk().battle.actions).toEqual(battle.actions);
        useGameStore.getState().processBattleTurn();
        expect(useGameStore.getState().battle.actions).toHaveLength(battle.actions.length + 1);
    });

    it('refreshes another anonymous tab receipt without clearing live battle or reveal state', async () => {
        useGameStore.setState({ battle: { ...useGameStore.getState().battle, battleUnlocked: true } });
        useGameStore.getState().startBattle(1);
        await flushCompletionRewardWrites();
        const snapshot = useGameStore.getState().battle.playerSnapshot;
        const stop = registerCompletionRewardStorageSync(syncAnonymousGameFromStorage);
        try {
            const foreign = JSON.stringify({ state: { ...disk(), completionRewardKeys: ['task:other-tab'], character: { ...disk().character, totalXp: 20 } }, version: 0 });
            localStorage.setItem('quest-board-game', foreign);
            window.dispatchEvent(new StorageEvent('storage', { key: 'quest-board-game', newValue: foreign }));
            expect(useGameStore.getState().completionRewardKeys).toEqual(['task:other-tab']);
            expect(useGameStore.getState().battle.playerSnapshot).toBe(snapshot);
            useGameStore.getState().processBattleTurn();
            expect(useGameStore.getState().battle.actions).toHaveLength(1);
            await flushCompletionRewardWrites();
        } finally { stop(); }
    });
    it('retains local receipts at startup, but replaces them with a confirmed cloud ledger', async () => {
        useGameStore.setState({ completionRewardKeys: ['task:old-local'] });
        await flushCompletionRewardWrites();
        setGameRewardAuthorityState('resolving');
        const snapshot = convertLegacyGameSnapshot({ game: {
            completionRewardKeys: ['task:canonical'],
        } });
        seedGame(snapshot);
        await flushCompletionRewardWrites();
        expect(useGameStore.getState().completionRewardKeys).toEqual(['task:old-local', 'task:canonical']);
        expect(disk().completionRewardScope).toBe('anonymous');
        seedGame(snapshot, 'cloud');
        await flushCompletionRewardWrites();
        expect(useGameStore.getState().completionRewardKeys).toEqual(['task:canonical']);
        expect(disk().completionRewardScope).toBe('cloud');
    });
    it('does not poison an anonymous save while startup auth is resolving', async () => {
        setGameRewardAuthorityState('resolving');
        useGameStore.getState().updateCharacter({ name: 'Before initial session' });
        await flushCompletionRewardWrites();
        expect(disk().completionRewardScope).toBe('anonymous');
        setGameRewardAuthorityState('anonymous');
        expect(await grant('task:A')).toBe(true);
    });

    it('preserves a cloud scope during resolving but clears it on explicit logout reset', async () => {
        setGameRewardAuthorityState('authenticated');
        useGameStore.getState().updateCharacter({ name: 'Cloud account' });
        await flushCompletionRewardWrites();
        setGameRewardAuthorityState('resolving');
        useGameStore.getState().updateCharacter({ name: 'Restoring' });
        await flushCompletionRewardWrites();
        expect(disk().completionRewardScope).toBe('cloud');
        resetCompletionRewardStorage(() => useGameStore.setState(sanitizeGameStoreState(undefined)));
        await flushCompletionRewardWrites();
        expect(disk().completionRewardScope).toBe('anonymous');
    });

    it('only rehydrates anonymous storage events and handles async rehydration failure', async () => {
        const rehydrate = vi.fn().mockRejectedValue(new Error('unavailable'));
        const stop = registerCompletionRewardStorageSync(rehydrate);
        for (const scope of ['cloud', 'anonymous']) window.dispatchEvent(new StorageEvent('storage', {
            key: 'quest-board-game', newValue: JSON.stringify({ state: { completionRewardScope: scope } }),
        }));
        expect(rehydrate).toHaveBeenCalledTimes(1);
        await Promise.resolve();
        stop();
    });
    it('round-trips receipts with the existing backup format', async () => {
        await grant('task:A');
        const backup = exportAllData();
        expect(importAllData(backup)).toBe(true);
        await useGameStore.persist.rehydrate();
        expect(await grant('task:A')).toBe(false);
        expect(useGameStore.getState().character.totalXp).toBe(20);
    });
    it('commits XP/count/receipt once and keeps the receipt after rehydration', async () => {
        expect(await grant('task:A')).toBe(true);
        expect(await grant('task:A')).toBe(false);
        expect(disk()).toMatchObject({ completionRewardKeys: ['task:A'], gachaCount: 1, character: { totalXp: 20 } });
        await useGameStore.persist.rehydrate();
        expect(await grant('task:A')).toBe(false);
        expect(useGameStore.getState().character.totalXp).toBe(20);
    });

    it('keeps task/subtask identities separate and does not create duplicate milestone chests', async () => {
        for (const key of ['task:A', 'subtask:A', 'task:B', 'task:C', 'task:D']) expect(await grant(key)).toBe(true);
        expect(await grant('subtask:A', 10)).toBe(false);
        expect(disk().gachaCount).toBe(5);
        expect(disk().chestQueue).toHaveLength(1);
        expect(disk().chestQueue[0]).toMatchObject({ chestType: 'blue', isStarterCharacter: true });
        expect(disk().character.totalXp).toBe(100);
    });

    it('serializes concurrent claims and reads the latest durable balance inside the lock', async () => {
        expect(await Promise.all([grant('task:A'), grant('task:A'), grant('task:B')])).toEqual([true, false, true]);
        expect(disk()).toMatchObject({ gachaCount: 2, character: { totalXp: 40 } });
    });

    it('does not let a stale tab profile write erase a receipt/balance/chest', async () => {
        const stale = useGameStore.getState();
        for (let i = 0; i < 5; i++) await grant(`task:${i}`);
        useGameStore.setState({ ...stale, character: { ...stale.character, name: 'Stale profile' } });
        await flushCompletionRewardWrites();
        expect(disk()).toMatchObject({ gachaCount: 5, character: { totalXp: 100, name: 'Stale profile' } });
        expect(disk().completionRewardKeys).toHaveLength(5);
        expect(disk().chestQueue).toHaveLength(1);
        expect(await grant('task:0')).toBe(false);
        expect(await grant('task:new')).toBe(true);
        expect(disk().character.totalXp).toBe(120);
    });

    it('retains old receipts beyond the core migration ledger cap', async () => {
        useGameStore.setState({ completionRewardKeys: Array.from({ length: 4001 }, (_, i) => `task:${i}`) });
        await flushCompletionRewardWrites();
        await useGameStore.persist.rehydrate();
        expect(await grant('task:0')).toBe(false);
        expect(useGameStore.getState().completionRewardKeys).toHaveLength(4001);
    });

    it('does not publish XP/receipt if the atomic write fails; retry grants once', async () => {
        const before = localStorage.getItem('quest-board-game');
        const original = Storage.prototype.setItem;
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
            if (key === 'quest-board-game') throw new DOMException('quota', 'QuotaExceededError');
            original.call(this, key, value);
        });
        expect(await grant('task:A')).toBe(false);
        expect(useGameStore.getState()).toMatchObject({ completionRewardKeys: [], gachaCount: 0, character: { totalXp: 0 } });
        expect(localStorage.getItem('quest-board-game')).toBe(before);
        expect(useGameStore.getState().completionRewardError).toContain('未付与');
        vi.restoreAllMocks();
        expect(await grant('task:A')).toBe(true);
        expect(await grant('task:A')).toBe(false);
        expect(disk().character.totalXp).toBe(20);
    });

    it('publishes a durable grant without a redundant unlocked persist', async () => {
        const write = vi.spyOn(Storage.prototype, 'setItem');
        expect(await grant('task:A')).toBe(true);
        await flushCompletionRewardWrites();
        expect(write.mock.calls.filter(([key]) => key === 'quest-board-game')).toHaveLength(1);
        expect(disk().character.totalXp).toBe(20);
        expect(await grant('task:A')).toBe(false);
    });

    it('queues a stale profile save behind a held reward lock and merges the committed receipt', async () => {
        const manager = navigator.locks;
        const stale = useGameStore.getState();
        let release!: () => void;
        const held = manager.request(COMPLETION_REWARD_LOCK, () => new Promise<void>((resolve) => { release = resolve; }));
        await Promise.resolve();
        const awarded = grant('task:A');
        withoutCompletionRewardPersistence(() => useGameStore.setState(stale));
        useGameStore.getState().updateCharacter({ name: 'Queued stale profile' });
        expect(disk().completionRewardKeys).toEqual([]);
        release();
        await held;
        expect(await awarded).toBe(true);
        await flushCompletionRewardWrites();
        expect(disk()).toMatchObject({ completionRewardKeys: ['task:A'], character: { totalXp: 20, name: 'Queued stale profile' }, gachaCount: 1 });
        expect(useGameStore.getState().character).toMatchObject({ totalXp: 20, name: 'Queued stale profile' });
        expect(await grant('task:A')).toBe(false);
    });

    it('settles queued profile saves before backup export and restore', async () => {
        useGameStore.getState().updateCharacter({ name: 'Queued for backup' });
        const backup = await withSettledGamePersistence(() => exportAllData());
        expect((backup.game as { state: { character: { name: string } } }).state.character.name).toBe('Queued for backup');
        useGameStore.getState().updateCharacter({ name: 'Old queued write' });
        expect(await withSettledGamePersistence(() => importAllData(backup))).toBe(true);
        await flushCompletionRewardWrites();
        await useGameStore.persist.rehydrate();
        expect(useGameStore.getState().character.name).toBe('Queued for backup');
    });

    it('drops a queued previous-session profile save before it can overwrite a new account', async () => {
        useGameStore.getState().updateCharacter({ name: 'Old anonymous' });
        setGameRewardAuthorityState('authenticated');
        const cloud = JSON.stringify({ state: { ...disk(), completionRewardScope: 'cloud', character: { ...disk().character, name: 'New account' } }, version: 0 });
        localStorage.setItem('quest-board-game', cloud);
        await flushCompletionRewardWrites();
        expect(localStorage.getItem('quest-board-game')).toBe(cloud);
    });

    it('preserves malformed storage and refuses to guess a reward balance', async () => {
        const raw = JSON.stringify({ state: null, version: 0 });
        localStorage.setItem('quest-board-game', raw);
        expect(await grant('task:A')).toBe(false);
        expect(localStorage.getItem('quest-board-game')).toBe(raw);
    });

    it('does not turn another tab cloud cache into an anonymous reward source', async () => {
        const raw = JSON.stringify({ state: { ...disk(), completionRewardScope: 'cloud' }, version: 0 });
        localStorage.setItem('quest-board-game', raw);
        expect(await grant('task:A')).toBe(false);
        expect(useGameStore.getState().completionRewardError).toContain('アカウント');
        expect(localStorage.getItem('quest-board-game')).toBe(raw);
    });

    it('fails closed without Web Locks and does not promise cross-tab protection', async () => {
        vi.stubGlobal('navigator', {});
        expect(await grant('task:A')).toBe(false);
        expect(disk().character.totalXp).toBe(0);
        expect(useGameStore.getState().completionRewardError).toContain('Web Locks');
    });

    it('rejects a queued reward after an authority/account generation change', async () => {
        let work: (() => boolean) | undefined;
        vi.stubGlobal('navigator', { locks: { request: (_name: string, callback: () => boolean) => {
            work = callback; return Promise.resolve().then(() => work!());
        } } });
        const pending = grant('task:A');
        setGameRewardAuthorityState('authenticated');
        setGameRewardAuthorityState('anonymous');
        expect(await pending).toBe(false);
        expect(disk().character.totalXp).toBe(0);
    });

    it('migrates only surviving completed legacy evidence without changing the old XP', async () => {
        const legacy = sanitizeGameStoreState({ character: { totalXp: 110 }, gachaCount: 5 });
        const oldGame: Partial<typeof legacy> = { ...legacy };
        delete oldGame.completionRewardKeys;
        localStorage.setItem('quest-board-game', JSON.stringify({ state: oldGame, version: 0 }));
        localStorage.setItem('quest-board-tasks', JSON.stringify({ state: { tasks: [
            { id: 'old', completed: true, subtasks: [{ id: 'child', completed: true }] },
            { id: 'unknown-history', completed: false, subtasks: [] },
        ] }, version: 0 }));
        await useGameStore.persist.rehydrate();
        expect(useGameStore.getState().character.totalXp).toBe(110);
        expect(useGameStore.getState().completionRewardKeys).toEqual(['task:old', 'subtask:child']);
        expect(await grant('task:old')).toBe(false);
        expect(await grant('subtask:child')).toBe(false);
        expect(await grant('task:new')).toBe(true);
        expect(disk().character.totalXp).toBe(130);
    });

    it('also preserves legacy canonical evidence for undone/deleted work', async () => {
        const legacy: Partial<ReturnType<typeof sanitizeGameStoreState>> = sanitizeGameStoreState({ character: { totalXp: 90 } });
        delete legacy.completionRewardKeys;
        localStorage.setItem('quest-board-game', JSON.stringify({ state: legacy, version: 0 }));
        localStorage.setItem(CANONICAL_STORAGE_KEYS.game, JSON.stringify({ repositoryVersion: 1, data: {
            schemaVersion: 1,
            rewardLedger: { rewardedTaskIds: ['undone', 'deleted'], rewardedSubtaskIds: ['old-child'] },
        } }));
        await useGameStore.persist.rehydrate();
        expect(await grant('task:undone')).toBe(false);
        expect(await grant('task:deleted')).toBe(false);
        expect(await grant('subtask:old-child')).toBe(false);
        expect(useGameStore.getState().character.totalXp).toBe(90);
    });
});
