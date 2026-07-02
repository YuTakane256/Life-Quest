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
 *
 * 既知の限界: 習慣の全達成ボーナスは「今日」の日付のみ再照合する。
 * 過去日のボーナスがクラッシュで失われた場合、日付をまたぐと再付与されない
 * （タスク報酬は日付に依存しないため常に再照合される）。
 */
import { areAllHabitsComplete } from '@life-quest/core/habits';
import { getTodayJst } from '../utils/date';
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

    const taskState = useMobileTaskStore.getState();
    if (taskState.hasHydrated) {
        for (const task of taskState.tasks) {
            if (task.completed) {
                game.grantTaskCompletionReward(task.id, task.priority);
            }
        }
    }

    const habitState = useMobileHabitStore.getState();
    if (habitState.hasHydrated && areAllHabitsComplete(habitState.habits, habitState.records, today)) {
        game.grantHabitAllCompleteBonus(today);
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
