import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setGameRewardAuthorityState } from '@life-quest/core/gameRewardAuthority';
import { useTaskStore, registerWebPendingTaskRewardRecovery } from './useTaskStore';
import { useGameStore, sanitizeGameStoreState } from './useGameStore';
import { useStatsStore } from './useStatsStore';
import { UI_CONFIG } from '../config/gameConfig';
import { getCompletionRewardGeneration, resetCompletionRewardStorage } from '../platform/completionRewards';
import { clearPendingWebRewardOperations, deferWebRewardOperation, getPendingWebRewardOperations } from '../platform/pendingRewardOperations';

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T03:00:00Z'));
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, work: () => unknown) => work() } });
    setGameRewardAuthorityState('anonymous');
    localStorage.clear();
    clearPendingWebRewardOperations();
    resetCompletionRewardStorage(() => useGameStore.setState({ ...sanitizeGameStoreState(undefined), completionRewardError: null }));
    useTaskStore.setState({ tasks: [], pendingCompletions: [] });
    useStatsStore.setState({ taskXpLog: {} });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function finish(id: string) {
    useTaskStore.getState().toggleComplete(id);
    await vi.advanceTimersByTimeAsync(UI_CONFIG.UNDO_DURATION_MS);
    await vi.dynamicImportSettled();
}

describe('real task/subtask completion reward integration', () => {
    it('undo inside the grace period does not consume a receipt; confirmed re-completion is never a second reward', async () => {
        useTaskStore.getState().addTask('task', null, 'medium', 'none');
        const id = useTaskStore.getState().tasks[0].id;
        useTaskStore.getState().toggleComplete(id);
        useTaskStore.getState().cancelPendingCompletion(id);
        await vi.advanceTimersByTimeAsync(UI_CONFIG.UNDO_DURATION_MS);
        expect(useGameStore.getState().completionRewardKeys).toEqual([]);
        await finish(id);
        expect(useGameStore.getState().character.totalXp).toBe(20);
        useTaskStore.getState().toggleComplete(id);
        await finish(id);
        await useGameStore.persist.rehydrate();
        useTaskStore.getState().toggleComplete(id);
        await finish(id);
        expect(useGameStore.getState()).toMatchObject({ completionRewardKeys: [`task:${id}`], gachaCount: 1, character: { totalXp: 20 } });
        expect(useStatsStore.getState().taskXpLog['2026-10-14']).toBe(20);
    });

    it('re-completing a subtask does not duplicate XP/count/statistics, even after deleting it', async () => {
        useTaskStore.getState().addTask('parent', null, 'medium', 'none');
        const parent = useTaskStore.getState().tasks[0].id;
        useTaskStore.getState().addSubtask(parent, 'child');
        const child = useTaskStore.getState().tasks[0].subtasks[0].id;
        useTaskStore.getState().toggleSubtaskComplete(parent, child);
        await vi.dynamicImportSettled();
        useTaskStore.getState().toggleSubtaskComplete(parent, child);
        useTaskStore.getState().toggleSubtaskComplete(parent, child);
        await vi.dynamicImportSettled();
        expect(useGameStore.getState().character.totalXp).toBe(10);
        expect(useGameStore.getState().gachaCount).toBe(1);
        useTaskStore.getState().deleteSubtask(parent, child);
        await useGameStore.persist.rehydrate();
        expect(await useGameStore.getState().grantCompletionReward(`subtask:${child}`, 10, getCompletionRewardGeneration())).toBe(false);
        expect(useStatsStore.getState().taskXpLog['2026-10-14']).toBe(10);
    });

    it('a distinct recurring instance earns its own reward, while re-completing the old instance does not spawn another', async () => {
        useTaskStore.getState().addTask('daily', '2026-10-14', 'medium', 'daily');
        const id = useTaskStore.getState().tasks[0].id;
        await finish(id);
        const next = useTaskStore.getState().tasks.find((task) => task.id !== id)!;
        useTaskStore.getState().toggleComplete(id);
        await finish(id);
        expect(useTaskStore.getState().tasks).toHaveLength(2);
        await finish(next.id);
        expect(useGameStore.getState().character.totalXp).toBe(40);
        expect(useTaskStore.getState().tasks).toHaveLength(3);
    });

    it('does not re-grant an already applied deferred reward when auth resolves again', async () => {
        useTaskStore.getState().addTask('recover', null, 'medium', 'none');
        const id = useTaskStore.getState().tasks[0].id;
        await finish(id);
        setGameRewardAuthorityState('resolving');
        deferWebRewardOperation({ key: `task:${id}`, priority: 'medium', completedAt: new Date().toISOString(), xpReward: 20 });
        const stop = registerWebPendingTaskRewardRecovery();
        try {
            setGameRewardAuthorityState('anonymous');
            await vi.dynamicImportSettled();
            expect(useGameStore.getState().character.totalXp).toBe(20);
            expect(getPendingWebRewardOperations()).toEqual([]);
        } finally { stop(); }
    });
});
