/**
 * モバイル版のゲーム状態（キャラクター・装備・宝箱・ガチャ進行・報酬台帳）。
 *
 * ルールと数値はすべて @life-quest/core から取り、このストアは
 * 「coreの純粋関数を状態に適用して永続化する」ことだけに責任を持つ。
 * 報酬台帳をゲーム状態と同じストアに置くことで、XP付与と台帳更新が
 * 単一の保存単位になり、保存失敗・再hydrationでの報酬重複を防ぐ。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    calculateEffectiveEquipmentStats,
    createEquipmentFromTemplate,
    getBestEquipmentIdsBySlot,
    getEquipmentSellXp,
    selectSynthesisIngredients,
    EQUIPMENT_SLOTS,
    type EffectiveStats,
    type Equipment,
} from '@life-quest/core/equipment';
import {
    claimHabitAllCompleteBonus,
    claimTaskReward,
    createInitialGameStateSnapshot,
    sanitizeGameStateSnapshot,
    GAME_STATE_LIMITS,
    capChestQueue,
    capEquipmentCollection,
    type AvatarId,
    type CharacterState,
    type GameStateSnapshot,
    type RewardLedger,
} from '@life-quest/core/gameState';
import { applyCharacterXp, XP_CONFIG, type ApplyCharacterXpResult } from '@life-quest/core/progression';
import type { Priority } from '@life-quest/core/tasks';
import {
    getMilestoneAtCount,
    rollEquipmentTemplate,
    EQUIPMENT_POOL,
    SELL_XP_BY_RARITY,
    SYNTHESIS_CONFIG,
    type ChestReward,
} from '@life-quest/core/rewards';
import { clampString } from '@life-quest/core/validation';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createMobileId } from '../utils/createMobileId';

export interface LevelUpSummary {
    fromLevel: number;
    toLevel: number;
    attackGain: number;
    defenseGain: number;
    hpGain: number;
}

interface MobileGameStore extends GameStateSnapshot {
    hasHydrated: boolean;
    /** 直近のレベルアップ演出用データ（永続化しない） */
    lastLevelUp: LevelUpSummary | null;
    setHasHydrated: (value: boolean) => void;
    clearLastLevelUp: () => void;
    updateCharacter: (updates: Partial<Pick<CharacterState, 'name'>> & { avatar?: AvatarId }) => void;
    /** XPを付与する。付与結果を返す（0 XPなら状態変更なし）。 */
    addXp: (baseXp: number) => ApplyCharacterXpResult | null;
    incrementGachaCount: () => void;
    /** 現在のガチャカウントがマイルストーンなら宝箱をキューに追加する。 */
    checkGachaMilestones: () => void;
    /** 宝箱を開封し、入手した装備を返す（装備なし宝箱・開封済み・不明IDは null）。 */
    openChest: (chestId: string) => Equipment | null;
    equipItem: (equipmentId: string) => void;
    unequipItem: (equipmentId: string) => void;
    /** 各スロットで最強の装備を装着する。変更があれば true。 */
    autoEquipBest: () => boolean;
    /** 装備を売却してXPを得る。得たXPを返す（装備中・不明IDは 0）。 */
    sellItem: (equipmentId: string) => number;
    /** 同レアリティ3個を消費して上位レアリティ装備を生成する。 */
    synthesizeItems: (equipmentIds: string[]) => Equipment | null;
    getEffectiveStats: () => EffectiveStats;
    /**
     * タスク完了報酬（優先度別XP + ガチャ進行）を付与する。
     * 同じタスクIDには一度しか付与しない。付与したら true。
     */
    grantTaskCompletionReward: (taskId: string, priority: Priority) => boolean;
    /**
     * 習慣全達成ボーナス（XP + ガチャ進行）を付与する。
     * 同じ日付 (YYYY-MM-DD) には一度しか付与しない。付与したら true。
     */
    grantHabitAllCompleteBonus: (date: string) => boolean;
}

/** 永続化スキーマのバージョン。フィールド構成を変えるときに上げ、migrate で吸収する。 */
export const GAME_STORE_VERSION = 1;

const initialSnapshot = createInitialGameStateSnapshot();

