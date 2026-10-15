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
import type { StoreApi, UseBoundStore } from 'zustand';
import { captureAuthSessionGuard, captureAuthSessionScope, registerAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { preMigrationBackupKey } from '@life-quest/core/cloudImport';
import { loadCloudCache, type CloudCache } from '@life-quest/core/cloudCache';
import { sanitizeHabitCollection, sanitizeHabitRecords, type Habit, type HabitDailyRecord } from '@life-quest/core/habits';
import { sanitizeTaskCollection, type Task } from '@life-quest/core/tasks';
import { EdgeFunctionError } from '@life-quest/core/edgeFunctions';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { useMobileHabitStore } from '../stores/useMobileHabitStore';
import { useMobileTaskStore } from '../stores/useMobileTaskStore';
import { createMobileId } from '../utils/createMobileId';

/**
 * hydration完了まで待ってから解決する。zustand persistのonRehydrateStorageが
 * hasHydrated=true を立てる前に読むと、空のtasks/habitsや初期game状態を
 * バックアップとして確定させてしまい（以後上書きしないため）本来のローカル
 * データを永久に失う。安全側として上限（既定10秒）を設け、それでも
 * hydrateしなければ警告を出して次回ログイン時の再試行に委ねる（保存しない）。
 */
function waitForHydration(
    store: UseBoundStore<StoreApi<{ hasHydrated: boolean }>>,
    timeoutMs = 10_000,
): Promise<boolean> {
    if (store.getState().hasHydrated) return Promise.resolve(true);
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            unsubscribe();
            resolve(false);
        }, timeoutMs);
        const unsubscribe = store.subscribe((state) => {
            if (!state.hasHydrated) return;
            clearTimeout(timer);
            unsubscribe();
            resolve(true);
        });
    });
}

/** 3ストア全てのhydration完了を待つ。いずれかがタイムアウトしたらfalse。 */
async function waitForAllStoresHydrated(timeoutMs?: number): Promise<boolean> {
    const results = await Promise.all([
        waitForHydration(useMobileTaskStore, timeoutMs),
        waitForHydration(useMobileHabitStore, timeoutMs),
        waitForHydration(useMobileGameStore, timeoutMs),
    ]);
    return results.every(Boolean);
}

interface BackupAttempt {
    isCurrent: () => boolean;
    promise: Promise<void>;
}
const backupAttempts = new Map<string, BackupAttempt>();

/**
 * ローカル全状態を初回のみ保存する。同じ認証スコープの重複通知は待機を共有する。
 * 3ストアのhydration完了前に空データを確定保存せず、スコープが変わったら保存しない。
 * timeoutMs（既定10秒）を超えた場合は未保存のまま次回ログインの再試行へ委ねる。
 */
export function ensurePreMigrationBackup(userId: string, timeoutMs?: number): Promise<void> {
    const pending = backupAttempts.get(userId);
    if (pending?.isCurrent()) return pending.promise;
    const attempt: BackupAttempt = { isCurrent: captureAuthSessionGuard(), promise: Promise.resolve() };
    backupAttempts.set(userId, attempt);
    attempt.promise = savePreMigrationBackup(userId, attempt.isCurrent, timeoutMs).finally(() => {
        if (backupAttempts.get(userId) === attempt) backupAttempts.delete(userId);
    });
    return attempt.promise;
}

