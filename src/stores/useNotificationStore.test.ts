import { beforeEach, describe, expect, it } from 'vitest';
import { sanitizeNotificationState, useNotificationStore } from './useNotificationStore';
import { NOTIFICATION_CONFIG } from '../config/gameConfig';

function reset() {
    localStorage.clear();
    useNotificationStore.setState({
        enabled: false,
        notifiedTaskIds: [],
        lastHabitReminderDate: null,
        habitReminderHour: NOTIFICATION_CONFIG.HABIT_REMINDER_HOUR_JST,
    });
}

describe('useNotificationStore', () => {
    beforeEach(() => reset());

    describe('sanitizeNotificationState', () => {
        it('非オブジェクトの永続化データは無視する', () => {
            expect(sanitizeNotificationState(null)).toEqual({});
            expect(sanitizeNotificationState('broken')).toEqual({});
            expect(sanitizeNotificationState(1)).toEqual({});
        });

        it('有効なフィールドだけを復元し、通知時刻を範囲内に丸める', () => {
            expect(
                sanitizeNotificationState({
                    enabled: true,
                    notifiedTaskIds: ['task-1', 123, 'task-2', null],
                    lastHabitReminderDate: '2026-06-11',
                    habitReminderHour: 26.8,
                    extraField: 'ignored',
                })
            ).toEqual({
                enabled: true,
                notifiedTaskIds: ['task-1', 'task-2'],
                lastHabitReminderDate: '2026-06-11',
                habitReminderHour: 23,
            });
        });

        it('不正な型のフィールドは復元対象に含めない', () => {
            expect(
                sanitizeNotificationState({
                    enabled: 'yes',
                    notifiedTaskIds: 'task-1',
                    lastHabitReminderDate: 20260611,
                    habitReminderHour: Number.NaN,
                })
            ).toEqual({});
        });

        it('null の最終習慣リマインド日は有効な未通知状態として扱う', () => {
            expect(sanitizeNotificationState({ lastHabitReminderDate: null })).toEqual({
                lastHabitReminderDate: null,
            });
        });
    });

    // ── setEnabled ──
    describe('setEnabled', () => {
        it('true に切替', () => {
            useNotificationStore.getState().setEnabled(true);
            expect(useNotificationStore.getState().enabled).toBe(true);
        });

        it('false に切替', () => {
            useNotificationStore.getState().setEnabled(true);
            useNotificationStore.getState().setEnabled(false);
            expect(useNotificationStore.getState().enabled).toBe(false);
        });
    });

    // ── setHabitReminderHour ──
    describe('setHabitReminderHour', () => {
        it('正常値 (0〜23) を受け取る', () => {
            useNotificationStore.getState().setHabitReminderHour(8);
            expect(useNotificationStore.getState().habitReminderHour).toBe(8);
        });

        it('負の値は 0 にクランプ', () => {
            useNotificationStore.getState().setHabitReminderHour(-5);
            expect(useNotificationStore.getState().habitReminderHour).toBe(0);
        });

        it('24 以上は 23 にクランプ', () => {
            useNotificationStore.getState().setHabitReminderHour(30);
            expect(useNotificationStore.getState().habitReminderHour).toBe(23);
        });

        it('小数は Math.floor で整数化', () => {
            useNotificationStore.getState().setHabitReminderHour(7.9);
            expect(useNotificationStore.getState().habitReminderHour).toBe(7);
        });

        it('境界値 0 と 23 はそのまま', () => {
            useNotificationStore.getState().setHabitReminderHour(0);
            expect(useNotificationStore.getState().habitReminderHour).toBe(0);
            useNotificationStore.getState().setHabitReminderHour(23);
            expect(useNotificationStore.getState().habitReminderHour).toBe(23);
        });
    });

    // ── markTaskNotified ──
    describe('markTaskNotified', () => {
        it('新規 ID を追加する', () => {
            useNotificationStore.getState().markTaskNotified('task-1');
            expect(useNotificationStore.getState().notifiedTaskIds).toEqual(['task-1']);
        });

        it('既存 ID を二重追加しない', () => {
            useNotificationStore.getState().markTaskNotified('task-1');
            useNotificationStore.getState().markTaskNotified('task-1');
            expect(useNotificationStore.getState().notifiedTaskIds).toEqual(['task-1']);
        });

        it('複数の異なる ID を追加できる', () => {
            useNotificationStore.getState().markTaskNotified('task-1');
            useNotificationStore.getState().markTaskNotified('task-2');
            expect(useNotificationStore.getState().notifiedTaskIds).toEqual(['task-1', 'task-2']);
        });
    });

    // ── pruneNotifiedTasks ──
    describe('pruneNotifiedTasks', () => {
        it('validTaskIds に含まれない ID を削除', () => {
            useNotificationStore.setState({ notifiedTaskIds: ['a', 'b', 'c'] });
            useNotificationStore.getState().pruneNotifiedTasks(['b']);
            expect(useNotificationStore.getState().notifiedTaskIds).toEqual(['b']);
        });

        it('含まれる ID は残る', () => {
            useNotificationStore.setState({ notifiedTaskIds: ['x', 'y'] });
            useNotificationStore.getState().pruneNotifiedTasks(['x', 'y']);
            expect(useNotificationStore.getState().notifiedTaskIds).toEqual(['x', 'y']);
        });

        it('空配列を渡せばすべて削除', () => {
            useNotificationStore.setState({ notifiedTaskIds: ['a', 'b', 'c'] });
            useNotificationStore.getState().pruneNotifiedTasks([]);
            expect(useNotificationStore.getState().notifiedTaskIds).toEqual([]);
        });
    });

    // ── markHabitReminded ──
    describe('markHabitReminded', () => {
        it('渡した日付が lastHabitReminderDate にセットされる', () => {
            useNotificationStore.getState().markHabitReminded('2025-03-15');
            expect(useNotificationStore.getState().lastHabitReminderDate).toBe('2025-03-15');
        });

        it('日付を上書きできる', () => {
            useNotificationStore.getState().markHabitReminded('2025-03-15');
            useNotificationStore.getState().markHabitReminded('2025-03-16');
            expect(useNotificationStore.getState().lastHabitReminderDate).toBe('2025-03-16');
        });
    });
});
