/**
 * タスク・習慣ストアとゲームストアは別々のAsyncStorageキーに永続化されるため、
 * 「タスクは完了として保存されたが、報酬（ゲームストア）の保存が失敗した」
 * という分離が起こり得る。このモジュールはその隙間を埋める再照合レイヤー。
 *
 * 仕組み:
 * - 報酬の受給資格は永続化されたドメイン状態（完了済みタスク・習慣レコード）から
 *   いつでも再導出できる。
 * - 冪等性はゲームストアの報酬台帳（rewardLedger）が保証するので、
 *   再照合は「完了済みだが台帳に無い」ものだけを付与し、何度実行しても安全。
 * - 各ストアのhydration完了を購読し、揃った時点で再照合する（eventual consistency）。
 *   hydration前のtoggleはゲームストア側でno-opになるが（useMobileGameStore参照）、
 *   ドメイン状態には残るため、ここで拾い直される。
 */
import { areAllHabitsComplete } from '@life-quest/core/habits';
import { getGameRewardAuthorityState, subscribeGameRewardAuthority } from '@life-quest/core/gameRewardAuthority';
import { getTodayJst } from '../utils/date';
import { enqueueCloudOperation } from '../platform/cloudOutbox';
import {
    getPendingRewardOperations,
    removePendingRewardOperation,
    consumeAnonymousRecoverySuppression,
} from '../platform/pendingRewardOperations';
import { useMobileGameStore } from './useMobileGameStore';
import { useMobileHabitStore } from './useMobileHabitStore';
import { useMobileTaskStore } from './useMobileTaskStore';

/**
 * 完了済みタスクと今日の習慣全達成を報酬台帳と突き合わせ、
 * 未付与の報酬を付与する。冪等（何度呼んでも二重付与しない）。
 */
export function reconcileRewards(today: string = getTodayJst()): void {
    const game = useMobileGameStore.getState();
    if (!game.hasHydrated) return;

    // 認証復元中は「報酬未確定」を保つ。authenticated/anonymous確定の購読で
    // 同じ完了状態をもう一度読むため、ユーザー操作を失わず二重付与もしない。
    const authority = getGameRewardAuthorityState();
    if (authority === 'resolving') return;

    const taskState = useMobileTaskStore.getState();
    if (taskState.hasHydrated && authority === 'anonymous') {
        for (const task of taskState.tasks) {
            if (task.completed) {
                game.grantTaskCompletionReward(task.id, task.priority);
            }
            for (const subtask of task.subtasks) {
                if (subtask.completed) {
                    game.grantSubtaskCompletionReward(subtask.id, task.priority);
                }
            }
        }
    }

    const habitState = useMobileHabitStore.getState();
    if (habitState.hasHydrated) {
        for (const date of habitState.rewardEligibleDates) {
            game.grantHabitAllCompleteBonus(date);
        }

        // 旧スキーマに受給資格が無い場合も、今日の全達成は従来通り回収する。
        if (areAllHabitsComplete(habitState.habits, habitState.records, today)) {
            game.grantHabitAllCompleteBonus(today);
        }
    }
}

/**
 * 各ストアのhydration完了を監視し、揃い次第・以降も揃うたびに再照合を実行する。
 * アプリのルートで一度だけ呼ぶ。テスト用に購読解除関数を返す。
 */
export function startRewardSync(getToday: () => string = getTodayJst): () => void {
    const run = () => reconcileRewards(getToday());

    // すでに全ストアがhydration済みのケース（購読前に完了）を取りこぼさない
    run();

    const unsubscribes = [
        // MobileのRootLayoutではrewardSyncのeffectが認証listenerより先に開始する。
        // initial resolving中に完了した操作のみを確定時に消費し、全履歴は送らない。
        subscribeGameRewardAuthority((authority) => {
            if (authority === 'resolving') return;
            if (authority === 'anonymous' && consumeAnonymousRecoverySuppression()) return;
            const pending = getPendingRewardOperations();
            if (authority === 'authenticated') {
                for (const operation of pending) {
                    const enqueue = operation.kind === 'complete_task'
                        ? enqueueCloudOperation(
                            'complete_task',
                            { taskId: operation.taskId },
                            { dependsOnEntityIds: [operation.taskId] },
                        )
                        : enqueueCloudOperation(
                            'complete_subtask',
                            { subtaskId: operation.subtaskId },
                            { dependsOnEntityIds: [operation.subtaskId, operation.taskId] },
                        );
                    void enqueue.then(async (accepted) => {
                        if (!accepted) return;
                        try {
                            await removePendingRewardOperation(operation);
                        } catch {
                            // 永続化失敗時はメモリ/端末キューに残し、次回再送する。
                        }
                    }).catch(() => undefined);
                }
                return;
            }
            for (const operation of pending) {
                if (operation.kind === 'complete_task') {
                    useMobileTaskStore.getState().recoverDeferredTaskCompletion(operation.taskId);
                } else {
                    useMobileTaskStore.getState().recoverDeferredSubtaskCompletion(operation.taskId, operation.subtaskId);
                }
                void removePendingRewardOperation(operation).catch(() => undefined);
            }
            run();
        }),
        useMobileGameStore.subscribe((state, previous) => {
            if (state.hasHydrated && !previous.hasHydrated) run();
        }),
        useMobileTaskStore.subscribe((state, previous) => {
            if (state.hasHydrated && !previous.hasHydrated) run();
        }),
        useMobileHabitStore.subscribe((state, previous) => {
            if (state.hasHydrated && !previous.hasHydrated) run();
        }),
    ];

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
}
