/**
 * アプリケーション全体で使用する型定義
 */

import type { EquipmentTemplate, Rarity, EquipmentSlot, ChestType } from '../config/gameConfig';

// ─── タスク関連 ───────────────────────────────────────────────
export type Priority = 'low' | 'medium' | 'high';

/** タスクの繰り返し周期 */
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';

export interface Task {
    id: string;
    name: string;
    dueDate: string | null; // ISO 8601
    priority: Priority;
    tags: string[]; // ユーザー定義タグ
    subtasks: Subtask[];
    recurrence: Recurrence; // 繰り返し設定（none = 繰り返しなし）
    completed: boolean;
    completedAt: string | null; // ISO 8601
    createdAt: string; // ISO 8601
}

export interface Subtask {
    id: string;
    name: string;
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
    categoryId: string; // habitCategories.ts の HabitCategory.id
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
    skillCooldowns: Record<string, number>;
    guardTurnsRemaining: number;
    guardDamageReduction: number;
}

/** 過去のバトル結果スナップショット。useBattleHistoryStore で永続化。 */
export interface BattleHistoryEntry {
    id: string;
    timestamp: string;       // ISO 8601
    stage: number;
    enemyName: string;
    enemyMaxHp: number;      // リプレイ開始時のHPバー初期値
    enemyAttack: number;
    enemyDefense: number;
    outcome: 'victory' | 'defeat';
    turnCount: number;
    xpEarned: number;        // 敗北時は 0
    logs: BattleLog[];       // バトル中の全ログ
}

// ─── Store State Types ────────────────────────────────────────
export interface TaskStoreState {
    tasks: Task[];
    pendingCompletions: PendingCompletion[];
    addTask: (name: string, dueDate: string | null, priority: Priority, recurrence: Recurrence, tags?: string[], subtasks?: Subtask[]) => void;
    updateTask: (id: string, updates: Partial<Pick<Task, 'name' | 'dueDate' | 'priority' | 'tags' | 'subtasks' | 'recurrence'>>) => void;
    deleteTask: (id: string) => void;
    duplicateTask: (id: string) => string | null; // 既存タスクを複製して新規追加。新タスクIDを返す（元タスクが無ければ null）
    deleteCompletedTasks: () => void; // 完了タスクを一括削除（保留中は除外）
    toggleComplete: (id: string) => void;
    addSubtask: (taskId: string, name: string) => void;
    deleteSubtask: (taskId: string, subtaskId: string) => void;
    toggleSubtaskComplete: (taskId: string, subtaskId: string) => void;
    cancelPendingCompletion: (taskId: string) => void;
}

export interface HabitStoreState {
    habits: Habit[];
    dailyRecords: HabitDailyRecord[];
    restDays: RestDay[];
    allCompleteRewardDates: string[];
    addHabit: (name: string, categoryId?: string) => void;
    deleteHabit: (id: string) => void;
    toggleHabitCompletion: (habitId: string, date: string) => void;
    setHabitMemo: (habitId: string, date: string, memo: string) => void;
    setRestDay: (date: string) => void;
    isRestDay: (date: string) => boolean;
    getTodayRecords: () => HabitDailyRecord[];
    areAllHabitsComplete: (date: string) => boolean;
    getHabitStreak: (habitId: string) => number; // 現在の連続達成日数
    getHabitCompletionRate: (habitId: string) => number | null; // 過去30日の達成率(%)。対象日が無ければnull
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

export interface ChestRevealEvent {
    id: string;
    chestId: string;
    chestType: ChestType;
    label: string;
    equipment: Equipment | null; // 青宝箱（スターターキャラ）は null
    isStarterCharacter: boolean;
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
    pendingChestReveal: ChestRevealEvent | null;
    clearPendingChestReveal: () => void;
    addXp: (baseXp: number) => void;
    incrementGachaCount: () => void;
    checkGachaMilestones: () => void;
    openChest: (chestId: string) => void;
    equipItem: (equipmentId: string) => void;
    unequipItem: (equipmentId: string) => void;
    autoEquipBest: () => boolean; // 各スロットで最強の装備を装着。変更があれば true。
    applyDebuff: () => void;
    clearExpiredDebuffs: () => void;
    getEffectiveStats: () => { attack: number; defense: number; maxHp: number };
    startBattle: (stage: number) => void;
    processBattleTurn: () => void;
    activateBattleSkill: (skillId: string) => boolean;
    resetBattle: () => void;
    advanceStage: () => void;
    updateCharacter: (updates: Partial<Pick<CharacterStats, 'name' | 'avatar'>>) => void;
    sellItem: (equipmentId: string) => number; // 売却して得たXPを返す
    synthesizeItems: (equipmentIds: string[]) => Equipment | null; // 合成結果の装備を返す
    grantChest: (chestType: ChestType, label: string) => void; // 任意の宝箱を宝箱キューに追加
}

// ─── デイリーログインボーナス関連 ─────────────────────────────
/** 1回のログインボーナスの内容（モーダル表示用） */
export interface LoginBonus {
    date: string; // YYYY-MM-DD (JST)
    streak: number; // 連続ログイン日数
    xp: number; // 付与されたXP
    chestLabel: string | null; // 特別宝箱を付与した場合のラベル（無ければnull）
}

export interface LoginBonusStoreState {
    lastLoginDate: string | null; // 最後にボーナスを受け取った日 YYYY-MM-DD (JST)
    streak: number; // 現在の連続ログイン日数
    pendingBonus: LoginBonus | null; // 未表示のログインボーナス（モーダル表示待ち）
    checkDailyLogin: () => void; // アプリ起動時に呼び出してボーナス判定を行う
    clearPendingBonus: () => void; // モーダルを閉じたときに呼び出す
}

// ─── 通知関連 ──────────────────────────────────────────────────
export interface NotificationStoreState {
    enabled: boolean; // 通知のON/OFF
    notifiedTaskIds: string[]; // 期限通知を済ませたタスクID（重複通知防止）
    lastHabitReminderDate: string | null; // 習慣リマインダーを出した日 YYYY-MM-DD (JST)
    habitReminderHour: number; // 習慣リマインダーを出すJST時刻（時、0-23）
    setEnabled: (enabled: boolean) => void;
    setHabitReminderHour: (hour: number) => void;
    markTaskNotified: (taskId: string) => void;
    markHabitReminded: (date: string) => void;
    pruneNotifiedTasks: (validTaskIds: string[]) => void; // 削除済みタスクのIDを掃除
}

// ─── 統計関連 ──────────────────────────────────────────────────
export interface StatsStoreState {
    taskXpLog: Record<string, number>; // YYYY-MM-DD => 合計XP
    habitLog: Record<string, { count: number; allComplete: boolean }>; // YYYY-MM-DD => 習慣データ
    logTaskXp: (date: string, xp: number) => void;
    logHabitActivity: (date: string, count: number, allComplete: boolean) => void;
}

export interface BattleHistoryStoreState {
    history: BattleHistoryEntry[];
    addBattleResult: (entry: BattleHistoryEntry) => void;
    clearHistory: () => void;
}

// ─── ユーティリティ型 ──────────────────────────────────────────
export type { Rarity, EquipmentSlot, ChestType, EquipmentTemplate };
