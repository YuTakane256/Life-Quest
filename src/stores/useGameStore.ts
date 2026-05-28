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
import {
    XP_CONFIG,
    GACHA_CONFIG,
    CHARACTER_CONFIG,
    BATTLE_CONFIG,
    EQUIPMENT_POOL,
    SELL_XP_BY_RARITY,
    RARITY_ORDER,
    SYNTHESIS_CONFIG,
    type ChestType,
    type GachaMilestone,
} from '../config/gameConfig';
import { generateId } from '../utils/dateUtils';

// ─── ヘルパー関数 ─────────────────────────────────────────────

function calculateLevel(totalXp: number): number {
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
    const template = candidates[Math.floor(Math.random() * candidates.length)];
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

function calculateDamage(attack: number, defense: number): number {
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
    return tiedSlots[Math.floor(Math.random() * tiedSlots.length)];
}

// ─── persisted state の per-item バリデーション ─────────────────
// localStorage の値を信用しない。細工された JSON が store 状態を破壊し、
// 装備合算（getEffectiveStats）や battle ループで NaN 連鎖するのを防ぐ。

function isValidEquipment(v: unknown): v is Equipment {
    if (typeof v !== 'object' || v === null) return false;
    const r = v as Record<string, unknown>;
    return typeof r.id === 'string'
        && typeof r.templateId === 'string'
        && typeof r.name === 'string'
        && (r.slot === 'weapon' || r.slot === 'armor' || r.slot === 'accessory')
        && typeof r.rarity === 'string'
        && typeof r.attackBonus === 'number' && Number.isFinite(r.attackBonus)
        && typeof r.defenseBonus === 'number' && Number.isFinite(r.defenseBonus)
        && typeof r.hpBonus === 'number' && Number.isFinite(r.hpBonus)
        && typeof r.equipped === 'boolean';
}

function isValidChestReward(v: unknown): v is ChestReward {
    if (typeof v !== 'object' || v === null) return false;
    const r = v as Record<string, unknown>;
    return typeof r.id === 'string'
        && typeof r.chestType === 'string'
        && typeof r.label === 'string'
        && typeof r.opened === 'boolean'
        && (r.equipment === null || isValidEquipment(r.equipment));
}

function isValidBattleLog(v: unknown): v is BattleLog {
    if (typeof v !== 'object' || v === null) return false;
    const r = v as Record<string, unknown>;
    return typeof r.turn === 'number' && Number.isFinite(r.turn)
        && typeof r.message === 'string'
        && typeof r.playerHp === 'number' && Number.isFinite(r.playerHp)
        && typeof r.enemyHp === 'number' && Number.isFinite(r.enemyHp);
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

function sanitizeCharacter(raw: unknown, fallback: CharacterStats): CharacterStats {
    if (typeof raw !== 'object' || raw === null) return { ...fallback };
    const r = raw as Record<string, unknown>;
    const num = (v: unknown, f: number) =>
        typeof v === 'number' && Number.isFinite(v) ? v : f;
    return {
        // name は inputLimits.ts の CHARACTER_NAME 上限 (12 文字) 相当でカット
        name: typeof r.name === 'string' ? r.name.slice(0, 12) : fallback.name,
        avatar: r.avatar === 'male' || r.avatar === 'female' ? r.avatar : fallback.avatar,
        level: Math.max(1, Math.floor(num(r.level, fallback.level))),
        totalXp: Math.max(0, Math.floor(num(r.totalXp, fallback.totalXp))),
        baseAttack: num(r.baseAttack, fallback.baseAttack),
        baseDefense: num(r.baseDefense, fallback.baseDefense),
        baseMaxHp: num(r.baseMaxHp, fallback.baseMaxHp),
    };
}

function sanitizeDebuff(raw: unknown, fallback: Debuff): Debuff {
    if (typeof raw !== 'object' || raw === null) return { ...fallback };
    const r = raw as Record<string, unknown>;
    return {
        active: typeof r.active === 'boolean' ? r.active : false,
        expiresAt: typeof r.expiresAt === 'string' ? r.expiresAt : null,
        multiplier: typeof r.multiplier === 'number' && Number.isFinite(r.multiplier) ? r.multiplier : 1,
    };
}

function sanitizeEnemy(raw: unknown): Enemy | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null;
    const stage = num(r.stage);
    const hp = num(r.hp);
    const maxHp = num(r.maxHp);
    const attack = num(r.attack);
    const defense = num(r.defense);
    const xpReward = num(r.xpReward);
    if (stage === null || hp === null || maxHp === null || attack === null
        || defense === null || xpReward === null || typeof r.name !== 'string') return null;
    return { stage, name: r.name, hp, maxHp, attack, defense, xpReward };
}

function sanitizeBattle(raw: unknown, fallback: BattleState): BattleState {
    if (typeof raw !== 'object' || raw === null) return { ...fallback };
    const r = raw as Record<string, unknown>;
    const validStatus = r.status === 'idle' || r.status === 'fighting'
        || r.status === 'victory' || r.status === 'defeat';
    const num = (v: unknown, f: number) =>
        typeof v === 'number' && Number.isFinite(v) ? v : f;
    return {
        status: validStatus ? r.status as BattleState['status'] : fallback.status,
        currentStage: Math.max(1, Math.floor(num(r.currentStage, fallback.currentStage))),
        maxClearedStage: Math.max(0, Math.floor(num(r.maxClearedStage, fallback.maxClearedStage))),
        enemy: sanitizeEnemy(r.enemy),
        playerHp: Math.max(0, Math.floor(num(r.playerHp, fallback.playerHp))),
        logs: Array.isArray(r.logs) ? r.logs.filter(isValidBattleLog) : [],
        battleUnlocked: typeof r.battleUnlocked === 'boolean' ? r.battleUnlocked : fallback.battleUnlocked,
    };
}

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

            updateCharacter: (updates) => set((state) => ({
                character: { ...state.character, ...updates }
            })),

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
                    return;
                }
                const enemyDamage = calculateDamage(battle.enemy.attack, effectiveStats.defense);
                const newPlayerHp = Math.max(0, battle.playerHp - enemyDamage);
                logs.push({ turn, message: `${battle.enemy.name}の攻撃！ あなたに${enemyDamage}ダメージ！`, playerHp: newPlayerHp, enemyHp: newEnemyHp });
                if (newPlayerHp <= 0) {
                    set({ battle: { ...battle, status: 'defeat', enemy: { ...battle.enemy, hp: newEnemyHp }, playerHp: 0, logs } });
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
                const template = candidates[Math.floor(Math.random() * candidates.length)];
                const newItem: import('../types').Equipment = {
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
            version: 1,
            merge: (persisted, current) => {
                const raw = (typeof persisted === 'object' && persisted !== null
                    ? (persisted as Record<string, unknown>)
                    : {});
                return {
                    ...current,
                    character: sanitizeCharacter(raw.character, current.character),
                    debuff: sanitizeDebuff(raw.debuff, current.debuff),
                    equipment: Array.isArray(raw.equipment) ? raw.equipment.filter(isValidEquipment) : [],
                    gachaCount: typeof raw.gachaCount === 'number' && Number.isFinite(raw.gachaCount)
                        ? Math.max(0, Math.floor(raw.gachaCount))
                        : 0,
                    chestQueue: Array.isArray(raw.chestQueue) ? raw.chestQueue.filter(isValidChestReward) : [],
                    battle: sanitizeBattle(raw.battle, current.battle),
                };
            },
        }
    )
);
