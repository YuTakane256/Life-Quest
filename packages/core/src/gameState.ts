/**
 * ゲーム状態スナップショット（キャラクター・装備・宝箱・ガチャ進行・報酬台帳）の
 * 型定義と、永続化ストレージ由来の信頼できないデータを安全な形へ正規化する
 * sanitizer群。WebとMobileが同じ検証ルールを共有するための土台。
 *
 * 純粋TSのみで構成し、React / Zustand / ストレージAPIに依存しない。
 */
import { clamp } from './numeric';
import { isPersistedStateRecord } from './persist';
import { clampString } from './validation';
import { calculateLevel, CHARACTER_CONFIG, MAX_TOTAL_XP } from './progression';
import { EQUIPMENT_POOL, type ChestReward, type ChestType } from './rewards';
import type { Equipment, EquipmentSlot } from './equipment';

export const GAME_STATE_LIMITS = {
    /** インベントリに保持できる装備数の上限 */
    maxEquipmentItems: 2000,
    /** 宝箱キューの上限 */
    maxChestQueueItems: 500,
    /** キャラクター名の最大文字数 */
    maxCharacterNameLength: 30,
    /** 宝箱ラベルの最大文字数 */
    maxChestLabelLength: 120,
    /** 報酬台帳に保持するタスクID数の上限 */
    maxRewardedTaskIds: 4000,
    /** 報酬台帳に保持する習慣ボーナス日付数の上限 */
    maxHabitBonusDates: 400,
} as const;

export type AvatarId = 'male' | 'female';

export interface CharacterState {
    name: string;
    avatar: AvatarId;
    level: number;
    totalXp: number;
    baseAttack: number;
    baseDefense: number;
    baseMaxHp: number;
}

/**
 * 付与済み報酬の台帳。ゲーム状態と同一ストアで永続化することで、
 * XP付与と台帳更新が常に単一の保存単位になり、保存失敗・再hydrationで
 * 報酬だけが重複することを防ぐ。
 */
export interface RewardLedger {
    /** 完了報酬を付与済みのタスクID */
    rewardedTaskIds: string[];
    /** 習慣全達成ボーナスを付与済みの日付 (YYYY-MM-DD) */
    habitBonusDates: string[];
}

export interface GameStateSnapshot {
    character: CharacterState;
    equipment: Equipment[];
    chestQueue: ChestReward[];
    gachaCount: number;
    rewardLedger: RewardLedger;
}

const AVATARS: readonly AvatarId[] = ['male', 'female'];
const CHEST_TYPES: readonly ChestType[] = ['blue', 'wood', 'silver', 'gold', 'red_gold', 'rainbow'];
const EQUIPMENT_TEMPLATE_BY_ID = new Map(EQUIPMENT_POOL.map((template) => [template.id, template]));

export function createInitialCharacterState(): CharacterState {
    return {
        name: CHARACTER_CONFIG.INITIAL_STATS.name,
        avatar: CHARACTER_CONFIG.INITIAL_STATS.avatar,
        level: CHARACTER_CONFIG.INITIAL_STATS.level,
        totalXp: CHARACTER_CONFIG.INITIAL_STATS.totalXp,
        baseAttack: CHARACTER_CONFIG.INITIAL_STATS.attack,
        baseDefense: CHARACTER_CONFIG.INITIAL_STATS.defense,
        baseMaxHp: CHARACTER_CONFIG.INITIAL_STATS.maxHp,
    };
}

export function createEmptyRewardLedger(): RewardLedger {
    return { rewardedTaskIds: [], habitBonusDates: [] };
}

export function createInitialGameStateSnapshot(): GameStateSnapshot {
    return {
        character: createInitialCharacterState(),
        equipment: [],
        chestQueue: [],
        gachaCount: 0,
        rewardLedger: createEmptyRewardLedger(),
    };
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? clamp(Math.floor(value), min, max)
        : fallback;
}

/**
 * キャラクター状態を正規化する。totalXp を唯一の情報源として
 * レベルと基礎ステータスを再計算し、細工されたステータスを無効化する。
 */
export function sanitizeCharacterState(raw: unknown): CharacterState {
    const initial = createInitialCharacterState();
    if (!isPersistedStateRecord(raw)) return initial;

    const totalXp = boundedInteger(raw.totalXp, initial.totalXp, 0, MAX_TOTAL_XP);
    const level = calculateLevel(totalXp);

    return {
        name: typeof raw.name === 'string'
            ? clampString(raw.name, GAME_STATE_LIMITS.maxCharacterNameLength)
            : initial.name,
        avatar: typeof raw.avatar === 'string' && AVATARS.includes(raw.avatar as AvatarId)
            ? raw.avatar as AvatarId
            : initial.avatar,
        level,
        totalXp,
        baseAttack: initial.baseAttack + (level - 1) * CHARACTER_CONFIG.STAT_PER_LEVEL.attack,
        baseDefense: initial.baseDefense + (level - 1) * CHARACTER_CONFIG.STAT_PER_LEVEL.defense,
        baseMaxHp: initial.baseMaxHp + (level - 1) * CHARACTER_CONFIG.STAT_PER_LEVEL.maxHp,
    };
}