function toLevelUpSummary(fromLevel: number, result: ApplyCharacterXpResult): LevelUpSummary | null {
    if (result.levelGain <= 0) return null;
    return {
        fromLevel,
        toLevel: result.character.level,
        attackGain: result.statGains.attack,
        defenseGain: result.statGains.defense,
        hpGain: result.statGains.maxHp,
    };
}

export const useMobileGameStore = create<MobileGameStore>()(
    persist(
        (set, get) => {
            /**
             * 報酬付与（台帳更新・XP・ガチャカウント・マイルストーン宝箱）を
             * 単一の set で適用する。永続化が1回の書き込みになるため、
             * 途中断で「XPだけ付与されて台帳が残らない」状態が起きない。
             */
            const applyRewardGrant = (ledger: RewardLedger, baseXp: number): void => {
                const state = get();
                const result = applyCharacterXp(state.character, baseXp);
                const levelUp = toLevelUpSummary(state.character.level, result);
                const gachaCount = Math.min(Number.MAX_SAFE_INTEGER, state.gachaCount + 1);
                const milestone = getMilestoneAtCount(gachaCount);
                const chestQueue = milestone
                    ? capChestQueue([...state.chestQueue, {
                        id: createMobileId(),
                        chestType: milestone.chestType,
                        label: milestone.label,
                        opened: false,
                        equipment: null,
                        isStarterCharacter: milestone.chestType === 'blue' && milestone.count === 5,
                    }])
                    : state.chestQueue;

                set({
                    rewardLedger: ledger,
                    character: { ...state.character, ...result.character },
                    gachaCount,
                    chestQueue,
                    ...(levelUp ? { lastLevelUp: levelUp } : {}),
                });
            };

            return {
            ...initialSnapshot,
            hasHydrated: false,
            lastLevelUp: null,

            setHasHydrated: (hasHydrated) => set({ hasHydrated }),
            clearLastLevelUp: () => set({ lastLevelUp: null }),

            updateCharacter: (updates) => set((state) => ({
                character: {
                    ...state.character,
                    ...(updates.name !== undefined
                        ? { name: clampString(updates.name, GAME_STATE_LIMITS.maxCharacterNameLength) }
                        : {}),
                    ...(updates.avatar !== undefined ? { avatar: updates.avatar } : {}),
                },
            })),

            addXp: (baseXp) => {
                const { character } = get();
                const result = applyCharacterXp(character, baseXp);
                if (result.appliedXp === 0 && result.levelGain === 0) return null;

                const levelUp = toLevelUpSummary(character.level, result);
                set({
                    character: { ...character, ...result.character },
                    ...(levelUp ? { lastLevelUp: levelUp } : {}),
                });
                return result;
            },

            incrementGachaCount: () => set((state) => ({
                gachaCount: Math.min(Number.MAX_SAFE_INTEGER, state.gachaCount + 1),
            })),

            checkGachaMilestones: () => {
                const { gachaCount, chestQueue } = get();
                const milestone = getMilestoneAtCount(gachaCount);
                if (!milestone) return;
                const chest: ChestReward = {
                    id: createMobileId(),
                    chestType: milestone.chestType,
                    label: milestone.label,
                    opened: false,
                    equipment: null,
                    isStarterCharacter: milestone.chestType === 'blue' && milestone.count === 5,
                };
                set({ chestQueue: capChestQueue([...chestQueue, chest]) });
            },

            openChest: (chestId) => {
                const { chestQueue } = get();
                const chest = chestQueue.find((candidate) => candidate.id === chestId);
                if (!chest || chest.opened) return null;

                const template = rollEquipmentTemplate(chest.chestType);
                const equipment = template ? createEquipmentFromTemplate(createMobileId(), template) : null;
                set((state) => ({
                    chestQueue: state.chestQueue.map((candidate) =>
                        candidate.id === chestId ? { ...candidate, opened: true, equipment } : candidate
                    ),
                    equipment: equipment
                        ? capEquipmentCollection([...state.equipment, equipment])
                        : state.equipment,
                }));
                return equipment;
            },

            equipItem: (equipmentId) => {
                const item = get().equipment.find((candidate) => candidate.id === equipmentId);
                if (!item) return;
                set((state) => ({
                    equipment: state.equipment.map((candidate) => {
                        if (candidate.id === equipmentId) return { ...candidate, equipped: true };
                        if (candidate.slot === item.slot && candidate.equipped) return { ...candidate, equipped: false };
                        return candidate;
                    }),
                }));
            },

            unequipItem: (equipmentId) => set((state) => ({
                equipment: state.equipment.map((candidate) =>
                    candidate.id === equipmentId ? { ...candidate, equipped: false } : candidate
                ),
            })),

            autoEquipBest: () => {
                const { equipment } = get();
                const bestIdBySlot = getBestEquipmentIdsBySlot(equipment);

                const alreadyOptimal = EQUIPMENT_SLOTS.every((slot) => {
                    const bestId = bestIdBySlot.get(slot);
                    if (bestId === undefined) return true;
                    const equipped = equipment.find((candidate) => candidate.slot === slot && candidate.equipped);
                    return equipped?.id === bestId;
                });
                if (alreadyOptimal) return false;

                set((state) => ({
                    equipment: state.equipment.map((candidate) => {
                        const bestId = bestIdBySlot.get(candidate.slot);
                        if (bestId === undefined) return candidate;
                        return { ...candidate, equipped: candidate.id === bestId };
                    }),
                }));
                return true;
            },

            sellItem: (equipmentId) => {
                const item = get().equipment.find((candidate) => candidate.id === equipmentId);
                if (!item || item.equipped) return 0;
                const xpGain = getEquipmentSellXp(item, SELL_XP_BY_RARITY);
                set((state) => ({
                    equipment: state.equipment.filter((candidate) => candidate.id !== equipmentId),
                }));
                get().addXp(xpGain);
                return xpGain;
            },

            synthesizeItems: (equipmentIds) => {
                const selection = selectSynthesisIngredients(
                    equipmentIds,
                    get().equipment,
                    SYNTHESIS_CONFIG.REQUIRED_COUNT,
                );
                if (!selection) return null;

                const slotIndex = Math.min(
                    selection.dominantSlots.length - 1,
                    Math.floor(Math.random() * selection.dominantSlots.length),
                );
                const synthesisSlot = selection.dominantSlots[Math.max(0, slotIndex)];
                const candidates = EQUIPMENT_POOL.filter(
                    (template) => template.rarity === selection.nextRarity && template.slot === synthesisSlot,
                );
                if (candidates.length === 0) return null;
                const templateIndex = Math.min(candidates.length - 1, Math.floor(Math.random() * candidates.length));
                const newItem = createEquipmentFromTemplate(createMobileId(), candidates[Math.max(0, templateIndex)]);

                set((state) => ({
                    equipment: capEquipmentCollection([
                        ...state.equipment.filter((candidate) => !equipmentIds.includes(candidate.id)),
                        newItem,
                    ]),
                }));
                return newItem;
            },

            getEffectiveStats: () => {
                const { character, equipment } = get();
                return calculateEffectiveEquipmentStats(character, equipment);
            },

            grantTaskCompletionReward: (taskId, priority) => {
                const claim = claimTaskReward(get().rewardLedger, taskId);
                if (!claim.granted) return false;
                applyRewardGrant(claim.ledger, XP_CONFIG.REWARD_BY_PRIORITY[priority]);
                return true;
            },

            grantHabitAllCompleteBonus: (date) => {
                const claim = claimHabitAllCompleteBonus(get().rewardLedger, date);
                if (!claim.granted) return false;
                applyRewardGrant(claim.ledger, XP_CONFIG.HABIT_ALL_COMPLETE_BONUS);
                return true;
            },
            };
        },
        {
            name: 'quest-board-game',
            version: GAME_STORE_VERSION,
            storage: createJSONStorage(() => AsyncStorage),
            // 一時UI状態（hasHydrated / lastLevelUp）は永続化しない
            partialize: (state) => ({
                character: state.character,
                equipment: state.equipment,
                chestQueue: state.chestQueue,
                gachaCount: state.gachaCount,
                rewardLedger: state.rewardLedger,
            }),
            // 旧バージョンのデータも sanitize が既定値へ吸収するので、そのまま merge へ渡す
            migrate: (persisted) => persisted as GameStateSnapshot,
            merge: (persisted, current) => ({
                ...current,
                ...sanitizeGameStateSnapshot(persisted),
                lastLevelUp: null,
            }),
            onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
        }
    )
);

export type { AvatarId, CharacterState, GameStateSnapshot, RewardLedger };
