/**
 * Mobileの初回クラウド接続（#506 フローB / ADR-011）。
 *
 * ゲーム状態: ログイン時にローカルのゲーム状態・コンテンツ全体を
 * pre-migration-backup キーへ保存してから、通常のプル（#504）が
 * クラウド（Web由来）の値でストアを置換する。バックアップは削除しない
 * （退会時のみ削除、#516）。サーバーへは一切送信しない。
 *
 * コンテンツ: クラウド側に存在しないローカルのタスク・習慣を検出し、
 * 確認UI（SettingsScreen）で承認されたものだけを import_mobile_content で統合する。
 * 自動統合はしない。未承認の項目はバックアップに残り続ける。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { preMigrationBackupKey } from '@life-quest/core/cloudImport';
import { loadCloudCache, type CloudCache } from '@life-quest/core/cloudCache';
import type { Habit, HabitDailyRecord } from '@life-quest/core/habits';
import type { Task } from '@life-quest/core/tasks';
import { EdgeFunctionError } from '@life-quest/core/edgeFunctions';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { useMobileHabitStore } from '../stores/useMobileHabitStore';
import { useMobileTaskStore } from '../stores/useMobileTaskStore';

/** ローカル全状態のバックアップを（未保存の場合のみ）保存する。 */
export async function ensurePreMigrationBackup(userId: string): Promise<void> {
    const key = preMigrationBackupKey(userId);
    const existing = await AsyncStorage.getItem(key);
    if (existing !== null) return; // 初回のみ。既存バックアップは上書きしない

    const game = useMobileGameStore.getState();
    const tasks = useMobileTaskStore.getState();
    const habits = useMobileHabitStore.getState();
    const backup = {
        savedAt: new Date().toISOString(),
        game: {
            character: game.character,
            equipment: game.equipment,
            chestQueue: game.chestQueue,
            gachaCount: game.gachaCount,
            rewardLedger: game.rewardLedger,
        },
        tasks: tasks.tasks,
        habits: habits.habits,
        dailyRecords: habits.records,
        restDays: habits.restDays,
        allCompleteDates: habits.rewardEligibleDates,
    };
    await AsyncStorage.setItem(key, JSON.stringify(backup));
}

export interface PendingMobileContent {
    tasks: Task[];
    habits: Habit[];
    dailyRecords: HabitDailyRecord[];
}

/**
 * クラウド側にまだ存在しないローカルのタスク・習慣を検出する。
 * クラウドの実ID（uuid）と client_id（取り込み元のローカルID）の両方と照合する。
 */
export function detectPendingMobileContent(cache: CloudCache): PendingMobileContent {
    const cloudTaskIds = new Set<string>();
    for (const row of Object.values(cache.tasks)) {
        if (typeof row.id === 'string') cloudTaskIds.add(row.id);
        if (typeof row.client_id === 'string') cloudTaskIds.add(row.client_id);
    }
    const cloudHabitIds = new Set<string>();
    for (const row of Object.values(cache.habits)) {
        if (typeof row.id === 'string') cloudHabitIds.add(row.id);
        if (typeof row.client_id === 'string') cloudHabitIds.add(row.client_id);
    }

    const tasks = useMobileTaskStore.getState().tasks.filter((task) => !cloudTaskIds.has(task.id));
    const habits = useMobileHabitStore.getState().habits.filter((habit) => !cloudHabitIds.has(habit.id));
    const pendingHabitIds = new Set(habits.map((habit) => habit.id));
    const dailyRecords = useMobileHabitStore.getState().records
        .filter((record) => pendingHabitIds.has(record.habitId));

    return { tasks, habits, dailyRecords };
}

/** ログイン中ユーザーの未統合コンテンツを取得する（確認UI用）。 */
export async function getPendingMobileContent(userId: string): Promise<PendingMobileContent> {
    const cache = await loadCloudCache(AsyncStorage, userId);
    return detectPendingMobileContent(cache);
}

export type MobileImportResult =
    | { status: 'imported' }
    | { status: 'web_migration_required' }
    | { status: 'error'; message: string };

/**
 * 確認UIで承認されたコンテンツをクラウドへ統合する（フローB・コンテンツ）。
 * Web初回移行が未完了なら web_migration_required を返し、UIはWebへ誘導する。
 */
export async function approveMobileContentImport(content: PendingMobileContent): Promise<MobileImportResult> {
    const { getMobileEdgeFunctionInvoker } = await import('./edgeFunctions');
    const invoker = getMobileEdgeFunctionInvoker();
    if (!invoker) return { status: 'error', message: 'クラウド接続が設定されていません' };

    try {
        await invoker('import_mobile_content', {
            content: {
                tasks: content.tasks,
                habits: content.habits,
                dailyRecords: content.dailyRecords,
            },
            idempotencyKey: crypto.randomUUID(),
        });
        return { status: 'imported' };
    } catch (error) {
        if (error instanceof EdgeFunctionError && error.message.includes('web_migration_required')) {
            return { status: 'web_migration_required' };
        }
        return { status: 'error', message: error instanceof Error ? error.message : '統合に失敗しました' };
    }
}

/**
 * 認証ライフサイクルへフローB（バックアップ）を配線する。
 * cloudSyncフックより先に登録し、プルによる置換の前にバックアップを確定させる。
 */
export function registerMobileCloudMigrationHooks(): () => void {
    return registerAuthLifecycleHooks({
        onLogin: async (userId) => {
            try {
                await ensurePreMigrationBackup(userId);
            } catch (error) {
                console.warn('pre-migration backup failed', error);
            }
        },
    });
}
