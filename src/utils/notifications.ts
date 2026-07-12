/**
 * ブラウザ通知のユーティリティ。
 *
 * サーバーを持たないため、通知は「アプリを開いている間」に
 * 条件をチェックして発火する方式（バックグラウンド通知は非対応）。
 */

import {
    buildHabitReminderNotification,
    buildTaskDeadlineNotification,
    NOTIFICATION_TEXT_MAX,
    selectDueSoonTasks,
    shouldSendHabitReminder,
    type NotificationContent,
} from '../core/notifications';
import { getTodayJST, getJSTHour } from './dateUtils';
import { useNotificationStore } from '../stores/useNotificationStore';
import { useTaskStore } from '../stores/useTaskStore';
import { useHabitStore } from '../stores/useHabitStore';

// 判定条件・文言はcoreへ移設した（Mobileと共有）。ここはWeb固有の表示だけを担う。
export { resolveHabitReminderHour } from '../core/notifications';

const ICON_URL = '/pwa-192x192.png';
const BADGE_URL = '/favicon.png';

let isRunningNotificationChecks = false;

function getNotificationApi(): typeof Notification | null {
    try {
        return typeof globalThis.Notification === 'function' ? globalThis.Notification : null;
    } catch {
        return null;
    }
}

/** このブラウザが通知に対応しているか */
export function isNotificationSupported(): boolean {
    return getNotificationApi() !== null;
}

/** 現在の通知許可状態。未対応なら 'unsupported' */
export function getNotificationPermission(): NotificationPermission | 'unsupported' {
    const notificationApi = getNotificationApi();
    if (!notificationApi) return 'unsupported';
    try {
        const permission = notificationApi.permission;
        return permission === 'granted' || permission === 'denied' || permission === 'default'
            ? permission
            : 'unsupported';
    } catch {
        return 'unsupported';
    }
}

/** 通知の許可をユーザーに要求する */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
    const notificationApi = getNotificationApi();
    if (!notificationApi) return 'denied';
    try {
        if (typeof notificationApi.requestPermission !== 'function') return 'denied';
        const permission = await notificationApi.requestPermission();
        return permission === 'granted' || permission === 'denied' || permission === 'default'
            ? permission
            : 'denied';
    } catch {
        return 'denied';
    }
}

async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
    try {
        if (!('serviceWorker' in navigator)) return null;
        return await navigator.serviceWorker.getRegistration() ?? null;
    } catch {
        return null;
    }
}

/**
 * 通知を表示する。
 * Service Worker が使える場合はそちら経由（インストール済みPWAで確実）、
 * 無ければ通常の Notification を使う。
 */
async function showAppNotification({ title, body, tag }: NotificationContent): Promise<boolean> {
    // coreのbuilderでカット済みだが、上流の漏れによる巨大通知への防御として必ずここでもカットする
    const safeTitle = title.slice(0, NOTIFICATION_TEXT_MAX);
    const safeBody = body.slice(0, NOTIFICATION_TEXT_MAX);
    const options: NotificationOptions = { body: safeBody, tag, icon: ICON_URL, badge: BADGE_URL };

    const registration = await getServiceWorkerRegistration();
    if (registration) {
        try {
            await registration.showNotification(safeTitle, options);
            return true;
        } catch {
            // Service Worker経由で失敗した場合は、重複通知を避けるため通常通知にフォールバックしない。
            return false;
        }
    }

    try {
        if (getNotificationPermission() !== 'granted') return false;
        const notificationApi = getNotificationApi();
        if (!notificationApi) return false;
        new notificationApi(safeTitle, options);
        return true;
    } catch {
        // 失敗を呼び出し元へ返し、重複防止状態を更新せず次回再試行させる。
        return false;
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
    if (isRunningNotificationChecks) return;
    isRunningNotificationChecks = true;

    try {
        const notificationStore = useNotificationStore.getState();
        if (!notificationStore.enabled) return;
        if (getNotificationPermission() !== 'granted') return;

        const tasks = useTaskStore.getState().tasks;
        // 削除済みタスクのIDを通知履歴から掃除
        notificationStore.pruneNotifiedTasks(tasks.map((t) => t.id));

        // ── タスク期限の通知（期限の24時間前以降、未完了、未通知のもの）──
        const dueSoonTasks = selectDueSoonTasks(tasks, {
            nowMs: Date.now(),
            notifiedTaskIds: useNotificationStore.getState().notifiedTaskIds,
        });
        for (const task of dueSoonTasks) {
            const delivered = await showAppNotification(buildTaskDeadlineNotification(task));
            if (delivered) useNotificationStore.getState().markTaskNotified(task.id);
        }

        // ── 習慣リマインダー（指定時刻以降、未完了の習慣がある、本日未通知）──
        const today = getTodayJST();
        const send = shouldSendHabitReminder({
            today,
            lastReminderDate: useNotificationStore.getState().lastHabitReminderDate,
            currentHour: getJSTHour(),
            // 旧データ（habitReminderHour 未設定）は既定の20時として扱う
            reminderHour: useNotificationStore.getState().habitReminderHour,
        });
        if (send) {
            const habitStore = useHabitStore.getState();
            if (
                habitStore.habits.length > 0 &&
                !habitStore.isRestDay(today) &&
                !habitStore.areAllHabitsComplete(today)
            ) {
                const incompleteCount = countIncompleteHabits(today);
                const delivered = await showAppNotification(
                    buildHabitReminderNotification(incompleteCount, today)
                );
                if (delivered) useNotificationStore.getState().markHabitReminded(today);
            }
        }
    } finally {
        isRunningNotificationChecks = false;
    }
}
