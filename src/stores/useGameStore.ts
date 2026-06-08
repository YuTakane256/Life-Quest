import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
    CharacterStats,
    Debuff,
    Equipment,
    EquipmentSlot,
    ChestReward,
    BattleState,
    Enemy,
    BattleLog,
    GameStoreState,
    LevelUpEvent,
    ChestRevealEvent,
} from '../types';
import type { EquipmentTemplate } from '../config/gameConfig';
import {
    XP_CONFIG,
    GACHA_CONFIG,
    CHARACTER_CONFIG,
    BATTLE_CONFIG,
    EQUIPMENT_POOL,
    SELL_XP_BY_RARITY,
    RARITY_ORDER,
    SYNTHESIS_CONFIG,
    UI_CONFIG,
    type ChestType,
    type GachaMilestone,
} from '../config/gameConfig';
import { generateId } from '../utils/dateUtils';
import { clampString } from '../utils/validation';
import { pickRandom } from '../utils/random';
import { useBattleHistoryStore } from './useBattleHistoryStore';

// ─── ヘルパー関数 ─────────────────────────────────────────────

/** EquipmentTemplate から Equipment インスタンスを生成する */
export function createEquipmentInstance(template: EquipmentTemplate): Equipment {
    return {
        id: generateId(),
        templateId: template.id,
        name: template.name,
        slot: template.slot,
        rarity: template.rarity,
        attackBonus: template.attackBonus,
        defenseBonus: template.defenseBonus,
        hpBonus: template.hpBonus,
        equipped: false,
    };
}

export function calculateLevel(totalXp: number): number {
    const table = XP_CONFIG.LEVEL_XP_TABLE;
    const maxTableLevel = table.length - 1;
    if (totalXp >= table[maxTableLevel]) {
        const remainingXp = totalXp - table[maxTableLevel];
        return maxTableLevel + Math.floor(remainingXp / XP_CONFIG.OVERFLOW_XP_PER_LEVEL);
    }
    for (let i = maxTableLevel; i >= 0; i--) {
        if (totalXp >= table[i]) return i;
    }
    return 1;
}

export function calculateNextLevelXp(level: number): number {
    const table = XP_CONFIG.LEVEL_XP_TABLE;
    const maxTableLevel = table.length - 1;
    if (level >= maxTableLevel) {
        return table[maxTableLevel] + (level - maxTableLevel + 1) * XP_CONFIG.OVERFLOW_XP_PER_LEVEL;
    }
    return table[level + 1];
}

export function calculateXpProgress(totalXp: number, level: number): number {
    const table = XP_CONFIG.LEVEL_XP_TABLE;
    const maxTableLevel = table.length - 1;
    if (level >= maxTableLevel) {
        const baseXp = table[maxTableLevel] + (level - maxTableLevel) * XP_CONFIG.OVERFLOW_XP_PER_LEVEL;
        const nextXp = baseXp + XP_CONFIG.OVERFLOW_XP_PER_LEVEL;
        return (totalXp - baseXp) / (nextXp - baseXp);
    }
    const currentLevelXp = table[level];
    const nextLevelXp = table[level + 1];
    return (totalXp - currentLevelXp) / (nextLevelXp - currentLevelXp);
}

function rollEquipment(chestType: ChestType): Equipment | null {
    const dropRates = GACHA_CONFIG.DROP_RATES[chestType];
    if (!dropRates) return null;
    if ('starter_character' in dropRates && dropRates.starter_character === 1.0) {
        return null;
    }
    const roll = Math.random();
    let cumulative = 0;
    let selectedRarity: string = 'common';
    for (const [rarity, rate] of Object.entries(dropRates)) {
        if (rarity === 'starter_character') continue;
        cumulative += rate as number;
        if (roll <= cumulative) {
            selectedRarity = rarity;
            break;
        }
    }
    const candidates = EQUIPMENT_POOL.filter((e) => e.rarity === selectedRarity);
    if (candidates.length === 0) return null;
    const template = pickRandom(candidates);
    if (!template) return null;
    return createEquipmentInstance(template);
}

export function calculateDamage(attack: number, defense: number): number {
    const damage = Math.floor(attack - defense * BATTLE_CONFIG.DEFENSE_FACTOR);
    return Math.max(damage, BATTLE_CONFIG.MIN_DAMAGE);
}

