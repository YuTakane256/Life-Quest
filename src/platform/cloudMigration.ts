/**
 * Webの初回クラウド移行（#506 フローA / ADR-011）。
 *
 * ログイン時に profiles.imported_at を確認し、未移行ならローカルストアの
 * スナップショットを import_snapshot Edge Function へ送る。
 * 初回クラウド移行は必ずWebが基準（platform='web'）。
 * サーバー側が二重取り込みを防止するため、複数タブ・再試行でも安全。
 */
import { captureAuthSessionGuard, registerAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import type { ImportSnapshotInput } from '@life-quest/core/cloudImport';
import { getWebEdgeFunctionInvoker } from './edgeFunctions';
import { getWebSupabaseClient } from './supabase';
import { buildSyncedSettingsPayload } from './settingsSync';
import { useGameStore } from '../stores/useGameStore';
import { useHabitStore } from '../stores/useHabitStore';
import { useStatsStore } from '../stores/useStatsStore';
import { useTaskStore } from '../stores/useTaskStore';
import { useTitleStore } from '../stores/useTitleStore';
import { completionKeysToLedger } from './completionRewards';

/** ローカルストアから移行スナップショットを構築する。 */
export function buildWebImportSnapshot(): ImportSnapshotInput {
    const taskState = useTaskStore.getState();
    const habitState = useHabitStore.getState();
    const gameState = useGameStore.getState();
    const titleState = useTitleStore.getState();
    const statsState = useStatsStore.getState();

    const statsDates = new Set([
        ...Object.keys(statsState.taskXpLog ?? {}),
        ...Object.keys(statsState.habitLog ?? {}),
    ]);

    return {
        tasks: taskState.tasks,
        rewardLedger: completionKeysToLedger(gameState.completionRewardKeys, habitState.allCompleteRewardDates),
        habits: habitState.habits,
        dailyRecords: habitState.dailyRecords,
        restDays: habitState.restDays,
        allCompleteDates: habitState.allCompleteRewardDates,
        statsDaily: [...statsDates].map((date) => ({
            date,
            taskXp: statsState.taskXpLog?.[date] ?? 0,
            habitCount: statsState.habitLog?.[date]?.count ?? 0,
            allComplete: statsState.habitLog?.[date]?.allComplete === true,
        })),
        character: {
            name: gameState.character.name,
            avatar: gameState.character.avatar,
            totalXp: gameState.character.totalXp,
            gachaCount: gameState.gachaCount,
            battleUnlocked: gameState.battle.battleUnlocked,
            currentStage: gameState.battle.currentStage,
            maxClearedStage: gameState.battle.maxClearedStage,
            debuffActive: gameState.debuff.active,
            debuffExpiresAt: gameState.debuff.expiresAt,
        },
        equipment: gameState.equipment.map((item) => ({ templateId: item.templateId, equipped: item.equipped })),
        chestQueue: gameState.chestQueue.map((chest) => ({
            chestType: chest.chestType,
            label: chest.label,
            isStarterCharacter: chest.isStarterCharacter === true,
            opened: chest.opened,
        })),
        activeTitle: titleState.activeTitle,
        settings: buildSyncedSettingsPayload(),
    };
}

interface ImportAttempt {
    userId: string;
    isCurrent: () => boolean;
    promise: Promise<boolean>;
}
let importAttempt: ImportAttempt | null = null;

/** テスト用。 */
export function resetWebCloudImportState(): void {
    importAttempt = null;
}

/**
 * 未移行アカウントならローカルデータをクラウドへ初回移行する。
 * 成否に関わらずアプリの動作は継続する（失敗時は次回ログインで再試行される）。
 * 移行を実行または確認済みなら true を返す。
 */
export function maybeRunWebCloudImport(userId: string): Promise<boolean> {
    // A repeated notification must await the same migration, not let sync overtake it.
    if (importAttempt?.userId === userId && importAttempt.isCurrent()) return importAttempt.promise;
    const client = getWebSupabaseClient();
    const invoker = getWebEdgeFunctionInvoker();
    if (!client || !invoker) return Promise.resolve(false);
    const attempt: ImportAttempt = { userId, isCurrent: captureAuthSessionGuard(), promise: Promise.resolve(false) };
    importAttempt = attempt;
    const isCurrent = (): boolean => importAttempt === attempt && attempt.isCurrent();

    const run = async (): Promise<boolean> => {
        try {
            const { data: profile, error } = await client
                .from('profiles')
                .select('imported_at')
                .eq('user_id', userId)
                .single<{ imported_at: string | null }>();
            if (!isCurrent() || error || !profile) return false;
            if (profile.imported_at !== null) return true; // 移行済み

            await invoker('import_snapshot', {
                platform: 'web',
                snapshot: buildWebImportSnapshot(),
                idempotencyKey: `web-import-${userId}`,
            }, { isActive: isCurrent });
            return isCurrent();
        } catch (error) {
            if (isCurrent()) console.warn('web cloud import failed (will retry next login)', error);
            return false;
        }
    };
    attempt.promise = run().then((succeeded) => {
        // An old failure must not reset the newer user's in-flight/completed attempt.
        if (!succeeded && importAttempt === attempt) importAttempt = null;
        return succeeded;
    });
    return attempt.promise;
}

/**
 * 認証ライフサイクルへ初回移行を配線する。
 * cloudSyncフックより先に登録し、初回移行の完了後に起動プルが走るようにする。
 */
export function registerWebCloudMigrationHooks(): () => void {
    return registerAuthLifecycleHooks({
        onLogin: async (userId) => {
            await maybeRunWebCloudImport(userId);
        },
    });
}
