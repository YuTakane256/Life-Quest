/**
 * 通知の共有ルール。
 * 「いつ・何を通知するか」の判定と文言をWeb/Mobileで共有し、
 * 実際の通知表示（Notification API / expo-notifications）は各プラットフォームが担う。
 */
import { isValidYmdDate, type Task } from './tasks.ts';

export const NOTIFICATION_CONFIG = {
    /** タスク期限の何時間前から通知するか */
    TASK_DEADLINE_NOTICE_HOURS: 24,

    /** 未完了の習慣をリマインドするJST時刻（時） */
    HABIT_REMINDER_HOUR_JST: 20,

    /** 通知条件チェックの実行間隔（ミリ秒） */
    CHECK_INTERVAL_MS: 30 * 60 * 1000, // 30分

    /** 重複通知防止用に保持するタスクID数の上限 */
    MAX_NOTIFIED_TASK_IDS: 200,
} as const;

/**
 * OS 通知トーストに流し込む文字列の最大長。
 * 既存タスク・バックアップ復元・DevTools 経由で巨大な name が混入した場合の
 * 防御として、title / body をここでカットする。
 */
export const NOTIFICATION_TEXT_MAX = 200;

/** リマインダー時刻（時）を 0-23 の整数へ丸める。数値でなければ既定の20時。 */
export function resolveHabitReminderHour(hour: unknown): number {
    if (typeof hour !== 'number' || !Number.isFinite(hour)) {
        return NOTIFICATION_CONFIG.HABIT_REMINDER_HOUR_JST;
    }
    return Math.max(0, Math.min(23, Math.floor(hour)));
}

export interface NotificationContent {
    title: string;
    body: string;
    /** 同一通知の重複表示防止用タグ */
    tag: string;
}

function truncate(text: string): string {
    return text.slice(0, NOTIFICATION_TEXT_MAX);
}

export function buildTaskDeadlineNotification(task: Pick<Task, 'id' | 'name'>): NotificationContent {
    return {
        title: truncate('タスクの期限が近づいています'),
        body: truncate(`「${task.name}」の期限が近づいています`),
        tag: `task-deadline-${task.id}`,
    };
}

export function buildHabitReminderNotification(incompleteCount: number, today: string): NotificationContent {
    return {
        title: truncate('今日の習慣がまだ残っています'),
        body: truncate(`未完了の習慣が${incompleteCount}件あります。寝る前に済ませましょう！`),
        tag: `habit-reminder-${today}`,
    };
}

export type DueSoonTask = Pick<Task, 'id' | 'name' | 'dueDate' | 'completed'>;

/**
 * 期限が近づいた未通知のタスクを選定する。
 * dueDate はJSTの日付。その日の終わり(23:59:59 JST)を期限とみなす。
 */
export function selectDueSoonTasks<T extends DueSoonTask>(
    tasks: readonly T[],
    options: { nowMs: number; notifiedTaskIds: readonly string[]; noticeHours?: number },
): T[] {
    const noticeHours = options.noticeHours ?? NOTIFICATION_CONFIG.TASK_DEADLINE_NOTICE_HOURS;
    const windowMs = noticeHours * 60 * 60 * 1000;
    const notified = new Set(options.notifiedTaskIds);

    return tasks.filter((task) => {
        if (task.completed || !task.dueDate) return false;
        if (!isValidYmdDate(task.dueDate)) return false;
        if (notified.has(task.id)) return false;
        const deadline = new Date(`${task.dueDate}T23:59:59+09:00`).getTime();
        if (Number.isNaN(deadline)) return false;
        return deadline - options.nowMs <= windowMs;
    });
}

/** 習慣リマインダーを送るべきか（本日未送信かつ指定時刻以降）。 */
export function shouldSendHabitReminder(input: {
    today: string;
    lastReminderDate: string | null;
    currentHour: number;
    reminderHour: unknown;
}): boolean {
    return input.lastReminderDate !== input.today
        && input.currentHour >= resolveHabitReminderHour(input.reminderHour);
}