/** 装備1件を正規化する。テンプレート不明・型不正は null。ステータスはテンプレートから復元する。 */
export function sanitizeEquipmentItem(raw: unknown): Equipment | null {
    if (!isPersistedStateRecord(raw)) return null;
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

/** 上限超過時、装備中アイテムを優先して残しつつ新しい順に切り詰める。 */
export function capEquipmentCollection(items: Equipment[]): Equipment[] {
    if (items.length <= GAME_STATE_LIMITS.maxEquipmentItems) return items;

    const keepIndexes = new Set<number>();
    items
        .map((item, index) => item.equipped ? index : -1)
        .filter((index) => index >= 0)
        .slice(-GAME_STATE_LIMITS.maxEquipmentItems)
        .forEach((index) => keepIndexes.add(index));

    for (let index = items.length - 1; index >= 0 && keepIndexes.size < GAME_STATE_LIMITS.maxEquipmentItems; index--) {
        if (!items[index].equipped) keepIndexes.add(index);
    }

    return items.filter((_, index) => keepIndexes.has(index));
}

/** 装備リストを正規化する。ID重複排除・スロットごとに装備中は1つまで・上限cap。 */
export function sanitizeEquipmentCollection(raw: unknown): Equipment[] {
    if (!Array.isArray(raw)) return [];

    const seenIds = new Set<string>();
    const equippedSlots = new Set<EquipmentSlot>();
    return capEquipmentCollection(raw
        .map(sanitizeEquipmentItem)
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

/** 宝箱1件を正規化する。型不正は null。 */
export function sanitizeChestReward(raw: unknown): ChestReward | null {
    if (!isPersistedStateRecord(raw)) return null;
    if (typeof raw.id !== 'string' || !isChestType(raw.chestType) || typeof raw.label !== 'string') return null;

    const equipment = raw.equipment === null || raw.equipment === undefined
        ? null
        : sanitizeEquipmentItem(raw.equipment);

    return {
        id: raw.id,
        chestType: raw.chestType,
        label: clampString(raw.label, GAME_STATE_LIMITS.maxChestLabelLength),
        opened: raw.opened === true,
        equipment,
        ...(typeof raw.isStarterCharacter === 'boolean' ? { isStarterCharacter: raw.isStarterCharacter } : {}),
    };
}

/** 上限超過時、未開封の宝箱を優先して残しつつ新しい順に切り詰める。 */
export function capChestQueue(items: ChestReward[]): ChestReward[] {
    if (items.length <= GAME_STATE_LIMITS.maxChestQueueItems) return items;

    const keepIndexes = new Set<number>();
    items
        .map((item, index) => item.opened ? -1 : index)
        .filter((index) => index >= 0)
        .slice(-GAME_STATE_LIMITS.maxChestQueueItems)
        .forEach((index) => keepIndexes.add(index));

    for (let index = items.length - 1; index >= 0 && keepIndexes.size < GAME_STATE_LIMITS.maxChestQueueItems; index--) {
        if (items[index].opened) keepIndexes.add(index);
    }

    return items.filter((_, index) => keepIndexes.has(index));
}

/** 宝箱キューを正規化する。ID重複排除・上限cap。 */
export function sanitizeChestQueue(raw: unknown): ChestReward[] {
    if (!Array.isArray(raw)) return [];

    const seenIds = new Set<string>();
    return capChestQueue(raw
        .map(sanitizeChestReward)
        .filter((chest): chest is ChestReward => chest !== null)
        .filter((chest) => {
            if (seenIds.has(chest.id)) return false;
            seenIds.add(chest.id);
            return true;
        }));
}

function sanitizeStringList(raw: unknown, maxItems: number): string[] {
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of raw) {
        if (typeof value !== 'string' || value === '' || seen.has(value)) continue;
        seen.add(value);
        result.push(value);
    }
    return result.slice(-maxItems);
}

/** 報酬台帳を正規化する。文字列のみ・重複排除・上限cap。 */
export function sanitizeRewardLedger(raw: unknown): RewardLedger {
    if (!isPersistedStateRecord(raw)) return createEmptyRewardLedger();
    return {
        rewardedTaskIds: sanitizeStringList(raw.rewardedTaskIds, GAME_STATE_LIMITS.maxRewardedTaskIds),
        habitBonusDates: sanitizeStringList(raw.habitBonusDates, GAME_STATE_LIMITS.maxHabitBonusDates),
    };
}

/** ゲーム状態スナップショット全体を正規化する。 */
export function sanitizeGameStateSnapshot(persisted: unknown): GameStateSnapshot {
    if (!isPersistedStateRecord(persisted)) return createInitialGameStateSnapshot();

    return {
        character: sanitizeCharacterState(persisted.character),
        equipment: sanitizeEquipmentCollection(persisted.equipment),
        chestQueue: sanitizeChestQueue(persisted.chestQueue),
        gachaCount: boundedInteger(persisted.gachaCount, 0, 0, Number.MAX_SAFE_INTEGER),
        rewardLedger: sanitizeRewardLedger(persisted.rewardLedger),
    };
}
