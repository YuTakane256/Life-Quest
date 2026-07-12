import { describe, expect, it } from 'vitest';
import {
    buildHabitReminderNotification,
    buildTaskDeadlineNotification,
    NOTIFICATION_CONFIG,
    NOTIFICATION_TEXT_MAX,
    resolveHabitReminderHour,
    selectDueSoonTasks,
    shouldSendHabitReminder,
    type DueSoonTask,
} from './notifications.ts';

function task(overrides: Partial<DueSoonTask> & Pick<DueSoonTask, 'id'>): DueSoonTask {
    return { name: `task-${overrides.id}`, dueDate: null, completed: false, ...overrides };
}

// 2026-07-10T00:00:00+09:00
const NOW = new Date('2026-07-10T00:00:00+09:00').getTime();

describe('selectDueSoonTasks', () => {
    it('期限24時間前を過ぎた未完了・未通知タスクだけを選ぶ', () => {
        const tasks = [
            task({ id: 'due-today', dueDate: '2026-07-10' }),      // 期限まで24h以内
            task({ id: 'due-tomorrow', dueDate: '2026-07-11' }),   // 24hを超えて先
            task({ id: 'overdue', dueDate: '2026-07-01' }),        // 期限超過も対象
            task({ id: 'done', dueDate: '2026-07-10', completed: true }),
            task({ id: 'no-due', dueDate: null }),
            task({ id: 'bad-due', dueDate: '2026-13-99' }),
            task({ id: 'notified', dueDate: '2026-07-10' }),
        ];
        const result = selectDueSoonTasks(tasks, { nowMs: NOW, notifiedTaskIds: ['notified'] });
        expect(result.map((candidate) => candidate.id)).toEqual(['due-today', 'overdue']);
    });

    it('境界: 期限ちょうど24時間前は通知対象になる', () => {
        // 2026-07-10T23:59:59+09:00 の期限に対し、ちょうど24時間前
        const exactly24hBefore = new Date('2026-07-09T23:59:59+09:00').getTime();
        const result = selectDueSoonTasks(
            [task({ id: 'boundary', dueDate: '2026-07-10' })],
            { nowMs: exactly24hBefore, notifiedTaskIds: [] },
        );
        expect(result).toHaveLength(1);

        const oneMsEarlier = exactly24hBefore - 1;
        expect(selectDueSoonTasks(
            [task({ id: 'boundary', dueDate: '2026-07-10' })],
            { nowMs: oneMsEarlier, notifiedTaskIds: [] },
        )).toHaveLength(0);
    });

    it('noticeHours未指定はNOTIFICATION_CONFIGの既定値を使う', () => {
        expect(NOTIFICATION_CONFIG.TASK_DEADLINE_NOTICE_HOURS).toBe(24);
        const result = selectDueSoonTasks(
            [task({ id: 'a', dueDate: '2026-07-10' })],
            { nowMs: NOW, notifiedTaskIds: [], noticeHours: 0 },
        );
        expect(result).toHaveLength(0); // 猶予0時間なら期限当日の朝はまだ対象外
    });
});

describe('shouldSendHabitReminder', () => {
    it('本日未送信かつ指定時刻以降のときだけtrue', () => {
        const base = { today: '2026-07-10', lastReminderDate: null, reminderHour: 20 };
        expect(shouldSendHabitReminder({ ...base, currentHour: 20 })).toBe(true);
        expect(shouldSendHabitReminder({ ...base, currentHour: 23 })).toBe(true);
        expect(shouldSendHabitReminder({ ...base, currentHour: 19 })).toBe(false);
        expect(shouldSendHabitReminder({ ...base, currentHour: 23, lastReminderDate: '2026-07-10' })).toBe(false);
        expect(shouldSendHabitReminder({ ...base, currentHour: 23, lastReminderDate: '2026-07-09' })).toBe(true);
    });

    it('不正なreminderHourは既定の20時として扱う', () => {
        const base = { today: '2026-07-10', lastReminderDate: null, reminderHour: undefined };
        expect(shouldSendHabitReminder({ ...base, currentHour: 19 })).toBe(false);
        expect(shouldSendHabitReminder({ ...base, currentHour: 20 })).toBe(true);
    });
});

describe('resolveHabitReminderHour', () => {
    it('0-23の整数へ丸める', () => {
        expect(resolveHabitReminderHour(0)).toBe(0);
        expect(resolveHabitReminderHour(7.9)).toBe(7);
        expect(resolveHabitReminderHour(-5)).toBe(0);
        expect(resolveHabitReminderHour(30)).toBe(23);
    });

    it('数値以外は既定値', () => {
        expect(resolveHabitReminderHour(Number.NaN)).toBe(NOTIFICATION_CONFIG.HABIT_REMINDER_HOUR_JST);
        expect(resolveHabitReminderHour('20')).toBe(NOTIFICATION_CONFIG.HABIT_REMINDER_HOUR_JST);
        expect(resolveHabitReminderHour(undefined)).toBe(NOTIFICATION_CONFIG.HABIT_REMINDER_HOUR_JST);
    });
});

describe('通知文言', () => {
    it('タスク期限通知はWebと同一文言・タグを生成する', () => {
        expect(buildTaskDeadlineNotification({ id: 't1', name: '買い物' })).toEqual({
            title: 'タスクの期限が近づいています',
            body: '「買い物」の期限が近づいています',
            tag: 'task-deadline-t1',
        });
    });

    it('習慣リマインダーはWebと同一文言・タグを生成する', () => {
        expect(buildHabitReminderNotification(3, '2026-07-10')).toEqual({
            title: '今日の習慣がまだ残っています',
            body: '未完了の習慣が3件あります。寝る前に済ませましょう！',
            tag: 'habit-reminder-2026-07-10',
        });
    });

    it('巨大なタスク名はNOTIFICATION_TEXT_MAXでカットされる', () => {
        const huge = 'あ'.repeat(1000);
        const content = buildTaskDeadlineNotification({ id: 't2', name: huge });
        expect(content.body.length).toBe(NOTIFICATION_TEXT_MAX);
    });
});
