import { beforeEach, describe, expect, it } from 'vitest';
import { useNotificationStore } from './useNotificationStore';
import { NOTIFICATION_CONFIG } from '../config/gameConfig';

function resetStore() {
    localStorage.clear();
    useNotificationStore.setState({
        enabled: false,
        notifiedTaskIds: [],
        lastHabitReminderDate: null,
        habitReminderHour: NOTIFICATION_CONFIG.HABIT_REMINDER_HOUR_JST,
    });
}

describe('useNotificationStore', () => {
    beforeEach(() => {
        resetStore();
    });

    describe('setEnabled', () => {
        it('true / false の切替が反映される', () => {
            useNotificationStore.getState().setEnabled(true);
            expect(useNotificationStore.getState().enabled).toBe(true);
            useNotificationStore.getState().setEnabled(false);
            expect(useNotificationStore.getState().enabled).toBe(false);
        });
    });

    describe('setHabitReminderHour', () => {
        it('0〜23 の正常値はそのまま反映', () => {
            useNotificationStore.getState().setHabitReminderHour(0);
            expect(useNotificationStore.getState().habitReminderHour).toBe(0);
            useNotificationStore.getState().setHabitReminderHour(12);
            expect(useNotificationStore.getState().habitReminderHour).toBe(12);
            useNotificationStore.getState().setHabitReminderHour(23);
            expect(useNotificationStore.getState().habitReminderHour).toBe(23);
        });

        it('負の値は 0 にクランプ', () => {
            useNotificationStore.getState().setHabitReminderHour(-5);
            expect(useNotificationStore.getState().habitReminderHour).toBe(0);
        });

        it('24 以上は 23 にクランプ', () => {
            useNotificationStore.getState().setHabitReminderHour(24);
            expect(useNotificationStore.getState().habitReminderHour).toBe(23);
            useNotificationStore.getState().setHabitReminderHour(100);
            expect(useNotificationStore.getState().habitReminderHour).toBe(23);
        });

        it('小数は Math.floor で整数化', () => {
            useNotificationStore.getState().setHabitReminderHour(7.9);
            expect(useNotificationStore.getState().habitReminderHour).toBe(7);
            useNotificationStore.getState().setHabitReminderHour(23.999);
            expect(useNotificationStore.getState().habitReminderHour).toBe(23);
        });
    });

    describe('markTaskNotified', () => {
        it('新規 ID を追加する', () => {
            useNotificationStore.getState().markTaskNotified('task-1');
            expect(useNotificationStore.getState().notifiedTaskIds).toEqual(['task-1']);
        });

        it('複数追加すると配列に蓄積', () => {
            useNotificationStore.getState().markTaskNotified('a');
            useNotificationStore.getState().markTaskNotified('b');
            useNotificationStore.getState().markTaskNotified('c');
            expect(useNotificationStore.getState().notifiedTaskIds).toEqual(['a', 'b', 'c']);
        });

        it('既存 ID を二重追加しない', () => {
            useNotificationStore.getState().markTaskNotified('task-1');
            useNotificationStore.getState().markTaskNotified('task-1');
            useNotificationStore.getState().markTaskNotified('task-1');
            expect(useNotificationStore.getState().notifiedTaskIds).toEqual(['task-1']);
        });
    });

    describe('pruneNotifiedTasks', () => {
        beforeEach(() => {
            useNotificationStore.setState({
                enabled: false,
                notifiedTaskIds: ['a', 'b', 'c', 'd'],
                lastHabitReminderDate: null,
                habitReminderHour: 20,
            });
        });

        it('valid な ID のみ残す', () => {
            useNotificationStore.getState().pruneNotifiedTasks(['a', 'c']);
            expect(useNotificationStore.getState().notifiedTaskIds).toEqual(['a', 'c']);
        });

        it('valid 配列に全部含まれる場合は何も削除されない', () => {
            useNotificationStore.getState().pruneNotifiedTasks(['a', 'b', 'c', 'd', 'e']);
            expect(useNotificationStore.getState().notifiedTaskIds).toEqual(['a', 'b', 'c', 'd']);
        });

        it('空配列を渡すと全削除', () => {
            useNotificationStore.getState().pruneNotifiedTasks([]);
            expect(useNotificationStore.getState().notifiedTaskIds).toEqual([]);
        });
    });

    describe('markHabitReminded', () => {
        it('日付が lastHabitReminderDate にセットされる', () => {
            useNotificationStore.getState().markHabitReminded('2025-03-15');
            expect(useNotificationStore.getState().lastHabitReminderDate).toBe('2025-03-15');
        });

        it('別の日付で上書きされる', () => {
            useNotificationStore.getState().markHabitReminded('2025-03-15');
            useNotificationStore.getState().markHabitReminded('2025-03-16');
            expect(useNotificationStore.getState().lastHabitReminderDate).toBe('2025-03-16');
        });
    });
});
