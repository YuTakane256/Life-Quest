import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createWebPersistStorage } from '../platform/storage';
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
import { BATTLE_SKILL_CONFIG } from '../config/battleSkills';
import { getUnlockedBattleSkills, resolveBattleSkill } from '../utils/battleSkills';
import { useBattleHistoryStore } from './useBattleHistoryStore';
import { isPlainObject, isFiniteNumber, toNonNegativeInteger, toBoundedInteger } from '../utils/persistSanitize';
import {
    MAX_TOTAL_XP,
    calculateDamage,
    calculateEffectiveStats,
    calculateLevel,
    getBestEquipmentIdsBySlot,
    getDominantEquipmentSlots,
    getGuardReduction,
    tickSkillCooldowns,
} from '../utils/gameCalculations';

export {
    MAX_TOTAL_XP,
    calculateDamage,
    calculateLevel,
    calculateNextLevelXp,
    calculateXpProgress,
} from '../utils/gameCalculations';

export const MAX_GACHA_COUNT = Number.MAX_SAFE_INTEGER;
export const MAX_EQUIPMENT_ITEMS = 2000;
export const MAX_CHEST_QUEUE_ITEMS = 500;

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

function getMilestoneAtCount(count: number): GachaMilestone | null {
    const special = GACHA_CONFIG.SPECIAL_MILESTONES[count as keyof typeof GACHA_CONFIG.SPECIAL_MILESTONES];
    if (special) {
        return { count, chestType: special.chestType, label: special.label };
    }

    const posInCycle = count <= GACHA_CONFIG.CYCLE_LENGTH
        ? count
        : ((count - 1) % GACHA_CONFIG.CYCLE_LENGTH) + 1;
    const milestone = GACHA_CONFIG.MILESTONES.find((candidate) => candidate.count === posInCycle);
    return milestone ? { count, chestType: milestone.chestType, label: milestone.label } : null;
}

function pickSynthesisSlot(items: Equipment[]): EquipmentSlot {
    return pickRandom(getDominantEquipmentSlots(items)) as EquipmentSlot;
}

function canStartBattleStage(battle: BattleState, stage: number): boolean {
    if (!battle.battleUnlocked) return false;
    if (!Number.isInteger(stage) || stage < 1 || stage > MAX_STAGE) return false;
    return stage <= battle.maxClearedStage + 1;
}

function sanitizeSkillCooldowns(raw: unknown): Record<string, number> {
    if (!isPlainObject(raw)) return {};
    return Object.fromEntries(
        Object.entries(raw)
            .filter(([skillId, turns]) => typeof skillId === 'string' && isFiniteNumber(turns) && turns > 0)
            .map(([skillId, turns]) => [skillId, Math.floor(turns as number)])
    );
}

/** バトル終了時に履歴ストアへ結果スナップショットを記録する。 */
function recordBattleResult(
    stage: number,
    enemy: Enemy,
    outcome: 'victory' | 'defeat',
    logs: BattleLog[],
): void {
    useBattleHistoryStore.getState().addBattleResult({
        id: generateId(),
        timestamp: new Date().toISOString(),
        stage,
        enemyName: enemy.name,
        enemyMaxHp: enemy.maxHp,
        enemyAttack: enemy.attack,
        enemyDefense: enemy.defense,
        outcome,
        turnCount: logs.length,
        xpEarned: outcome === 'victory' ? enemy.xpReward : 0,
        logs: [...logs],
    });
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
    skillCooldowns: {},
    guardTurnsRemaining: 0,
    guardDamageReduction: 0,
};

interface GameStorePersisted {
    character: CharacterStats;
    debuff: Debuff;
    equipment: Equipment[];
    gachaCount: number;
    chestQueue: ChestReward[];
    battle: BattleState;
}

