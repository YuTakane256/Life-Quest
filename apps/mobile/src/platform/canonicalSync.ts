/**
 * Mobileストアの変更を canonical Repository へ書き戻す（write-through）ブリッジ。
 *
 * 起動時に #482 の移行サービスで旧データを canonical へ取り込み、以降は
 * tasks / habits / game ストアの変更を購読して canonical を最新に保つ。
 * AsyncStorage の hydration は非同期なので、各ストアの hasHydrated が立つまで
 * そのセクションは同期しない（未復元の空状態で canonical を上書きしない）。
 * 旧 `quest-board-*` キーの読み書きは従来どおり Zustand persist が行う（dual-write）。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { writeCanonicalSnapshot, type CanonicalWriteResult } from '@life-quest/core/canonicalSync';
import {
    convertLegacyGameSnapshot,
    convertLegacyHabitSnapshot,
    convertLegacyTaskSnapshot,
} from '@life-quest/core/syncSnapshots';
import type { RepositoryStorage } from '@life-quest/core/syncRepository';
import { createMobileCanonicalRepositories } from './canonicalRepositories';
import { migrateMobileLegacyData } from './legacyMigration';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { useMobileHabitStore } from '../stores/useMobileHabitStore';
import { useMobileTaskStore } from '../stores/useMobileTaskStore';

export type CanonicalSyncSection = 'tasks' | 'habits' | 'game';

export type CanonicalSyncResults = Partial<Record<CanonicalSyncSection, CanonicalWriteResult>>;

export interface CanonicalSyncHandle {
    /** 起動時の移行と初期同期の完了を待つ（失敗しても例外にしない） */
    ready: Promise<void>;
    /** hydration済みセクションを即座に同期する（テスト・明示フラッシュ用） */
    flush: () => Promise<CanonicalSyncResults>;
    /** 購読を解除する */
    stop: () => void;
}

/**
 * Mobileの canonical write-through を開始する。アプリで一度だけ呼ぶ。
 */
export function startMobileCanonicalSync(
    storage: RepositoryStorage = AsyncStorage,
): CanonicalSyncHandle {
    const repositories = createMobileCanonicalRepositories(storage);

    const syncNow = async (): Promise<CanonicalSyncResults> => {
        const taskState = useMobileTaskStore.getState();
        const habitState = useMobileHabitStore.getState();
        const gameState = useMobileGameStore.getState();

        const tasksSource = taskState.hasHydrated ? { tasks: taskState.tasks } : undefined;
        const habitsSource = habitState.hasHydrated
            ? {
                habits: habitState.habits,
                records: habitState.records,
                rewardEligibleDates: habitState.rewardEligibleDates,
            }
            : undefined;

        const results: CanonicalSyncResults = {};

        if (tasksSource) {
            results.tasks = await writeCanonicalSnapshot(
                repositories.tasks,
                convertLegacyTaskSnapshot(tasksSource),
            );
        }
        if (habitsSource) {
            results.habits = await writeCanonicalSnapshot(
                repositories.habits,
                convertLegacyHabitSnapshot(habitsSource),
            );
        }
        if (gameState.hasHydrated) {
            // canonical上の既存台帳とストアの台帳を連結して渡す（converterがdedupする）。
            // 将来クラウド同期でcanonical側にだけ証跡がある場合も失われない。
            const currentGame = await repositories.game.load();
            const canonicalLedger = currentGame.status === 'ready'
                ? currentGame.value.data.rewardLedger
                : { rewardedTaskIds: [], rewardedSubtaskIds: [], habitBonusDates: [] };
            results.game = await writeCanonicalSnapshot(repositories.game, convertLegacyGameSnapshot({
                game: {
                    character: gameState.character,
                    equipment: gameState.equipment,
                    chestQueue: gameState.chestQueue,
                    gachaCount: gameState.gachaCount,
                    rewardLedger: {
                        rewardedTaskIds: [
                            ...canonicalLedger.rewardedTaskIds,
                            ...gameState.rewardLedger.rewardedTaskIds,
                        ],
                        rewardedSubtaskIds: [
                            ...canonicalLedger.rewardedSubtaskIds,
                            ...gameState.rewardLedger.rewardedSubtaskIds,
                        ],
                        habitBonusDates: [
                            ...canonicalLedger.habitBonusDates,
                            ...gameState.rewardLedger.habitBonusDates,
                        ],
                    },
                },
                tasks: tasksSource,
                habits: habitsSource,
            }));
        }
        return results;
    };

    // ストアのsetごとに同期をコアレスして直列実行する
    let running = false;
    let dirty = false;
    const requestSync = (): void => {
        dirty = true;
        if (running) return;
        running = true;
        void (async () => {
            try {
                while (dirty) {
                    dirty = false;
                    await syncNow();
                }
            } finally {
                running = false;
            }
        })();
    };

    const unsubscribes = [
        useMobileTaskStore.subscribe(requestSync),
        useMobileHabitStore.subscribe(requestSync),
        useMobileGameStore.subscribe(requestSync),
    ];

    const ready = (async () => {
        try {
            await migrateMobileLegacyData(storage);
            await syncNow();
        } catch (error) {
            console.warn('canonical sync init failed', error);
        }
    })();

    return {
        ready,
        flush: syncNow,
        stop: () => unsubscribes.forEach((unsubscribe) => unsubscribe()),
    };
}
