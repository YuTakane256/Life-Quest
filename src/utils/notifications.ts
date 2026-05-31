/**
 * ブラウザ通知のユーティリティ。
 *
 * サーバーを持たないため、通知は「アプリを開いている間」に
 * 条件をチェックして発火する方式（バックグラウンド通知は非対応）。
 */

import { NOTIFICATION_CONFIG } from '../config/gameConfig';
import { getTodayJST, getJSTHour } from './dateUtils';
import { useNotificationStore } from '../stores/useNotificationStore';
import { useTaskStore } from '../stores/useTaskStore';
import { useHabitStore } from '../stores/useHabitStore';

const ICON_URL = '/pwa-192x192.png';
const BADGE_URL = '/favicon.png';

/**
 * OS 通知トーストに流し込む文字列の最大長。
 * 既存タスク・バックアップ復元・DevTools 経由で巨大な name が混入した場合の
 * 防御として、title / body をここでカットする。
 */
const NOTIFICATION_TEXT_MAX = 200;

/** このブラウザが通知に対応しているか */
export function isNotificationSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
}

/** 現在の通知許可状態。未対応なら 'unsupported' */
export function getNotificationPermission(): NotificationPermission | 'unsupported' {
    if (!isNotificationSupported()) return 'unsupported';
    return Notification.permission;
}

/** 通知の許可をユーザーに要求する */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
    if (!isNotificationSupported()) return 'denied';
    return Notification.requestPermission();
}

/**
 * 通知を表示する。
 * Service Worker が使える場合はそちら経由（インストール済みPWAで確実）、
 * 無ければ通常の Notification を使う。
 */
async function showAppNotification(title: string, body: string, tag: string): Promise<void> {
    // title / body を必ずカットして、上流の漏れによる巨大通知を防ぐ
    const safeTitle = title.slice(0, NOTIFICATION_TEXT_MAX);
    const safeBody = body.slice(0, NOTIFICATION_TEXT_MAX);
    const options: NotificationOptions = { body: safeBody, tag, icon: ICON_URL, badge: BADGE_URL };
    try {
        if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.getRegistration();
            if (registration) {
                await registration.showNotification(safeTitle, options);
                return;
            }
        }
        new Notification(safeTitle, options);
    } catch {
        // 通知表示に失敗しても致命的ではないので握りつぶす
    }
}

/** 指定日に未完了の習慣の件数を返す */
function countIncompleteHabits(date: string): number {
    const { habits, dailyRecords } = useHabitStore.getState();
    return habits.filter(
        (habit) => !dailyRecords.some((r) => r.habitId === habit.id && r.date === date && r.completed)
    ).length;
}

/**
 * 通知すべき条件をチェックして、該当すれば通知を出す。
 * アプリ起動時および一定間隔で呼び出す。
 */
export async function runNotificationChecks(): Promise<void> {
    const notificationStore = useNotificationStore.getState();
    if (!notificationStore.enabled) return;
    if (getNotificationPermission() !== 'granted') return;

    const tasks = useTaskStore.getState().tasks;
    // 削除済みタスクのIDを通知履歴から掃除
    notificationStore.pruneNotifiedTasks(tasks.map((t) => t.id));

    const now = Date.now();
    const windowMs = NOTIFICATION_CONFIG.TASK_DEADLINE_NOTICE_HOURS * 60 * 60 * 1000;

    // ── タスク期限の通知（期限の24時間前以降、未完了、未通知のもの）──
    for (const task of tasks) {
        if (task.completed || !task.dueDate) continue;
        if (useNotificationStore.getState().notifiedTaskIds.includes(task.id)) continue;

        // dueDate はJSTの日付。その日の終わり(23:59:59 JST)を期限とみなす
        const deadline = new Date(`${task.dueDate}T23:59:59+09:00`).getTime();
        if (Number.isNaN(deadline)) continue;

        if (deadline - now <= windowMs) {
            await showAppNotification(
                'タスクの期限が近づいています',
                `「${task.name}」の期限が近づいています`,
                `task-deadline-${task.id}`
            );
            useNotificationStore.getState().markTaskNotified(task.id);
        }
    }

    // ── 習慣リマインダー（指定時刻以降、未完了の習慣がある、本日未通知）──
    const today = getTodayJST();
    // 旧データ（habitReminderHour 未設定）は既定の20時として扱う
    const reminderHour = useNotificationStore.getState().habitReminderHour ?? NOTIFICATION_CONFIG.HABIT_REMINDER_HOUR_JST;
    if (
        useNotificationStore.getState().lastHabitReminderDate !== today &&
        getJSTHour() >= reminderHour
    ) {
        const habitStore = useHabitStore.getState();
        if (
            habitStore.habits.length > 0 &&
            !habitStore.isRestDay(today) &&
            !habitStore.areAllHabitsComplete(today)
        ) {
            const incompleteCount = countIncompleteHabits(today);
            await showAppNotification(
                '今日の習慣がまだ残っています',
                `未完了の習慣が${incompleteCount}件あります。寝る前に済ませましょう！`,
                `habit-reminder-${today}`
            );
            useNotificationStore.getState().markHabitReminded(today);
        }
    }
}