const AVATARS: CharacterStats['avatar'][] = ['male', 'female'];
const CHEST_TYPES: ChestType[] = ['blue', 'wood', 'silver', 'gold', 'red_gold', 'rainbow'];
const BATTLE_STATUSES: BattleState['status'][] = ['idle', 'fighting', 'victory', 'defeat'];
const EQUIPMENT_TEMPLATE_BY_ID = new Map(EQUIPMENT_POOL.map((template) => [template.id, template]));
const MAX_STAGE = BATTLE_CONFIG.STAGES[BATTLE_CONFIG.STAGES.length - 1]?.stage ?? 1;

function sanitizeCharacter(raw: unknown): CharacterStats {
    if (!isPlainObject(raw)) return { ...initialCharacter };

    const totalXp = toBoundedInteger(raw.totalXp, initialCharacter.totalXp, 0, MAX_TOTAL_XP);
    const level = calculateLevel(totalXp);

    return {
        name: typeof raw.name === 'string'
            ? clampString(raw.name, UI_CONFIG.MAX_CHARACTER_NAME_LENGTH)
            : initialCharacter.name,
        avatar: typeof raw.avatar === 'string' && AVATARS.includes(raw.avatar as CharacterStats['avatar'])
            ? raw.avatar as CharacterStats['avatar']
            : initialCharacter.avatar,
        level,
        totalXp,
        baseAttack: initialCharacter.baseAttack + (level - 1) * CHARACTER_CONFIG.STAT_PER_LEVEL.attack,
        baseDefense: initialCharacter.baseDefense + (level - 1) * CHARACTER_CONFIG.STAT_PER_LEVEL.defense,
        baseMaxHp: initialCharacter.baseMaxHp + (level - 1) * CHARACTER_CONFIG.STAT_PER_LEVEL.maxHp,
    };
}

function sanitizeDebuff(raw: unknown): Debuff {
    if (!isPlainObject(raw) || raw.active !== true || typeof raw.expiresAt !== 'string') {
        return { ...initialDebuff };
    }

    return {
        active: true,
        expiresAt: raw.expiresAt,
        multiplier: XP_CONFIG.DEBUFF_XP_MULTIPLIER,
    };
}

function sanitizeEquipment(raw: unknown): Equipment | null {
    if (!isPlainObject(raw)) return null;
    if (typeof raw.id !== 'string' || typeof raw.templateId !== 'string') return null;

    const template = EQUIPMENT_TEMPLATE_BY_ID.get(raw.templateId);
    if (!template) return null;

    return {
        id: raw.id,
        templateId: template.id,
        name: template.name,
        slot: template.slot,
        rarity: template.rarity,
        attackBonus: template.attackBonus,
        defenseBonus: template.defenseBonus,
        hpBonus: template.hpBonus,
        equipped: raw.equipped === true,
    };
}

function capEquipmentCollection(items: Equipment[]): Equipment[] {
    if (items.length <= MAX_EQUIPMENT_ITEMS) return items;

    const keepIndexes = new Set<number>();
    const equippedIndexes = items
        .map((item, index) => item.equipped ? index : -1)
        .filter((index) => index >= 0)
        .slice(-MAX_EQUIPMENT_ITEMS);
    equippedIndexes.forEach((index) => keepIndexes.add(index));

    for (let index = items.length - 1; index >= 0 && keepIndexes.size < MAX_EQUIPMENT_ITEMS; index--) {
        if (!items[index].equipped) keepIndexes.add(index);
    }

    return items.filter((_, index) => keepIndexes.has(index));
}

function sanitizeEquipmentList(raw: unknown): Equipment[] {
    if (!Array.isArray(raw)) return [];

    const seenIds = new Set<string>();
    const equippedSlots = new Set<EquipmentSlot>();
    return capEquipmentCollection(raw
        .map(sanitizeEquipment)
        .filter((item): item is Equipment => item !== null)
        .filter((item) => {
            if (seenIds.has(item.id)) return false;
            seenIds.add(item.id);
            return true;
        })
        .map((item) => {
            if (!item.equipped) return item;
            if (equippedSlots.has(item.slot)) return { ...item, equipped: false };
            equippedSlots.add(item.slot);
            return item;
        }));
}