async function savePreMigrationBackup(userId: string, isCurrent: () => boolean, timeoutMs?: number): Promise<void> {
    const key = preMigrationBackupKey(userId);
    const existing = await AsyncStorage.getItem(key);
    if (!isCurrent() || existing !== null) return; // 初回のみ。既存バックアップは上書きしない

    const hydrated = await waitForAllStoresHydrated(timeoutMs);
    if (!isCurrent()) return;
    if (!hydrated) {
        console.warn('pre-migration backup skipped: stores did not hydrate in time (will retry next login)');
        return;
    }

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
export function detectPendingMobileContent(cache: CloudCache, source: PendingMobileContent = {
    tasks: useMobileTaskStore.getState().tasks, habits: useMobileHabitStore.getState().habits,
    dailyRecords: useMobileHabitStore.getState().records,
}): PendingMobileContent {
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

    const tasks = source.tasks.filter((task) => !cloudTaskIds.has(task.id));
    const habits = source.habits.filter((habit) => !cloudHabitIds.has(habit.id));
    const pendingHabitIds = new Set(habits.map((habit) => habit.id));
    const dailyRecords = source.dailyRecords
        .filter((record) => pendingHabitIds.has(record.habitId));

    return { tasks, habits, dailyRecords };
}

/** ログイン中ユーザーの未統合コンテンツを取得する（確認UI用）。 */
export async function getPendingMobileContent(userId: string): Promise<PendingMobileContent> {
    const scope = captureAuthSessionScope();
    if (scope.userId !== userId) throw staleImport();
    await assertImportUser(userId, scope.isCurrent);
    const cache = await loadCloudCache(AsyncStorage, userId);
    if (!scope.isCurrent()) throw staleImport();
    const raw = await AsyncStorage.getItem(preMigrationBackupKey(userId));
    if (!scope.isCurrent()) throw staleImport();
    let backup: PendingMobileContent = { tasks: [], habits: [], dailyRecords: [] };
    if (raw !== null) {
        const parsed = JSON.parse(raw) as Record<string, unknown> | null;
        if (!parsed || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.habits) || !Array.isArray(parsed.dailyRecords)) {
            throw new Error('端末バックアップの形式を確認できません。バックアップは削除せず保持しています。');
        }
        const habits = sanitizeHabitCollection(parsed.habits);
        backup = { tasks: sanitizeTaskCollection(parsed.tasks), habits,
            dailyRecords: sanitizeHabitRecords(parsed.dailyRecords, new Set(habits.map((habit) => habit.id))) };
    }
    await assertImportUser(userId, scope.isCurrent);
    // Live edits win over the older backup, while cloud IDs/client_ids (including
    // tombstones) are still excluded by the detector. Backups are never modified.
    const tasks = [...new Map([...backup.tasks, ...useMobileTaskStore.getState().tasks].map((task) => [task.id, task])).values()];
    const habits = [...new Map([...backup.habits, ...useMobileHabitStore.getState().habits].map((habit) => [habit.id, habit])).values()];
    const dailyRecords = [...new Map([...backup.dailyRecords, ...useMobileHabitStore.getState().records]
        .map((record) => [JSON.stringify([record.habitId, record.date]), record])).values()];
    const payload = JSON.stringify(detectPendingMobileContent(cache, { tasks, habits, dailyRecords }));
    const content = JSON.parse(payload) as PendingMobileContent;
    issuedImports.set(content, { userId, isCurrent: scope.isCurrent, payload, key: createMobileId(), promise: null });
    return content;
}

export type MobileImportResult =
    | { status: 'imported' }
    | { status: 'stale' }
    | { status: 'web_migration_required' }
    | { status: 'error'; message: string };

interface IssuedImport {
    userId: string;
    isCurrent: () => boolean;
    payload: string;
    key: string;
    promise: Promise<MobileImportResult> | null;
}
const issuedImports = new WeakMap<PendingMobileContent, IssuedImport>();
const staleImport = () => new EdgeFunctionError('stale-session', 'アカウントが切り替わりました。統合候補を再確認してください。');

async function assertImportUser(userId: string, isCurrent: () => boolean): Promise<void> {
    const { getCurrentUser } = await import('./auth');
    if (!isCurrent()) throw staleImport();
    const user = await getCurrentUser();
    if (!isCurrent() || user?.userId !== userId) throw staleImport();
}

/**
 * 確認UIで承認されたコンテンツをクラウドへ統合する（フローB・コンテンツ）。
 * Web初回移行が未完了なら web_migration_required を返し、UIはWebへ誘導する。
 */
export function approveMobileContentImport(content: PendingMobileContent): Promise<MobileImportResult> {
    const issued = issuedImports.get(content);
    if (!issued?.isCurrent()) return Promise.resolve({ status: 'stale' });
    if (issued.promise) return issued.promise;
    const run = async (): Promise<MobileImportResult> => {
        try {
            await assertImportUser(issued.userId, issued.isCurrent);
            const { getMobileEdgeFunctionInvoker } = await import('./edgeFunctions');
            if (!issued.isCurrent()) return { status: 'stale' };
            const invoker = getMobileEdgeFunctionInvoker();
            if (!invoker) return { status: 'error', message: 'クラウド接続が設定されていません' };
            await invoker('import_mobile_content', { content: JSON.parse(issued.payload), idempotencyKey: issued.key },
                { isActive: issued.isCurrent, expectedUserId: issued.userId });
            await assertImportUser(issued.userId, issued.isCurrent);
            return { status: 'imported' };
        } catch (error) {
            if (!issued.isCurrent() || (error instanceof EdgeFunctionError && error.code === 'stale-session')) return { status: 'stale' };
            if (error instanceof EdgeFunctionError && error.message.includes('web_migration_required')) return { status: 'web_migration_required' };
            return { status: 'error', message: error instanceof Error ? error.message : '統合に失敗しました' };
        }
    };
    issued.promise = run().then((result) => {
        if (result.status !== 'imported') issued.promise = null;
        return result;
    });
    return issued.promise;
}

/**
 * 認証ライフサイクルへフローB（バックアップ）を配線する。
 * cloudSyncフックより先に登録し、プルによる置換の前にバックアップを確定させる。
 */
export function registerMobileCloudMigrationHooks(): () => void {
    return registerAuthLifecycleHooks({
        onLogin: async (userId) => {
            const isCurrent = captureAuthSessionGuard();
            try {
                await ensurePreMigrationBackup(userId);
            } catch (error) {
                if (isCurrent()) console.warn('pre-migration backup failed', error);
            }
        },
    });
}
