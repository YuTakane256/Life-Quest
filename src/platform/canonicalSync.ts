/**
 * Webストアと canonical Repository の同期ブリッジ。
 *
 * 読み取り（起動時シード）:
 * 起動時に #482 の移行サービスで旧データを canonical へ取り込んだ後、
 * canonical が ready のセクションはその内容でストアをシードする。
 * canonical が唯一の真実であり、将来クラウド同期で他端末の変更が
 * canonical に届いたときも同じ経路でストアへ反映される。
 * 通常運用では canonical はdual-writeで常にストアと同内容なので、
 * シードは見た目上の無変化（差分があるときだけ canonical が勝つ）。
 *
 * 書き戻し（write-through）:
 * ストア変更を購読して canonical を最新に保つ。**シードが完了するまで
 * そのセクションの書き戻しは行わない**（未シードのストア内容で canonical を
 * 上書きしない）。旧 `quest-board-*` キーの読み書きは従来どおり Zustand persist
 * が行い、バックアップとして残る。
 */
import { createSyncCursor, writeCanonicalSnapshot, type CanonicalWriteResult } from '@life-quest/core/canonicalSync';
import { XP_CONFIG } from '@life-quest/core/progression';
import {
    convertLegacyGameSnapshot,
    convertLegacyHabitSnapshot,
    convertLegacyTaskSnapshot,
    type CanonicalGameSnapshot,
    type CanonicalHabitSnapshot,
    type CanonicalTaskSnapshot,
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

const SECTIONS: readonly CanonicalSyncSection[] = ['tasks', 'habits', 'game'];

export type CanonicalSyncResults = Partial<Record<CanonicalSyncSection, CanonicalWriteResult>>;

export interface CanonicalSyncHandle {
    /** 起動時の移行・シード・初期同期の完了を待つ（失敗しても例外にしない） */
    ready: Promise<void>;
    /** シード済みセクションを即座に書き戻す（テスト・明示フラッシュ用） */
    flush: () => Promise<CanonicalSyncResults>;
    /** 購読を解除する */
    stop: () => void;
}

/** canonical のタスクスナップショットをストアへ反映する（クラウド同期 #504 も同じ経路を使う） */
export function seedTasks(snapshot: CanonicalTaskSnapshot): void {
    useTaskStore.setState({ tasks: snapshot.tasks });
}

/** canonical の習慣スナップショットをストアへ反映する */
export function seedHabits(snapshot: CanonicalHabitSnapshot): void {
    useHabitStore.setState({
        habits: snapshot.habits,
        dailyRecords: snapshot.dailyRecords,
        restDays: snapshot.restDays,
        allCompleteRewardDates: snapshot.allCompleteDates,
    });
}

/**
 * canonical のゲームスナップショットをストアへ反映する。
 * バトルは進行度（unlocked / currentStage / maxClearedStage）のみ上書きし、
 * 戦闘中の一時状態（敵HP・ログ・クールダウン）は canonical 契約に無いため保持する。
 */
export function seedGame(snapshot: CanonicalGameSnapshot): void {
    useGameStore.setState((state) => ({
        character: snapshot.character,
        debuff: {
            active: snapshot.debuff.active,
            expiresAt: snapshot.debuff.expiresAt,
            multiplier: snapshot.debuff.active ? XP_CONFIG.DEBUFF_XP_MULTIPLIER : 1,
        },
        equipment: snapshot.equipment,
        gachaCount: snapshot.gachaCount,
        chestQueue: snapshot.chestQueue,
        battle: {
            ...state.battle,
            battleUnlocked: snapshot.battleProgress.battleUnlocked,
            currentStage: snapshot.battleProgress.currentStage,
            maxClearedStage: snapshot.battleProgress.maxClearedStage,
        },
    }));
    useTitleStore.setState({ activeTitle: snapshot.activeTitle });
}

/**
 * Webの canonical 同期（起動時シード + write-through）を開始する。アプリで一度だけ呼ぶ。
 */
export function startWebCanonicalSync(
    storage: RepositoryStorage = getPlatformStorageAdapter(),
): CanonicalSyncHandle {
    const repositories = createWebCanonicalRepositories(storage);
    const cursor = createSyncCursor(storage);

    // シード完了までそのセクションの書き戻しを解禁しない
    const seeded = new Set<CanonicalSyncSection>();

    const seedSection = async (section: CanonicalSyncSection): Promise<void> => {
        if (seeded.has(section)) return;
        const current = await repositories[section].load();
        if (current.status === 'ready') {
            // このデバイスが確認済みのrevisionのままなら canonical に新情報はない。
            // ローカルの方が新しい可能性がある（canonical書き込みだけ失敗した
            // クラッシュ窓）ため、シードせず write-back に追い付かせる。
            const seen = await cursor.readSeenRevision(section);
            if (current.value.revision !== seen) {
                if (section === 'tasks') seedTasks(current.value.data as CanonicalTaskSnapshot);
                else if (section === 'habits') seedHabits(current.value.data as CanonicalHabitSnapshot);
                else seedGame(current.value.data as CanonicalGameSnapshot);
                await cursor.recordSeenRevision(section, current.value.revision);
            }
        }
        // empty はシード対象なし、corrupt / unsupported / storage-error は
        // legacyデータのまま動作を続ける。いずれも書き戻しは解禁する
        // （安全でないスロットへの書き込みは writeCanonicalSnapshot 側が拒否する）。
        seeded.add(section);
    };

    const syncNow = async (): Promise<CanonicalSyncResults> => {
        const results: CanonicalSyncResults = {};
        const taskState = useTaskStore.getState();
        const habitState = useHabitStore.getState();

        const tasksSource = { tasks: taskState.tasks };
        const habitsSource = {
            habits: habitState.habits,
            dailyRecords: habitState.dailyRecords,
            restDays: habitState.restDays,
            allCompleteRewardDates: habitState.allCompleteRewardDates,
        };

        if (seeded.has('tasks')) {
            results.tasks = await writeCanonicalSnapshot(
                repositories.tasks,
                convertLegacyTaskSnapshot(tasksSource),
            );
            if (results.tasks.revision !== undefined) {
                await cursor.recordSeenRevision('tasks', results.tasks.revision);
            }
        }
        if (seeded.has('habits')) {
            results.habits = await writeCanonicalSnapshot(
                repositories.habits,
                convertLegacyHabitSnapshot(habitsSource),
            );
            if (results.habits.revision !== undefined) {
                await cursor.recordSeenRevision('habits', results.habits.revision);
            }
        }
        if (seeded.has('game')) {
            const gameState = useGameStore.getState();
            const titleState = useTitleStore.getState();
            // Webのゲームストアは報酬台帳を持たないため、canonical上の既存台帳を
            // 引き継いだ上で完了済みタスク・習慣を証跡としてマージする（単調増加）。
            const currentGame = await repositories.game.load();
            const currentLedger = currentGame.status === 'ready'
                ? currentGame.value.data.rewardLedger
                : undefined;
            results.game = await writeCanonicalSnapshot(repositories.game, convertLegacyGameSnapshot({
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
            }));
            if (results.game.revision !== undefined) {
                await cursor.recordSeenRevision('game', results.game.revision);
            }
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
        useTaskStore.subscribe(requestSync),
        useHabitStore.subscribe(requestSync),
        useGameStore.subscribe(requestSync),
        useTitleStore.subscribe(requestSync),
    ];

    const ready = (async () => {
        try {
            await migrateWebLegacyData(storage);
            for (const section of SECTIONS) {
                await seedSection(section);
            }
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