function isChestType(value: unknown): value is ChestType {
    return typeof value === 'string' && CHEST_TYPES.includes(value as ChestType);
}

function sanitizeChest(raw: unknown): ChestReward | null {
    if (!isPlainObject(raw)) return null;
    if (typeof raw.id !== 'string' || !isChestType(raw.chestType) || typeof raw.label !== 'string') return null;

    const equipment = raw.equipment === null || raw.equipment === undefined ? null : sanitizeEquipment(raw.equipment);

    return {
        id: raw.id,
        chestType: raw.chestType,
        label: clampString(raw.label, 120),
        opened: raw.opened === true,
        equipment,
        ...(typeof raw.isStarterCharacter === 'boolean' ? { isStarterCharacter: raw.isStarterCharacter } : {}),
    };
}

function capChestQueue(items: ChestReward[]): ChestReward[] {
    if (items.length <= MAX_CHEST_QUEUE_ITEMS) return items;

    const keepIndexes = new Set<number>();
    const unopenedIndexes = items
        .map((item, index) => item.opened ? -1 : index)
        .filter((index) => index >= 0)
        .slice(-MAX_CHEST_QUEUE_ITEMS);
    unopenedIndexes.forEach((index) => keepIndexes.add(index));

    for (let index = items.length - 1; index >= 0 && keepIndexes.size < MAX_CHEST_QUEUE_ITEMS; index--) {
        if (items[index].opened) keepIndexes.add(index);
    }

    return items.filter((_, index) => keepIndexes.has(index));
}

function sanitizeEnemy(raw: unknown): Enemy | null {
    if (!isPlainObject(raw)) return null;
    const stage = toBoundedInteger(raw.stage, 0, 1, MAX_STAGE);
    const stageData = BATTLE_CONFIG.STAGES.find((candidate) => candidate.stage === stage);
    if (!stageData) return null;

    return {
        stage: stageData.stage,
        name: stageData.name,
        hp: toBoundedInteger(raw.hp, stageData.hp, 0, stageData.hp),
        maxHp: stageData.hp,
        attack: stageData.attack,
        defense: stageData.defense,
        xpReward: stageData.xpReward,
    };
}

function sanitizeBattleLog(raw: unknown): BattleLog | null {
    if (!isPlainObject(raw)) return null;
    if (typeof raw.message !== 'string') return null;

    return {
        turn: toNonNegativeInteger(raw.turn, 0),
        message: clampString(raw.message, 200),
        playerHp: toNonNegativeInteger(raw.playerHp, 0),
        enemyHp: toNonNegativeInteger(raw.enemyHp, 0),
    };
}

function sanitizeBattle(raw: unknown, character: CharacterStats): BattleState {
    if (!isPlainObject(raw)) return { ...initialBattle, playerHp: character.baseMaxHp };

    const status = typeof raw.status === 'string' && BATTLE_STATUSES.includes(raw.status as BattleState['status'])
        ? raw.status as BattleState['status']
        : 'idle';
    const enemy = sanitizeEnemy(raw.enemy);
    const safeStatus = status === 'idle' || enemy ? status : 'idle';

    return {
        status: safeStatus,
        currentStage: toBoundedInteger(raw.currentStage, initialBattle.currentStage, 1, MAX_STAGE),
        maxClearedStage: toBoundedInteger(raw.maxClearedStage, initialBattle.maxClearedStage, 0, MAX_STAGE),
        enemy: safeStatus === 'idle' ? null : enemy,
        playerHp: toBoundedInteger(raw.playerHp, character.baseMaxHp, 0, character.baseMaxHp),
        logs: Array.isArray(raw.logs)
            ? raw.logs.map(sanitizeBattleLog).filter((log): log is BattleLog => log !== null).slice(-100)
            : [],
        battleUnlocked: typeof raw.battleUnlocked === 'boolean' ? raw.battleUnlocked : false,
        skillCooldowns: sanitizeSkillCooldowns(raw.skillCooldowns),
        guardTurnsRemaining: toNonNegativeInteger(raw.guardTurnsRemaining, 0),
        guardDamageReduction: Math.max(0, Math.min(
            BATTLE_SKILL_CONFIG.MAX_DAMAGE_REDUCTION,
            isFiniteNumber(raw.guardDamageReduction) ? raw.guardDamageReduction : 0,
        )),
    };
}