function getNewMilestones(oldCount: number, newCount: number): GachaMilestone[] {
    const milestones: GachaMilestone[] = [];
    for (let count = oldCount + 1; count <= newCount; count++) {
        const specialKeys = Object.keys(GACHA_CONFIG.SPECIAL_MILESTONES).map(Number);
        const specialMatch = specialKeys.find((k) => k === count);
        if (specialMatch) {
            const special = GACHA_CONFIG.SPECIAL_MILESTONES[specialMatch as keyof typeof GACHA_CONFIG.SPECIAL_MILESTONES];
            milestones.push({ count, chestType: special.chestType, label: special.label });
            continue;
        }
        const posInCycle = count <= 100 ? count : ((count - 1) % GACHA_CONFIG.CYCLE_LENGTH) + 1;
        const milestone = GACHA_CONFIG.MILESTONES.find((m) => m.count === posInCycle);
        if (milestone) {
            milestones.push({ count, chestType: milestone.chestType, label: milestone.label });
        }
    }
    return milestones;
}

function pickSynthesisSlot(items: Equipment[]): EquipmentSlot {
    const slotCounts = items.reduce<Record<EquipmentSlot, number>>((counts, item) => {
        counts[item.slot] += 1;
        return counts;
    }, { weapon: 0, armor: 0, accessory: 0 });
    const maxCount = Math.max(...Object.values(slotCounts));
    const tiedSlots = (Object.keys(slotCounts) as EquipmentSlot[]).filter((slot) => slotCounts[slot] === maxCount);
    return pickRandom(tiedSlots) as EquipmentSlot;
}

const initialCharacter: CharacterStats = {
    name: CHARACTER_CONFIG.INITIAL_STATS.name,
    avatar: CHARACTER_CONFIG.INITIAL_STATS.avatar,
    level: CHARACTER_CONFIG.INITIAL_STATS.level,
    totalXp: CHARACTER_CONFIG.INITIAL_STATS.totalXp,
    baseAttack: CHARACTER_CONFIG.INITIAL_STATS.attack,
    baseDefense: CHARACTER_CONFIG.INITIAL_STATS.defense,
    baseMaxHp: CHARACTER_CONFIG.INITIAL_STATS.maxHp,
};

const initialDebuff: Debuff = { active: false, expiresAt: null, multiplier: 1 };

const initialBattle: BattleState = {
    status: 'idle',
    currentStage: 1,
    maxClearedStage: 0,
    enemy: null,
    playerHp: CHARACTER_CONFIG.INITIAL_STATS.maxHp,
    logs: [],
    battleUnlocked: false,
};

