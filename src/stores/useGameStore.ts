import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
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
import { toNonNegativeInteger } from '../utils/persistSanitize';
import { calculateLevel, calculateDamage } from './gameXp';
import {
    initialCharacter,
    initialDebuff,
    initialBattle,
    MAX_STAGE,
    sanitizeGameStoreState,
} from './gameStateSanitize';

// XP・ダメージ計算は ./gameXp、初期 state と永続化サニタイズは ./gameStateSanitize に分離した。
// 既存の import パス（'./useGameStore' 経由の取得）を壊さないよう、ここから再エクスポートする。
export { calculateLevel, calculateNextLevelXp, calculateXpProgress, calculateDamage } from './gameXp';
export { sanitizeGameStoreState } from './gameStateSanitize';

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

function canStartBattleStage(battle: BattleState, stage: number): boolean {
    if (!battle.battleUnlocked) return false;
    if (!Number.isInteger(stage) || stage < 1 || stage > MAX_STAGE) return false;
    return stage <= battle.maxClearedStage + 1;
}

function tickSkillCooldowns(cooldowns: Record<string, number>): Record<string, number> {
    return Object.fromEntries(
        Object.entries(cooldowns)
            .map(([skillId, turns]) => [skillId, Math.max(0, turns - 1)] as const)
            .filter(([, turns]) => turns > 0)
    );
}

function getGuardReduction(battle: BattleState): number {
    return battle.guardTurnsRemaining > 0
        ? Math.max(0, Math.min(BATTLE_SKILL_CONFIG.MAX_DAMAGE_REDUCTION, battle.guardDamageReduction))
        : 0;
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
                const safeBaseXp = toNonNegativeInteger(baseXp, 0);
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
                const guardReduction = getGuardReduction(battle);
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

                const guardReduction = getGuardReduction({ ...battle, guardTurnsRemaining, guardDamageReduction });
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
                const items = equipmentIds.map((id) => equipment.find((e) => e.id === id)).filter(Boolean) as Equipment[];
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
            merge: (persisted, current) => ({
                ...current,
                ...sanitizeGameStoreState(persisted),
                levelUpEvent: null,
                pendingChestReveal: null,
            }),
        }
    )
);