export function sanitizeGameStoreState(persisted: unknown): GameStorePersisted {
    if (!isPlainObject(persisted)) {
        return {
            character: { ...initialCharacter },
            debuff: { ...initialDebuff },
            equipment: [],
            gachaCount: 0,
            chestQueue: [],
            battle: { ...initialBattle },
        };
    }

    const character = sanitizeCharacter(persisted.character);

    return {
        character,
        debuff: sanitizeDebuff(persisted.debuff),
        equipment: sanitizeEquipmentList(persisted.equipment),
        gachaCount: toBoundedInteger(persisted.gachaCount, 0, 0, MAX_GACHA_COUNT),
        chestQueue: Array.isArray(persisted.chestQueue)
            ? capChestQueue(
                persisted.chestQueue.map(sanitizeChest).filter((chest): chest is ChestReward => chest !== null)
            )
            : [],
        battle: sanitizeBattle(persisted.battle, character),
    };
}

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
                const safeBaseXp = toBoundedInteger(baseXp, 0, 0, MAX_TOTAL_XP);
                if (safeBaseXp === 0) return;

                const { debuff, character } = get();
                let multiplier = 1;
                if (debuff.active && debuff.expiresAt) {
                    if (new Date().toISOString() < debuff.expiresAt) {
                        multiplier = debuff.multiplier;
                    } else {
                        set({ debuff: { ...initialDebuff } });
                    }
                }
                const actualXp = Math.max(0, Math.floor(safeBaseXp * multiplier));
                if (actualXp === 0) return;

                const currentTotalXp = toBoundedInteger(character.totalXp, 0, 0, MAX_TOTAL_XP);
                const newTotalXp = Math.min(MAX_TOTAL_XP, currentTotalXp + actualXp);
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

            incrementGachaCount: () => set((state) => ({
                gachaCount: Math.min(
                    MAX_GACHA_COUNT,
                    toBoundedInteger(state.gachaCount, 0, 0, MAX_GACHA_COUNT) + 1,
                ),
            })),

            checkGachaMilestones: () => {
                const { gachaCount, chestQueue } = get();
                const milestone = getMilestoneAtCount(toBoundedInteger(gachaCount, 0, 0, MAX_GACHA_COUNT));
                if (!milestone) return;
                const newChests: ChestReward[] = [milestone].map((m) => ({
                    id: generateId(),
                    chestType: m.chestType,
                    label: m.label,
                    opened: false,
                    equipment: null,
                    isStarterCharacter: m.chestType === 'blue' && m.count === 5,
                }));
                set({ chestQueue: capChestQueue([...chestQueue, ...newChests]) });
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
                    chestQueue: capChestQueue(state.chestQueue.map((c) =>
                        c.id === chestId ? { ...c, opened: true, equipment } : c
                    )),
                    equipment: equipment
                        ? capEquipmentCollection([...state.equipment, equipment])
                        : state.equipment,
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
                const bestIdBySlot = getBestEquipmentIdsBySlot(equipment);

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
                return calculateEffectiveStats(character, equipment);
            },

            startBattle: (stage: number) => {
                const currentBattle = get().battle;
                if (!canStartBattleStage(currentBattle, stage)) return;

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
                        skillCooldowns: {},
                        guardTurnsRemaining: 0,
                        guardDamageReduction: 0,
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
                    recordBattleResult(battle.currentStage, battle.enemy, 'victory', logs);
                    return;
                }
                const guardReduction = getGuardReduction(battle, BATTLE_SKILL_CONFIG.MAX_DAMAGE_REDUCTION);
                const baseEnemyDamage = calculateDamage(battle.enemy.attack, effectiveStats.defense);
                const enemyDamage = Math.max(
                    BATTLE_CONFIG.MIN_DAMAGE,
                    Math.floor(baseEnemyDamage * (1 - guardReduction))
                );
                const nextGuardTurnsRemaining = guardReduction > 0 ? Math.max(0, battle.guardTurnsRemaining - 1) : 0;
                const nextSkillCooldowns = tickSkillCooldowns(battle.skillCooldowns);
                const newPlayerHp = Math.max(0, battle.playerHp - enemyDamage);
                logs.push({
                    turn,
                    message: `${battle.enemy.name}の攻撃！ あなたに${enemyDamage}ダメージ！${guardReduction > 0 ? ' 防御効果で軽減！' : ''}`,
                    playerHp: newPlayerHp,
                    enemyHp: newEnemyHp,
                });
                if (newPlayerHp <= 0) {
                    set({
                        battle: {
                            ...battle,
                            status: 'defeat',
                            enemy: { ...battle.enemy, hp: newEnemyHp },
                            playerHp: 0,
                            logs,
                            skillCooldowns: nextSkillCooldowns,
                            guardTurnsRemaining: nextGuardTurnsRemaining,
                            guardDamageReduction: nextGuardTurnsRemaining > 0 ? battle.guardDamageReduction : 0,
                        }
                    });
                    // バトル履歴に記録
                    recordBattleResult(battle.currentStage, battle.enemy, 'defeat', logs);
                    return;
                }
                set({
                    battle: {
                        ...battle,
                        enemy: { ...battle.enemy, hp: newEnemyHp },
                        playerHp: newPlayerHp,
                        logs,
                        skillCooldowns: nextSkillCooldowns,
                        guardTurnsRemaining: nextGuardTurnsRemaining,
                        guardDamageReduction: nextGuardTurnsRemaining > 0 ? battle.guardDamageReduction : 0,
                    }
                });
            },

            activateBattleSkill: (skillId: string) => {
                const { battle, character } = get();
                if (battle.status !== 'fighting' || !battle.enemy) return false;
                if ((battle.skillCooldowns[skillId] ?? 0) > 0) return false;

                const skill = getUnlockedBattleSkills(character.level).find((candidate) => candidate.id === skillId);
                if (!skill) return false;

                const effectiveStats = get().getEffectiveStats();
                const resolution = resolveBattleSkill(skill.id, {
                    attack: effectiveStats.attack,
                    currentHp: battle.playerHp,
                    maxHp: effectiveStats.maxHp,
                });
                if (!resolution) return false;

                const turn = battle.logs.length + 1;
                const logs: BattleLog[] = [...battle.logs];
                let enemy = battle.enemy;
                let playerHp = battle.playerHp;
                let guardTurnsRemaining = battle.guardTurnsRemaining;
                let guardDamageReduction = battle.guardDamageReduction;

                if (resolution.type === 'damage') {
                    const newEnemyHp = Math.max(0, enemy.hp - resolution.damage);
                    logs.push({
                        turn,
                        message: `${resolution.skill.name}！ ${enemy.name}に${resolution.damage}ダメージ！`,
                        playerHp,
                        enemyHp: newEnemyHp,
                    });
                    enemy = { ...enemy, hp: newEnemyHp };

                    if (newEnemyHp <= 0) {
                        set({
                            battle: {
                                ...battle,
                                status: 'victory',
                                enemy: { ...enemy, hp: 0 },
                                logs,
                                skillCooldowns: { ...battle.skillCooldowns, [skill.id]: skill.cooldownTurns },
                            }
                        });
                        get().addXp(battle.enemy.xpReward);
                        recordBattleResult(battle.currentStage, battle.enemy, 'victory', logs);
                        return true;
                    }
                } else if (resolution.type === 'heal') {
                    if (resolution.heal <= 0) return false;
                    playerHp = Math.min(effectiveStats.maxHp, playerHp + resolution.heal);
                    logs.push({
                        turn,
                        message: `${resolution.skill.name}！ HPを${resolution.heal}回復！`,
                        playerHp,
                        enemyHp: enemy.hp,
                    });
                } else {
                    guardTurnsRemaining = resolution.durationTurns;
                    guardDamageReduction = resolution.damageReduction;
                    logs.push({
                        turn,
                        message: `${resolution.skill.name}！ ${resolution.durationTurns}ターンの間、被ダメージを軽減！`,
                        playerHp,
                        enemyHp: enemy.hp,
                    });
                }

                const guardReduction = getGuardReduction(
                    { guardTurnsRemaining, guardDamageReduction },
                    BATTLE_SKILL_CONFIG.MAX_DAMAGE_REDUCTION,
                );
                const baseEnemyDamage = calculateDamage(enemy.attack, effectiveStats.defense);
                const enemyDamage = Math.max(
                    BATTLE_CONFIG.MIN_DAMAGE,
                    Math.floor(baseEnemyDamage * (1 - guardReduction))
                );
                playerHp = Math.max(0, playerHp - enemyDamage);
                const nextGuardTurnsRemaining = guardReduction > 0 ? Math.max(0, guardTurnsRemaining - 1) : 0;
                const nextSkillCooldowns = tickSkillCooldowns({
                    ...battle.skillCooldowns,
                    [skill.id]: skill.cooldownTurns + 1,
                });
                logs.push({
                    turn,
                    message: `${enemy.name}の攻撃！ あなたに${enemyDamage}ダメージ！${guardReduction > 0 ? ' 防御効果で軽減！' : ''}`,
                    playerHp,
                    enemyHp: enemy.hp,
                });

                if (playerHp <= 0) {
                    set({
                        battle: {
                            ...battle,
                            status: 'defeat',
                            enemy,
                            playerHp: 0,
                            logs,
                            skillCooldowns: nextSkillCooldowns,
                            guardTurnsRemaining: nextGuardTurnsRemaining,
                            guardDamageReduction: nextGuardTurnsRemaining > 0 ? guardDamageReduction : 0,
                        }
                    });
                    recordBattleResult(battle.currentStage, battle.enemy, 'defeat', logs);
                    return true;
                }

                set({
                    battle: {
                        ...battle,
                        enemy,
                        playerHp,
                        logs,
                        skillCooldowns: nextSkillCooldowns,
                        guardTurnsRemaining: nextGuardTurnsRemaining,
                        guardDamageReduction: nextGuardTurnsRemaining > 0 ? guardDamageReduction : 0,
                    }
                });
                return true;
            },

            resetBattle: () => set((state) => ({
                battle: {
                    ...state.battle,
                    status: 'idle',
                    enemy: null,
                    playerHp: get().getEffectiveStats().maxHp,
                    logs: [],
                    skillCooldowns: {},
                    guardTurnsRemaining: 0,
                    guardDamageReduction: 0,
                },
            })),

            advanceStage: () => set((state) => {
                const newMaxCleared = Math.max(state.battle.maxClearedStage, state.battle.currentStage);
                const nextStage = state.battle.currentStage + 1;
                return {
                    battle: {
                        ...state.battle,
                        status: 'idle',
                        currentStage: Math.min(nextStage, MAX_STAGE),
                        maxClearedStage: newMaxCleared,
                        enemy: null,
                        logs: [],
                        skillCooldowns: {},
                        guardTurnsRemaining: 0,
                        guardDamageReduction: 0,
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
                // 渡されたIDの重複チェック（不正操作防止）
                const uniqueIds = new Set(equipmentIds);
                if (uniqueIds.size !== SYNTHESIS_CONFIG.REQUIRED_COUNT) return null;
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
                set((state) => ({ chestQueue: capChestQueue([...state.chestQueue, newChest]) }));
            },
        }),
        {
            name: 'quest-board-game',
            storage: createWebPersistStorage(),
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
            merge: (persisted, current) => ({
                ...current,
                ...sanitizeGameStoreState(persisted),
                levelUpEvent: null,
                pendingChestReveal: null,
            }),
        }
    )
);