export const useGameStore = create<GameStoreState>()(
    persist(
        (set, get) => ({
            character: { ...initialCharacter },
            debuff: { ...initialDebuff },
            equipment: [],
            gachaCount: 0,
            chestQueue: [],
            battle: { ...initialBattle },
            levelUpEvent: null,
            pendingChestReveal: null,

            clearLevelUpEvent: () => set({ levelUpEvent: null }),

            clearPendingChestReveal: () => set({ pendingChestReveal: null }),

            updateCharacter: (updates) => {
                const safeUpdates = { ...updates };
                if (safeUpdates.name !== undefined) {
                    safeUpdates.name = clampString(safeUpdates.name, UI_CONFIG.MAX_CHARACTER_NAME_LENGTH);
                }
                set((state) => ({
                    character: { ...state.character, ...safeUpdates }
                }));
            },

            addXp: (baseXp: number) => {
                const { debuff, character } = get();
                let multiplier = 1;
                if (debuff.active && debuff.expiresAt) {
                    if (new Date().toISOString() < debuff.expiresAt) {
                        multiplier = debuff.multiplier;
                    } else {
                        set({ debuff: { ...initialDebuff } });
                    }
                }
                const actualXp = Math.floor(baseXp * multiplier);
                const newTotalXp = character.totalXp + actualXp;
                const newLevel = calculateLevel(newTotalXp);
                const levelDiff = newLevel - character.level;
                const newAttack = character.baseAttack + levelDiff * CHARACTER_CONFIG.STAT_PER_LEVEL.attack;
                const newDefense = character.baseDefense + levelDiff * CHARACTER_CONFIG.STAT_PER_LEVEL.defense;
                const newMaxHp = character.baseMaxHp + levelDiff * CHARACTER_CONFIG.STAT_PER_LEVEL.maxHp;

                const levelUpEvent: LevelUpEvent | null = levelDiff > 0 ? {
                    id: generateId(),
                    fromLevel: character.level,
                    toLevel: newLevel,
                    attackGain: levelDiff * CHARACTER_CONFIG.STAT_PER_LEVEL.attack,
                    defenseGain: levelDiff * CHARACTER_CONFIG.STAT_PER_LEVEL.defense,
                    hpGain: levelDiff * CHARACTER_CONFIG.STAT_PER_LEVEL.maxHp,
                } : null;

                set({
                    character: {
                        ...character,
                        totalXp: newTotalXp,
                        level: newLevel,
                        baseAttack: newAttack,
                        baseDefense: newDefense,
                        baseMaxHp: newMaxHp,
                    },
                    ...(levelUpEvent ? { levelUpEvent } : {}),
                });
            },

            incrementGachaCount: () => set((state) => ({ gachaCount: state.gachaCount + 1 })),

            checkGachaMilestones: () => {
                const { gachaCount, chestQueue } = get();
                const oldCount = gachaCount - 1;
                const newMilestones = getNewMilestones(oldCount, gachaCount);
                if (newMilestones.length === 0) return;
                const newChests: ChestReward[] = newMilestones.map((m) => ({
                    id: generateId(),
                    chestType: m.chestType,
                    label: m.label,
                    opened: false,
                    equipment: null,
                    isStarterCharacter: m.chestType === 'blue' && m.count === 5,
                }));
                set({ chestQueue: [...chestQueue, ...newChests] });
            },

            openChest: (chestId: string) => {
                const { chestQueue } = get();
                const chest = chestQueue.find((c) => c.id === chestId);
                if (!chest || chest.opened) return;
                const equipment = rollEquipment(chest.chestType);
                const reveal: ChestRevealEvent = {
                    id: generateId(),
                    chestId: chest.id,
                    chestType: chest.chestType,
                    label: chest.label,
                    equipment,
                    isStarterCharacter: chest.isStarterCharacter ?? false,
                };
                set((state) => ({
                    chestQueue: state.chestQueue.map((c) =>
                        c.id === chestId ? { ...c, opened: true, equipment } : c
                    ),
                    equipment: equipment ? [...state.equipment, equipment] : state.equipment,
                    battle: chest.isStarterCharacter ? { ...state.battle, battleUnlocked: true } : state.battle,
                    pendingChestReveal: reveal,
                }));
            },

            equipItem: (equipmentId: string) => {
                const { equipment } = get();
                const item = equipment.find((e) => e.id === equipmentId);
                if (!item) return;
                set((state) => ({
                    equipment: state.equipment.map((e) => {
                        if (e.id === equipmentId) return { ...e, equipped: true };
                        if (e.slot === item.slot && e.equipped) return { ...e, equipped: false };
                        return e;
                    }),
                }));
            },

            unequipItem: (equipmentId: string) => set((state) => ({
                equipment: state.equipment.map((e) => e.id === equipmentId ? { ...e, equipped: false } : e),
            })),

            autoEquipBest: () => {
                const { equipment } = get();
                const slots: EquipmentSlot[] = ['weapon', 'armor', 'accessory'];
                // 各スロットで totalBonus が最大のアイテムを選ぶ
                const bestIdBySlot = new Map<EquipmentSlot, string>();
                for (const slot of slots) {
                    const slotItems = equipment.filter((e) => e.slot === slot);
                    if (slotItems.length === 0) continue;
                    const best = slotItems.reduce((acc, e) => {
                        const score = e.attackBonus + e.defenseBonus + e.hpBonus;
                        const accScore = acc.attackBonus + acc.defenseBonus + acc.hpBonus;
                        return score > accScore ? e : acc;
                    });
                    bestIdBySlot.set(slot, best.id);
                }

                // 既に最強が装備済みなら変更なし
                const alreadyOptimal = slots.every((slot) => {
                    const bestId = bestIdBySlot.get(slot);
                    if (bestId === undefined) return true; // そのスロットに何も無い → スキップ扱い
                    const equipped = equipment.find((e) => e.slot === slot && e.equipped);
                    return equipped?.id === bestId;
                });
                if (alreadyOptimal) return false;

                set((state) => ({
                    equipment: state.equipment.map((e) => {
                        const bestId = bestIdBySlot.get(e.slot);
                        if (bestId === undefined) return e;
                        return { ...e, equipped: e.id === bestId };
                    }),
                }));
                return true;
            },

            applyDebuff: () => {
                const expiresAt = new Date(Date.now() + XP_CONFIG.DEBUFF_DURATION_MS).toISOString();
                set({ debuff: { active: true, expiresAt, multiplier: XP_CONFIG.DEBUFF_XP_MULTIPLIER } });
            },

            clearExpiredDebuffs: () => {
                const { debuff } = get();
                if (debuff.active && debuff.expiresAt && new Date().toISOString() >= debuff.expiresAt) {
                    set({ debuff: { ...initialDebuff } });
                }
            },

            getEffectiveStats: () => {
                const { character, equipment } = get();
                const equippedItems = equipment.filter((e) => e.equipped);
                const bonusAttack = equippedItems.reduce((sum, e) => sum + e.attackBonus, 0);
                const bonusDefense = equippedItems.reduce((sum, e) => sum + e.defenseBonus, 0);
                const bonusHp = equippedItems.reduce((sum, e) => sum + e.hpBonus, 0);
                return {
                    attack: character.baseAttack + bonusAttack,
                    defense: character.baseDefense + bonusDefense,
                    maxHp: character.baseMaxHp + bonusHp,
                };
            },

            startBattle: (stage: number) => {
                const stageData = BATTLE_CONFIG.STAGES.find((s) => s.stage === stage);
                if (!stageData) return;
                const effectiveStats = get().getEffectiveStats();
                const enemy: Enemy = {
                    stage: stageData.stage,
                    name: stageData.name,
                    hp: stageData.hp,
                    maxHp: stageData.hp,
                    attack: stageData.attack,
                    defense: stageData.defense,
                    xpReward: stageData.xpReward,
                };
                set({
                    battle: {
                        ...get().battle,
                        status: 'fighting',
                        currentStage: stage,
                        enemy,
                        playerHp: effectiveStats.maxHp,
                        logs: [],
                    },
                });
            },

            processBattleTurn: () => {
                const { battle } = get();
                if (battle.status !== 'fighting' || !battle.enemy) return;
                const effectiveStats = get().getEffectiveStats();
                const turn = battle.logs.length + 1;
                const playerDamage = calculateDamage(effectiveStats.attack, battle.enemy.defense);
                const newEnemyHp = Math.max(0, battle.enemy.hp - playerDamage);
                const logs: BattleLog[] = [...battle.logs];
                logs.push({ turn, message: `あなたの攻撃！ ${battle.enemy.name}に${playerDamage}ダメージ！`, playerHp: battle.playerHp, enemyHp: newEnemyHp });
                if (newEnemyHp <= 0) {
                    set({ battle: { ...battle, status: 'victory', enemy: { ...battle.enemy, hp: 0 }, logs } });
                    // 勝利時にXPを付与
                    get().addXp(battle.enemy.xpReward);
                    // バトル履歴に記録
                    useBattleHistoryStore.getState().addBattleResult({
                        id: generateId(),
                        timestamp: new Date().toISOString(),
                        stage: battle.currentStage,
                        enemyName: battle.enemy.name,
                        enemyMaxHp: battle.enemy.maxHp,
                        enemyAttack: battle.enemy.attack,
                        enemyDefense: battle.enemy.defense,
                        outcome: 'victory',
                        turnCount: logs.length,
                        xpEarned: battle.enemy.xpReward,
                        logs: [...logs],
                    });
                    return;
                }
                const enemyDamage = calculateDamage(battle.enemy.attack, effectiveStats.defense);
                const newPlayerHp = Math.max(0, battle.playerHp - enemyDamage);
                logs.push({ turn, message: `${battle.enemy.name}の攻撃！ あなたに${enemyDamage}ダメージ！`, playerHp: newPlayerHp, enemyHp: newEnemyHp });
                if (newPlayerHp <= 0) {
                    set({ battle: { ...battle, status: 'defeat', enemy: { ...battle.enemy, hp: newEnemyHp }, playerHp: 0, logs } });
                    // バトル履歴に記録
                    useBattleHistoryStore.getState().addBattleResult({
                        id: generateId(),
                        timestamp: new Date().toISOString(),
                        stage: battle.currentStage,
                        enemyName: battle.enemy.name,
                        enemyMaxHp: battle.enemy.maxHp,
                        enemyAttack: battle.enemy.attack,
                        enemyDefense: battle.enemy.defense,
                        outcome: 'defeat',
                        turnCount: logs.length,
                        xpEarned: 0,
                        logs: [...logs],
                    });
                    return;
                }
                set({ battle: { ...battle, enemy: { ...battle.enemy, hp: newEnemyHp }, playerHp: newPlayerHp, logs } });
            },

            resetBattle: () => set((state) => ({
                battle: { ...state.battle, status: 'idle', enemy: null, playerHp: get().getEffectiveStats().maxHp, logs: [] },
            })),

            advanceStage: () => set((state) => {
                const newMaxCleared = Math.max(state.battle.maxClearedStage, state.battle.currentStage);
                const nextStage = state.battle.currentStage + 1;
                return {
                    battle: {
                        ...state.battle,
                        status: 'idle',
                        currentStage: Math.min(nextStage, BATTLE_CONFIG.STAGES.length),
                        maxClearedStage: newMaxCleared,
                        enemy: null,
                        logs: [],
                    },
                };
            }),

            sellItem: (equipmentId: string) => {
                const { equipment } = get();
                const item = equipment.find((e) => e.id === equipmentId);
                if (!item || item.equipped) return 0;
                const xpGain = SELL_XP_BY_RARITY[item.rarity];
                set((state) => ({
                    equipment: state.equipment.filter((e) => e.id !== equipmentId),
                }));
                get().addXp(xpGain);
                return xpGain;
            },

            synthesizeItems: (equipmentIds: string[]) => {
                const { equipment } = get();
                if (equipmentIds.length !== SYNTHESIS_CONFIG.REQUIRED_COUNT) return null;
                const items = equipmentIds.map((id) => equipment.find((e) => e.id === id)).filter(Boolean) as import('../types').Equipment[];
                if (items.length !== SYNTHESIS_CONFIG.REQUIRED_COUNT) return null;
                // 全アイテムが同レアリティ・未装備であることを確認
                const rarity = items[0].rarity;
                if (items.some((i) => i.rarity !== rarity || i.equipped)) return null;
                // legendary は合成不可
                const rarityIndex = RARITY_ORDER.indexOf(rarity);
                if (rarityIndex < 0 || rarityIndex >= RARITY_ORDER.length - 1) return null;
                const nextRarity = RARITY_ORDER[rarityIndex + 1];
                // 素材で一番多い装備種別を引き継ぐ。同数なら対象種別をランダムに決める。
                const synthesisSlot = pickSynthesisSlot(items);
                const candidates = EQUIPMENT_POOL.filter((e) => e.rarity === nextRarity && e.slot === synthesisSlot);
                if (candidates.length === 0) return null;
                const template = pickRandom(candidates);
                if (!template) return null;
                const newItem = createEquipmentInstance(template);
                set((state) => ({
                    equipment: [
                        ...state.equipment.filter((e) => !equipmentIds.includes(e.id)),
                        newItem,
                    ],
                }));
                return newItem;
            },

            grantChest: (chestType: ChestType, label: string) => {
                const newChest: ChestReward = {
                    id: generateId(),
                    chestType,
                    label,
                    opened: false,
                    equipment: null,
                };
                set((state) => ({ chestQueue: [...state.chestQueue, newChest] }));
            },
        }),
        {
            name: 'quest-board-game',
            // UI 用の一時イベント（levelUpEvent / pendingChestReveal）は永続化しない。
            // これらが localStorage に残ると、リロード時にモーダルが意図せず再表示される。
            // また、細工された localStorage で起動時に勝手に発火させられる嫌がらせも防ぐ。
            partialize: (state) => ({
                character: state.character,
                debuff: state.debuff,
                equipment: state.equipment,
                gachaCount: state.gachaCount,
                chestQueue: state.chestQueue,
                battle: state.battle,
            }),
        }
    )
);
