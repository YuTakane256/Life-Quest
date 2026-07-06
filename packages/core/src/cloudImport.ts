/**
 * ローカルデータのクラウド取り込みペイロード構築（#506、ADR-011）。
 *
 * クライアントのローカルスナップショット（core型）を、import_snapshot_apply /
 * import_mobile_content_apply が受け取るDB行ペイロードへ変換する。
 * Edge Functionがこのモジュールを直接importして使う（ADR-002案B）。
 *
 * ローカルID（`${Date.now()}-乱数` 等、UUIDとは限らない）は client_id として送り、
 * 実IDはサーバーがUUIDで採番する。参照（サブタスク→タスク、ログ→習慣、報酬台帳）は
 * client_id 経由でサーバーが解決する。
 */
import { sanitizeTaskCollection, type Task } from './tasks.ts';
import { sanitizeHabitCollection, sanitizeHabitRecords, type RestDay } from './habits.ts';
import { EQUIPMENT_POOL, GACHA_CONFIG, type ChestType } from './rewards.ts';
import type { RewardLedger } from './gameState.ts';

const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function toYmdOrNull(value: unknown): string | null {
    return typeof value === 'string' && YMD_PATTERN.test(value.slice(0, 10)) ? value.slice(0, 10) : null;
}

function toTimestampOrNull(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    return Number.isFinite(Date.parse(value)) ? value : null;
}

const CHEST_TYPES = Object.keys(GACHA_CONFIG.DROP_RATES) as ChestType[];

export interface ImportStatsDaily {
    date: string;
    taskXp?: number;
    habitCount?: number;
    allComplete?: boolean;
}

export interface ImportCharacterInput {
    name?: string;
    avatar?: string;
    totalXp?: number;
    gachaCount?: number;
    battleUnlocked?: boolean;
    currentStage?: number;
    maxClearedStage?: number;
    debuffActive?: boolean;
    debuffExpiresAt?: string | null;
}

export interface ImportSnapshotInput {
    tasks?: unknown;
    habits?: unknown;
    dailyRecords?: unknown;
    restDays?: RestDay[];
    allCompleteDates?: string[];
    statsDaily?: ImportStatsDaily[];
    rewardLedger?: Partial<RewardLedger>;
    character?: ImportCharacterInput;
    equipment?: { templateId?: string; equipped?: boolean }[];
    chestQueue?: { chestType?: string; label?: string; isStarterCharacter?: boolean; opened?: boolean }[];
    activeTitle?: string | null;
    settings?: Record<string, unknown>;
}

/** import_*_apply のDB行ペイロード */
export interface ImportPayload {
    tasks: Record<string, unknown>[];
    subtasks: Record<string, unknown>[];
    habits: Record<string, unknown>[];
    habit_logs: Record<string, unknown>[];
    rest_days: Record<string, unknown>[];
    stats_daily: Record<string, unknown>[];
    inventory_items: Record<string, unknown>[];
    chests: Record<string, unknown>[];
    ledger: {
        task_client_ids: string[];
        subtask_client_ids: string[];
        habit_bonus_dates: string[];
    };
    character: Record<string, unknown> | null;
    active_title: string | null;
    settings: Record<string, unknown> | null;
}

function buildTaskRows(tasks: Task[]) {
    const taskRows: Record<string, unknown>[] = [];
    const subtaskRows: Record<string, unknown>[] = [];
    for (const task of tasks) {
        taskRows.push({
            client_id: task.id,
            name: task.name,
            due_date: toYmdOrNull(task.dueDate),
            priority: task.priority,
            recurrence: task.recurrence,
            tags: task.tags,
            completed: task.completed,
            completed_at: toTimestampOrNull(task.completedAt),
            created_at: toTimestampOrNull(task.createdAt),
        });
        for (const subtask of task.subtasks) {
            subtaskRows.push({
                client_id: subtask.id,
                task_client_id: task.id,
                name: subtask.name,
                completed: subtask.completed,
                completed_at: toTimestampOrNull(subtask.completedAt),
                created_at: toTimestampOrNull(subtask.createdAt),
            });
        }
    }
    return { taskRows, subtaskRows };
}

/**
 * ローカルスナップショットをDB取り込みペイロードへ変換する。
 * 各コレクションはcoreのサニタイザで検証・上限capし、日付・参照が不正な行は落とす。
 */
