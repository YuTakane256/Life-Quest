/**
 * アプリケーション全体で使用する型定義
 */

import type { EquipmentTemplate, Rarity, EquipmentSlot, ChestType } from '../config/gameConfig';

// ─── タスク関連 ───────────────────────────────────────────────
export type Priority = 'low' | 'medium' | 'high';

export interface Task {
    id: string;
    name: string;
    dueDate: string | null; // ISO 8601
    priority: Priority;
    tags: string[]; // ユーザー定義タグ
    completed: boolean;
    completedAt: string | null; // ISO 8601
    createdAt: string; // ISO 8601
}

/** 完了待機中のタスク（5秒Undo用） */
export interface PendingCompletion {
    taskId: string;
    timeoutId: number;
    completedAt: string;
}

// ─── 習慣関連 ───────────────────────────────────────────────
export interface Habit {
    id: string;
    name: string;
    createdAt: string; // ISO 8601
}

/** 日別の習慣達成記録 */
export interface HabitDailyRecord {
    habitId: string;
    date: string; // YYYY-MM-DD (JST)
    completed: boolean;
    memo: string;
}

/** お休みフラグ */
export interface RestDay {
    date: string; // YYYY-MM-DD (JST)
    isRest: boolean;
}

// ─── キャラクター関連 ─────────────────────────────────────────
export interface Equipment {
    id: string; // ユニークなインスタンスID
    templateId: string; // EquipmentTemplate.id への参照
    name: string;
    slot: EquipmentSlot;
    rarity: Rarity;
    attackBonus: number;
    defenseBonus: number;
    hpBonus: number;
    equipped: boolean;
}

export interface CharacterStats {
    name: string;
    avatar: 'male' | 'female';
    level: number;
    totalXp: number;
    baseAttack: number;
    baseDefense: number;
    baseMaxHp: number;
}

export interface Debuff {
    active: boolean;
    expiresAt: string | null; // ISO 8601
    multiplier: number;
}

// ─── ガチャ関連 ────────────────────────────────────────────────
export interface ChestReward {
    id: string;
    chestType: ChestType;
    label: string;
    opened: boolean;
    equipment: Equipment | null; // 開封後にセット
    isStarterCharacter?: boolean; // 初回の青宝箱
}

// ─── バトル関連 ────────────────────────────────────────────────
export interface Enemy {
    stage: number;
    name: string;
    hp: number;
    maxHp: number;
    attack: number;
    defense: number;
    xpReward: number;
}

export type BattleStatus = 'idle' | 'fighting' | 'victory' | 'defeat';

export interface BattleLog {
    turn: number;
    message: string;
    playerHp: number;
    enemyHp: number;
}

export interface BattleState {
    status: BattleStatus;
    currentStage: number;
    maxClearedStage: number;
    enemy: Enemy | null;
    playerHp: number;
    logs: BattleLog[];
    battleUnlocked: boolean; // 青宝箱獲得後にtrue
}

// ─── Store State Types ────────────────────────────────────────
export interface TaskStoreState {
    tasks: Task[];
    pendingCompletions: PendingCompletion[];
    addTask: (name: string, dueDate: string | null, priority: Priority, tags?: string[]) => void;
    updateTask: (id: string, updates: Partial<Pick<Task, 'name' | 'dueDate' | 'priority' | 'tags'>>) => void;
    deleteTask: (id: string) => void;
    toggleComplete: (id: string) => void;
    cancelPendingCompletion: (taskId: string) => void;
}

export interface HabitStoreState {
    habits: Habit[];
    dailyRecords: HabitDailyRecord[];
    restDays: RestDay[];
    addHabit: (name: string) => void;
    deleteHabit: (id: string) => void;
    toggleHabitCompletion: (habitId: string, date: string) => void;
    setHabitMemo: (habitId: string, date: string, memo: string) => void;
    setRestDay: (date: string) => void;
    isRestDay: (date: string) => boolean;
    getTodayRecords: () => HabitDailyRecord[];
    areAllHabitsComplete: (date: string) => boolean;
    checkAndResetHabits: () => void;
}

export interface LevelUpEvent {
    id: string;
    fromLevel: number;
    toLevel: number;
    attackGain: number;
    defenseGain: number;
    hpGain: number;
}

export interface GameStoreState {
    character: CharacterStats;
    debuff: Debuff;
    equipment: Equipment[];
    gachaCount: number;
    chestQueue: ChestReward[];
    battle: BattleState;
    levelUpEvent: LevelUpEvent | null;
    clearLevelUpEvent: () => void;
    addXp: (baseXp: number) => void;
    incrementGachaCount: () => void;
    checkGachaMilestones: () => void;
    openChest: (chestId: string) => void;
    equipItem: (equipmentId: string) => void;
    unequipItem: (equipmentId: string) => void;
    applyDebuff: () => void;
    clearExpiredDebuffs: () => void;
    getEffectiveStats: () => { attack: number; defense: number; maxHp: number };
    startBattle: (stage: number) => void;
    processBattleTurn: () => void;
    resetBattle: () => void;
    advanceStage: () => void;
    updateCharacter: (updates: Partial<Pick<CharacterStats, 'name' | 'avatar'>>) => void;
    sellItem: (equipmentId: string) => number; // 売却して得たXPを返す
    synthesizeItems: (equipmentIds: string[]) => Equipment | null; // 合成結果の装備を返す
}

// ─── 統計関連 ──────────────────────────────────────────────────
export interface StatsStoreState {
    taskXpLog: Record<string, number>; // YYYY-MM-DD => 合計XP
    habitLog: Record<string, { count: number; allComplete: boolean }>; // YYYY-MM-DD => 習慣データ
    logTaskXp: (date: string, xp: number) => void;
    logHabitActivity: (date: string, count: number, allComplete: boolean) => void;
}

// ─── ユーティリティ型 ──────────────────────────────────────────
export type { Rarity, EquipmentSlot, ChestType, EquipmentTemplate };
