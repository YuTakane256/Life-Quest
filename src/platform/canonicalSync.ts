/**
 * Webストアの変更を canonical Repository へ書き戻す（write-through）ブリッジ。
 *
 * 起動時に #482 の移行サービスで旧データを canonical へ取り込み、以降は
 * tasks / habits / game / title ストアの変更を購読して canonical を最新に保つ。
 * 旧 `quest-board-*` キーの読み書きは従来どおり Zustand persist が行い、
 * このブリッジは追加の書き込み先として canonical を維持するだけ（dual-write）。
 * canonical からの読み取り切り替えは次段（Epic #473）。
 */
import { writeCanonicalSnapshot, type CanonicalWriteResult } from '@life-quest/core/canonicalSync';
import {
    convertLegacyGameSnapshot,
    convertLegacyHabitSnapshot,
    convertLegacyTaskSnapshot,
} from '@life-quest/core/syncSnapshots';
import type { RepositoryStorage } from '@life-quest/core/syncRepository';
import { createWebCanonicalRepositories } from './canonicalRepositories';
import { migrateWebLegacyData } from './legacyMigration';
import { getPlatformStorageAdapter } from './storage';
import { useGameStore } from '../stores/useGameStore';
import { useHabitStore } from '../stores/useHabitStore';
import { useTaskStore } from '../stores/useTaskStore';
import { useTitleStore } from '../stores/useTitleStore';

export type CanonicalSyncSection = 'tasks' | 'habits' | 'game';

export type CanonicalSyncResults = Record<CanonicalSyncSection, CanonicalWriteResult>;

export interface CanonicalSyncHandle {
    /** 起動時の移行と初期同期の完了を待つ（失敗しても例外にしない） */
    ready: Promise<void>;
    /** 現在のストア状態を即座に同期する（テスト・明示フラッシュ用） */
    flush: () => Promise<CanonicalSyncResults>;
    /** 購読を解除する */
    stop: () => void;
}

/**
 * Webの canonical write-through を開始する。アプリで一度だけ呼ぶ。
 */
export function startWebCanonicalSync(
    storage: RepositoryStorage = getPlatformStorageAdapter(),
): CanonicalSyncHandle {
    const repositories = createWebCanonicalRepositories(storage);

    const syncNow = async (): Promise<CanonicalSyncResults> => {
        const taskState = useTaskStore.getState();
        const habitState = useHabitStore.getState();
        const gameState = useGameStore.getState();
        const titleState = useTitleStore.getState();

        const tasksSource = { tasks: taskState.tasks };
        const habitsSource = {
            habits: habitState.habits,
            dailyRecords: habitState.dailyRecords,
            restDays: habitState.restDays,
            allCompleteRewardDates: habitState.allCompleteRewardDates,
        };

        // Webのゲームストアは報酬台帳を持たないため、canonical上の既存台帳を
        // 引き継いだ上で完了済みタスク・習慣を証跡としてマージする（単調増加）。
        const currentGame = await repositories.game.load();
        const currentLedger = currentGame.status === 'ready'
            ? currentGame.value.data.rewardLedger
            : undefined;
        const gameSnapshot = convertLegacyGameSnapshot({
            game: {
                character: gameState.character,
                debuff: gameState.debuff,
                equipment: gameState.equipment,
                gachaCount: gameState.gachaCount,
                chestQueue: gameState.chestQueue,
                battle: gameState.battle,
                ...(currentLedger ? { rewardLedger: currentLedger } : {}),
            },
            title: { activeTitle: titleState.activeTitle },
            tasks: tasksSource,
            habits: habitsSource,
        });

        const [tasks, habits, game] = await Promise.all([
            writeCanonicalSnapshot(repositories.tasks, convertLegacyTaskSnapshot(tasksSource)),
            writeCanonicalSnapshot(repositories.habits, convertLegacyHabitSnapshot(habitsSource)),
            writeCanonicalSnapshot(repositories.game, gameSnapshot),
        ]);
        return { tasks, habits, game };
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
        useTaskStore.subscribe(requestSync),
        useHabitStore.subscribe(requestSync),
        useGameStore.subscribe(requestSync),
        useTitleStore.subscribe(requestSync),
    ];

    const ready = (async () => {
        try {
            await migrateWebLegacyData(storage);
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
