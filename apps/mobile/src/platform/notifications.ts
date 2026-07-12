/**
 * Mobile通知（expo-notifications）。
 *
 * 「いつ・何を通知するか」の判定と文言は @life-quest/core/notifications の
 * 共有ルールを使い、Webと同一セマンティクス（アプリがフォアグラウンドの間に
 * 条件をチェックして発火。バックグラウンド配信は行わない）を保つ。
 * 定時のバックグラウンド通知は「全習慣達成済みでも固定文言が届く」虚偽通知に
 * なるため意図的に採用していない。
 *
 * expo-notifications / react-native をimportするため、既存の慣例に従い
 * platform配下に分離している（ストア・coreはこのモジュールに依存しない）。
 */
import { AppState, type AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
    buildHabitReminderNotification,
    buildTaskDeadlineNotification,
    NOTIFICATION_CONFIG,
    selectDueSoonTasks,
    shouldSendHabitReminder,
    type NotificationContent,
} from '@life-quest/core/notifications';
import { areAllHabitsComplete, isRestDayOn } from '@life-quest/core/habits';
import { getJstHour, getTodayJst } from '../utils/date';
import { useMobileHabitStore } from '../stores/useMobileHabitStore';
import { useMobileSettingsStore } from '../stores/useMobileSettingsStore';
import { useMobileTaskStore } from '../stores/useMobileTaskStore';

let isRunningChecks = false;

/** フォアグラウンドでも通知バナーを表示する（既定は非表示）。起動時に一度呼ぶ。 */
export function configureNotificationHandler(): void {
    Notifications.setNotificationHandler({
        handleNotification: async () => ({
            shouldShowBanner: true,
            shouldShowList: true,
            shouldPlaySound: false,
            shouldSetBadge: false,
        }),
    });
}

/** 通知許可を確認し、未確定なら要求する。granted なら true。 */
export async function ensureNotificationPermission(): Promise<boolean> {
    try {
        const current = await Notifications.getPermissionsAsync();
        if (current.granted) return true;
        if (!current.canAskAgain) return false;
        const requested = await Notifications.requestPermissionsAsync();
        return requested.granted;
    } catch {
        return false;
    }
}

async function hasNotificationPermission(): Promise<boolean> {
    try {
        return (await Notifications.getPermissionsAsync()).granted;
    } catch {
        return false;
    }
}

async function presentNotification(content: NotificationContent): Promise<boolean> {
    try {
        await Notifications.scheduleNotificationAsync({
            identifier: content.tag, // 同一タグは上書きされ、重複表示を防ぐ
            content: { title: content.title, body: content.body },
            trigger: null, // 即時表示
        });
        return true;
    } catch {
        // 失敗時は既通知マークを付けず、次回チェックで再試行させる
        return false;
    }
}

/** 指定日に未完了の習慣の件数を返す（Web countIncompleteHabits と同一計算）。 */
function countIncompleteHabits(date: string): number {
    const { habits, records } = useMobileHabitStore.getState();
    return habits.filter(
        (habit) => !records.some((r) => r.habitId === habit.id && r.date === date && r.completed)
    ).length;
}

/**
 * 通知すべき条件をチェックして、該当すれば通知を出す。
 * アプリ起動時・フォアグラウンド復帰時・一定間隔で呼び出す。
 */
export async function runMobileNotificationChecks(): Promise<void> {
    if (isRunningChecks) return;
    isRunningChecks = true;

    try {
        const settings = useMobileSettingsStore.getState();
        if (!settings.notificationsEnabled) return;
        if (!(await hasNotificationPermission())) return;

        const tasks = useMobileTaskStore.getState().tasks;
        // 削除済みタスクのIDを通知履歴から掃除
        settings.pruneNotifiedTasks(tasks.map((task) => task.id));

        // ── タスク期限の通知（期限の24時間前以降、未完了、未通知のもの）──
        const dueSoonTasks = selectDueSoonTasks(tasks, {
            nowMs: Date.now(),
            notifiedTaskIds: useMobileSettingsStore.getState().notifiedTaskIds,
        });
        for (const task of dueSoonTasks) {
            const delivered = await presentNotification(buildTaskDeadlineNotification(task));
            if (delivered) useMobileSettingsStore.getState().markTaskNotified(task.id);
        }

        // ── 習慣リマインダー（指定時刻以降、未完了の習慣がある、本日未通知）──
        const today = getTodayJst();
        const send = shouldSendHabitReminder({
            today,
            lastReminderDate: useMobileSettingsStore.getState().lastHabitReminderDate,
            currentHour: getJstHour(),
            reminderHour: useMobileSettingsStore.getState().habitReminderHour,
        });
        if (send) {
            const { habits, records, restDays } = useMobileHabitStore.getState();
            if (
                habits.length > 0 &&
                !isRestDayOn(restDays, today) &&
                !areAllHabitsComplete(habits, records, today)
            ) {
                const incompleteCount = countIncompleteHabits(today);
                const delivered = await presentNotification(
                    buildHabitReminderNotification(incompleteCount, today)
                );
                if (delivered) useMobileSettingsStore.getState().markHabitReminded(today);
            }
        }
    } finally {
        isRunningChecks = false;
    }
}

/**
 * 通知チェックの定期実行を開始する。アプリ起動時に一度だけ呼ぶ。
 * 起動直後・フォアグラウンド復帰時・CHECK_INTERVAL_MS間隔でチェックする。
 * 戻り値で解除できる。
 */
export function registerNotificationChecks(): () => void {
    configureNotificationHandler();
    void runMobileNotificationChecks();

    const interval = setInterval(() => {
        void runMobileNotificationChecks();
    }, NOTIFICATION_CONFIG.CHECK_INTERVAL_MS);

    const onChange = (state: AppStateStatus): void => {
        if (state === 'active') void runMobileNotificationChecks();
    };
    const subscription = AppState.addEventListener('change', onChange);

    return () => {
        clearInterval(interval);
        subscription.remove();
    };
}
