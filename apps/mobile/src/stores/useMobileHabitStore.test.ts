import AsyncStorage from '@react-native-async-storage/async-storage';
import { HABIT_LIMITS, createHabit, type Habit } from '@life-quest/core/habits';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMobileHabitStore } from './useMobileHabitStore';

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => undefined),
        removeItem: vi.fn(async () => undefined),
    },
}));

const storage = vi.mocked(AsyncStorage);

function habit(id: string): Habit {
    const value = createHabit(id, `Habit ${id}`, 'general', '2026-07-02T00:00:00.000Z');
    if (!value) throw new Error('Test habit must be valid');
    return value;
}

describe('useMobileHabitStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useMobileHabitStore.setState({ habits: [], records: [], hasHydrated: true });
    });

    it('adds a normalized habit and rejects an empty name', () => {
        expect(useMobileHabitStore.getState().addHabit('   ')).toBe(false);
        expect(useMobileHabitStore.getState().addHabit('  朝の散歩  ')).toBe(true);

        expect(useMobileHabitStore.getState().habits).toHaveLength(1);
        expect(useMobileHabitStore.getState().habits[0]).toMatchObject({
            name: '朝の散歩',
            categoryId: 'general',
        });
    });

    it('toggles a daily record and removes it with its habit', () => {
        useMobileHabitStore.getState().addHabit('記録確認');
        const id = useMobileHabitStore.getState().habits[0].id;
        const date = '2026-07-02';

        useMobileHabitStore.getState().toggleToday(id, date);
        expect(useMobileHabitStore.getState().records).toEqual([
            { habitId: id, date, completed: true, memo: '' },
        ]);

        useMobileHabitStore.getState().toggleToday(id, date);
        expect(useMobileHabitStore.getState().records[0].completed).toBe(false);

        useMobileHabitStore.getState().deleteHabit(id);
        expect(useMobileHabitStore.getState()).toMatchObject({ habits: [], records: [] });
    });

    it('does not add habits beyond the shared collection limit', () => {
        const habits = Array.from({ length: HABIT_LIMITS.maxHabits }, (_, index) => habit(String(index)));
        useMobileHabitStore.setState({ habits });

        expect(useMobileHabitStore.getState().addHabit('上限超過')).toBe(false);
        expect(useMobileHabitStore.getState().habits).toHaveLength(HABIT_LIMITS.maxHabits);
    });

    it('persists habit data without transient hydration state', async () => {
        useMobileHabitStore.getState().addHabit('保存対象');

        await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalled());
        const [, serialized] = storage.setItem.mock.calls.at(-1) ?? [];
        expect(serialized).toEqual(expect.any(String));
        const envelope = JSON.parse(serialized as string) as { state: Record<string, unknown> };
        expect(envelope.state.habits).toHaveLength(1);
        expect(envelope.state.records).toEqual([]);
        expect(envelope.state).not.toHaveProperty('hasHydrated');
    });
});