export function buildImportPayload(input: ImportSnapshotInput): ImportPayload {
    const tasks = sanitizeTaskCollection(input.tasks);
    const habits = sanitizeHabitCollection(input.habits);
    const habitIds = new Set(habits.map((habit) => habit.id));
    const records = sanitizeHabitRecords(input.dailyRecords, habitIds)
        .filter((record) => toYmdOrNull(record.date) !== null);

    const { taskRows, subtaskRows } = buildTaskRows(tasks);

    const taskIds = new Set(tasks.map((task) => task.id));
    const subtaskIds = new Set(tasks.flatMap((task) => task.subtasks.map((subtask) => subtask.id)));

    // 証跡 = 完了済み項目 ∪ クライアント台帳（取り込む項目に存在するものだけ）
    const ledgerTaskIds = new Set(tasks.filter((task) => task.completed).map((task) => task.id));
    for (const id of input.rewardLedger?.rewardedTaskIds ?? []) {
        if (taskIds.has(id)) ledgerTaskIds.add(id);
    }
    const ledgerSubtaskIds = new Set(
        tasks.flatMap((task) => task.subtasks.filter((subtask) => subtask.completed).map((subtask) => subtask.id)),
    );
    for (const id of input.rewardLedger?.rewardedSubtaskIds ?? []) {
        if (subtaskIds.has(id)) ledgerSubtaskIds.add(id);
    }
    const bonusDates = new Set<string>();
    for (const date of [...(input.allCompleteDates ?? []), ...(input.rewardLedger?.habitBonusDates ?? [])]) {
        const ymd = toYmdOrNull(date);
        if (ymd) bonusDates.add(ymd);
    }

    const character = input.character
        ? {
            name: typeof input.character.name === 'string' ? input.character.name.slice(0, 30) : null,
            avatar: input.character.avatar === 'male' ? 'male' : 'female',
            total_xp: Math.max(0, Math.floor(Number(input.character.totalXp ?? 0)) || 0),
            gacha_count: Math.max(0, Math.floor(Number(input.character.gachaCount ?? 0)) || 0),
            battle_unlocked: input.character.battleUnlocked === true,
            current_stage: Math.max(1, Math.floor(Number(input.character.currentStage ?? 1)) || 1),
            max_cleared_stage: Math.max(0, Math.floor(Number(input.character.maxClearedStage ?? 0)) || 0),
            debuff_active: input.character.debuffActive === true,
            debuff_expires_at: toTimestampOrNull(input.character.debuffExpiresAt),
        }
        : null;

    const knownTemplates = new Set(EQUIPMENT_POOL.map((template) => template.id));

    return {
        tasks: taskRows,
        subtasks: subtaskRows,
        habits: habits.map((habit) => ({
            client_id: habit.id,
            name: habit.name,
            category_id: habit.categoryId,
            created_at: toTimestampOrNull(habit.createdAt),
        })),
        habit_logs: records.map((record) => ({
            habit_client_id: record.habitId,
            date: toYmdOrNull(record.date),
            completed: record.completed,
            memo: record.memo,
        })),
        rest_days: (input.restDays ?? [])
            .filter((restDay) => toYmdOrNull(restDay.date) !== null)
            .map((restDay) => ({ date: toYmdOrNull(restDay.date), is_rest: restDay.isRest === true })),
        stats_daily: (input.statsDaily ?? [])
            .filter((entry) => toYmdOrNull(entry.date) !== null)
            .map((entry) => ({
                date: toYmdOrNull(entry.date),
                all_habits_complete: entry.allComplete === true,
                task_xp: Math.max(0, Math.floor(Number(entry.taskXp ?? 0)) || 0),
                habit_count: Math.max(0, Math.floor(Number(entry.habitCount ?? 0)) || 0),
            })),
        inventory_items: (input.equipment ?? [])
            .filter((item) => typeof item.templateId === 'string' && knownTemplates.has(item.templateId))
            .map((item) => ({ template_id: item.templateId, equipped: item.equipped === true })),
        chests: (input.chestQueue ?? [])
            .filter((chest) => typeof chest.chestType === 'string' && (CHEST_TYPES as string[]).includes(chest.chestType))
            .map((chest) => ({
                chest_type: chest.chestType,
                label: typeof chest.label === 'string' ? chest.label.slice(0, 100) : '',
                is_starter_character: chest.isStarterCharacter === true,
                opened: chest.opened === true,
            })),
        ledger: {
            task_client_ids: [...ledgerTaskIds],
            subtask_client_ids: [...ledgerSubtaskIds],
            habit_bonus_dates: [...bonusDates].sort(),
        },
        character,
        active_title: typeof input.activeTitle === 'string' ? input.activeTitle.slice(0, 40) : null,
        settings: input.settings ?? null,
    };
}

/** Mobile固有コンテンツ（承認済みのタスク・習慣のみ）のペイロード。 */
export function buildMobileContentPayload(input: {
    tasks?: unknown;
    habits?: unknown;
    dailyRecords?: unknown;
}): ImportPayload {
    return buildImportPayload({
        tasks: input.tasks,
        habits: input.habits,
        dailyRecords: input.dailyRecords,
    });
}

/** 移行前バックアップの保存キー（ADR-009 namespace。削除は退会時のみ、#516） */
export function preMigrationBackupKey(userId: string): string {
    return `life-quest:cloud:${userId}:pre-migration-backup:v1`;
}
