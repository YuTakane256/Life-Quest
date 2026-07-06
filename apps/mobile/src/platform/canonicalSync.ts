/**
 * Mobileストアと canonical Repository の同期ブリッジ。
 *
 * 読み取り（起動時シード）:
 * 移行（#482）の後、canonical が ready のセクションはその内容でストアをシードする。
 * AsyncStorage の hydration は非同期なので、各ストアの hasHydrated が立ってから
 * シードする（legacy復元 → canonicalシードの順を保証）。canonical が唯一の真実で、
 * 将来クラウド同期で届いた変更も同じ経路でストアへ反映される。
 *
 * 書き戻し（write-through）:
 * ストア変更を購読して canonical を最新に保つ。**シードが完了するまで
 * そのセクションの書き戻しは行わない**（未シード・未復元のストア内容で
 * canonical を上書きしない）。旧 `quest-board-*` キーは従来どおり Zustand persist
 * が読み書きし、バックアップとして残る。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createSyncCursor, writeCanonicalSnapshot, type CanonicalWriteResult } from '@life-quest/core/canonicalSync';
import { sanitizeRewardLedger } from '@life-quest/core/gameState';
import {
    convertLegacyGameSnapshot,
    convertLegacyHabitSnapshot,
    convertLegacyTaskSnapshot,
    type CanonicalGameSnapshot,
    type CanonicalHabitSnapshot,
    type CanonicalTaskSnapshot,
} from '@life-quest/core/syncSnapshots';
import type { RepositoryStorage } from '@life-quest/core/syncRepository';
import { createMobileCanonicalRepositories } from './canonicalRepositories';
import { migrateMobileLegacyData } from './legacyMigration';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { useMobileHabitStore } from '../stores/useMobileHabitStore';
import { useMobileTaskStore } from '../stores/useMobileTaskStore';

export type CanonicalSyncSection = 'tasks' | 'habits' | 'game';

const SECTIONS: readonly CanonicalSyncSection[] = ['tasks', 'habits', 'game'];

export type CanonicalSyncResults = Partial<Record<CanonicalSyncSection, CanonicalWriteResult>>;

export interface CanonicalSyncHandle {
    /** 起動時の移行と初期シード・同期の完了を待つ（失敗しても例外にしない） */
    ready: Promise<void>;
    /** シード済みセクションを即座に書き戻す（テスト・明示フラッシュ用） */
    flush: () => Promise<CanonicalSyncResults>;
    /** 購読を解除する */
    stop: () => void;
}

function isSectionHydrated(section: CanonicalSyncSection): boolean {
    if (section === 'tasks') return useMobileTaskStore.getState().hasHydrated;
    if (section === 'habits') return useMobileHabitStore.getState().hasHydrated;
    return useMobileGameStore.getState().hasHydrated;
}

export function seedSectionData(section: CanonicalSyncSection, data: unknown): void {
    if (section === 'tasks') {
        const snapshot = data as CanonicalTaskSnapshot;
        useMobileTaskStore.setState({ tasks: snapshot.tasks });
        return;
    }
    if (section === 'habits') {
        const snapshot = data as CanonicalHabitSnapshot;
        useMobileHabitStore.setState({
            habits: snapshot.habits,
            records: snapshot.dailyRecords,
            restDays: snapshot.restDays,
            rewardEligibleDates: snapshot.allCompleteDates,
        });
        return;
    }
    const snapshot = data as CanonicalGameSnapshot;
    // 報酬台帳はローカルとcanonicalのunionを取る（証跡は縮めない）。
    // canonical書き込みだけ失敗したクラッシュ窓の付与済み記録が消えて
    // 二重付与になることを防ぐ。sanitizeRewardLedgerがdedupと上限capを行う。
    const localLedger = useMobileGameStore.getState().rewardLedger;
    useMobileGameStore.setState({
        character: snapshot.character,
        equipment: snapshot.equipment,
        chestQueue: snapshot.chestQueue,
        gachaCount: snapshot.gachaCount,
        rewardLedger: sanitizeRewardLedger({
            rewardedTaskIds: [...snapshot.rewardLedger.rewardedTaskIds, ...localLedger.rewardedTaskIds],
            rewardedSubtaskIds: [...snapshot.rewardLedger.rewardedSubtaskIds, ...localLedger.rewardedSubtaskIds],
            habitBonusDates: [...snapshot.rewardLedger.habitBonusDates, ...localLedger.habitBonusDates],
        }),
    });
}

