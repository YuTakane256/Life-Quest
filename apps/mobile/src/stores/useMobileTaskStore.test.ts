import AsyncStorage from '@react-native-async-storage/async-storage';
import { TASK_LIMITS, createTask, type Task } from '@life-quest/core/tasks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMobileTaskStore } from './useMobileTaskStore';

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => undefined),
        removeItem: vi.fn(async () => undefined),
    },
}));

const storage = vi.mocked(AsyncStorage);

function task(id: string): Task {
    const value = createTask({ id, name: `Task ${id}`, now: '2026-07-02T00:00:00.000Z' });
    if (!value) throw new Error('Test task must be valid');
    return value;
}

describe('useMobileTaskStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useMobileTaskStore.setState({ tasks: [], hasHydrated: true });
    });

    it('adds a normalized task and rejects an empty name', () => {
        expect(useMobileTaskStore.getState().addTask('   ')).toBe(false);
        expect(useMobileTaskStore.getState().addTask('  今日のタスク  ')).toBe(true);

        expect(useMobileTaskStore.getState().tasks).toHaveLength(1);
        expect(useMobileTaskStore.getState().tasks[0]).toMatchObject({
            name: '今日のタスク',
            priority: 'medium',
            completed: false,
        });
    });

    it('toggles completion and removes a task', () => {
        useMobileTaskStore.getState().addTask('完了確認');
        const id = useMobileTaskStore.getState().tasks[0].id;

        useMobileTaskStore.getState().toggleTask(id);
        expect(useMobileTaskStore.getState().tasks[0].completed).toBe(true);
        expect(useMobileTaskStore.getState().tasks[0].completedAt).toEqual(expect.any(String));

        useMobileTaskStore.getState().toggleTask(id);
        expect(useMobileTaskStore.getState().tasks[0]).toMatchObject({ completed: false, completedAt: null });

        useMobileTaskStore.getState().deleteTask(id);
        expect(useMobileTaskStore.getState().tasks).toEqual([]);
    });

    it('does not add tasks beyond the shared collection limit', () => {
        const tasks = Array.from({ length: TASK_LIMITS.maxTasks }, (_, index) => task(String(index)));
        useMobileTaskStore.setState({ tasks });

        expect(useMobileTaskStore.getState().addTask('上限超過')).toBe(false);
        expect(useMobileTaskStore.getState().tasks).toHaveLength(TASK_LIMITS.maxTasks);
    });

    it('persists tasks without transient hydration state', async () => {
        useMobileTaskStore.getState().addTask('保存対象');

        await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalled());
        const [, serialized] = storage.setItem.mock.calls.at(-1) ?? [];
        expect(serialized).toEqual(expect.any(String));
        const envelope = JSON.parse(serialized as string) as { state: Record<string, unknown> };
        expect(envelope.state.tasks).toHaveLength(1);
        expect(envelope.state).not.toHaveProperty('hasHydrated');
    });
});
