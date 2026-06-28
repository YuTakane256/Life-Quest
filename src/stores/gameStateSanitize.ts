/**
 * ゲームストアの初期 state と、localStorage から読み込んだ永続化データの
 * サニタイズ処理。useGameStore から分離。
 *
 * localStorage の値は信用せず、各フィールドを型ガード・範囲チェックで検証して
 * 既定値へフォールバックする。細工された保存データで NaN 連鎖やモーダルの
 * 不正発火が起きないようにするのが目的。
 */
import type {
    CharacterStats,
    Debuff,
    Equipment,
    EquipmentSlot,
    ChestReward,
    BattleState,
    Enemy,
    BattleLog,
} from '../types';
import {
    XP_CONFIG,
    CHARACTER_CONFIG,
    BATTLE_CONFIG,
    EQUIPMENT_POOL,
    UI_CONFIG,
    type ChestType,
} from '../config/gameConfig';
import { BATTLE_SKILL_CONFIG } from '../config/battleSkills';
import { clampString } from '../utils/validation';
import { isPlainObject, isFiniteNumber, toNonNegativeInteger, toBoundedInteger } from '../utils/persistSanitize';
import { calculateLevel } from './gameXp';

export const initialCharacter: CharacterStats = {
    name: CHARACTER_CONFIG.INITIAL_STATS.name,
    avatar: CHARACTER_CONFIG.INITIAL_STATS.avatar,
    level: CHARACTER_CONFIG.INITIAL_STATS.level,
    totalXp: CHARACTER_CONFIG.INITIAL_STATS.totalXp,
    baseAttack: CHARACTER_CONFIG.INITIAL_STATS.attack,
    baseDefense: CHARACTER_CONFIG.INITIAL_STATS.defense,
    baseMaxHp: CHARACTER_CONFIG.INITIAL_STATS.maxHp,
};

export const initialDebuff: Debuff = { active: false, expiresAt: null, multiplier: 1 };

export const initialBattle: BattleState = {
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

export interface GameStorePersisted {
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
export const MAX_STAGE = BATTLE_CONFIG.STAGES[BATTLE_CONFIG.STAGES.length - 1]?.stage ?? 1;

function sanitizeSkillCooldowns(raw: unknown): Record<string, number> {
    if (!isPlainObject(raw)) return {};
    return Object.fromEntries(
        Object.entries(raw)
            .filter(([skillId, turns]) => typeof skillId === 'string' && isFiniteNumber(turns) && turns > 0)
            .map(([skillId, turns]) => [skillId, Math.floor(turns as number)])
    );
}

function sanitizeCharacter(raw: unknown): CharacterStats {
    if (!isPlainObject(raw)) return { ...initialCharacter };

    const totalXp = toNonNegativeInteger(raw.totalXp, initialCharacter.totalXp);
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

function sanitizeEquipmentList(raw: unknown): Equipment[] {
    if (!Array.isArray(raw)) return [];

    const seenIds = new Set<string>();
    const equippedSlots = new Set<EquipmentSlot>();
    return raw
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
        });
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
        gachaCount: toNonNegativeInteger(persisted.gachaCount, 0),
        chestQueue: Array.isArray(persisted.chestQueue)
            ? persisted.chestQueue.map(sanitizeChest).filter((chest): chest is ChestReward => chest !== null)
            : [],
        battle: sanitizeBattle(persisted.battle, character),
    };
}