/**
 * Mobileの canonical 同期（起動時シード + write-through）を開始する。アプリで一度だけ呼ぶ。
 */
export function startMobileCanonicalSync(
    storage: RepositoryStorage = AsyncStorage,
): CanonicalSyncHandle {
    const repositories = createMobileCanonicalRepositories(storage);
    const cursor = createSyncCursor(storage);

    // 移行が終わるまでシードしない（シードが移行前の空canonicalを確定させない）
    let migrationDone = false;
    // シード完了までそのセクションの書き戻しを解禁しない
    const seeded = new Set<CanonicalSyncSection>();

    const seedPendingSections = async (): Promise<void> => {
        if (!migrationDone) return;
        for (const section of SECTIONS) {
            if (seeded.has(section) || !isSectionHydrated(section)) continue;
            const current = await repositories[section].load();
            if (current.status === 'ready') {
                // このデバイスが確認済みのrevisionのままなら canonical に新情報はない。
                // ローカルの方が新しい可能性がある（canonical書き込みだけ失敗した
                // クラッシュ窓）ため、シードせず write-back に追い付かせる。
                const seen = await cursor.readSeenRevision(section);
                if (current.value.revision !== seen) {
                    seedSectionData(section, current.value.data);
                    await cursor.recordSeenRevision(section, current.value.revision);
                }
            }
            // empty はシード対象なし、corrupt / unsupported / storage-error は
            // legacyデータのまま動作を続ける。いずれも書き戻しは解禁する
            // （安全でないスロットへの書き込みは writeCanonicalSnapshot 側が拒否する）。
            seeded.add(section);
        }
    };

    const syncNow = async (): Promise<CanonicalSyncResults> => {
        await seedPendingSections();

        const taskState = useMobileTaskStore.getState();
        const habitState = useMobileHabitStore.getState();
        const gameState = useMobileGameStore.getState();

        const tasksSource = seeded.has('tasks') ? { tasks: taskState.tasks } : undefined;
        const habitsSource = seeded.has('habits')
            ? {
                habits: habitState.habits,
                records: habitState.records,
                restDays: habitState.restDays,
                rewardEligibleDates: habitState.rewardEligibleDates,
            }
            : undefined;

        const results: CanonicalSyncResults = {};

        if (tasksSource) {
            results.tasks = await writeCanonicalSnapshot(
                repositories.tasks,
                convertLegacyTaskSnapshot(tasksSource),
            );
            if (results.tasks.revision !== undefined) {
                await cursor.recordSeenRevision('tasks', results.tasks.revision);
            }
        }
        if (habitsSource) {
            results.habits = await writeCanonicalSnapshot(
                repositories.habits,
                convertLegacyHabitSnapshot(habitsSource),
            );
            if (results.habits.revision !== undefined) {
                await cursor.recordSeenRevision('habits', results.habits.revision);
            }
        }
        if (seeded.has('game')) {
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
                    // Mobileが管理しないWeb由来フィールド（称号・デバフ・バトル進行）は
                    // canonicalの現在値をパススルーして既定値で潰さない
                    ...(currentGame.status === 'ready'
                        ? {
                            activeTitle: currentGame.value.data.activeTitle,
                            debuff: currentGame.value.data.debuff,
                            battleProgress: currentGame.value.data.battleProgress,
                        }
                        : {}),
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
        useMobileTaskStore.subscribe(requestSync),
        useMobileHabitStore.subscribe(requestSync),
        useMobileGameStore.subscribe(requestSync),
    ];

    const ready = (async () => {
        try {
            await migrateMobileLegacyData(storage);
            migrationDone = true;
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
