import { XP_CONFIG } from './progression';
import { clampString } from './validation';

export type Priority = 'low' | 'medium' | 'high';
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';

export interface Subtask {
    id: string;
    name: string;
    completed: boolean;
    completedAt: string | null;
    createdAt: string;
}

export interface Task {
    id: string;
    name: string;
    dueDate: string | null;
    priority: Priority;
    tags: string[];
    subtasks: Subtask[];
    recurrence: Recurrence;
    completed: boolean;
    completedAt: string | null;
    createdAt: string;
}

export interface CreateTaskInput {
    id: string;
    name: string;
    now: string;
    dueDate?: string | null;
    priority?: Priority;
    recurrence?: Recurrence;
    tags?: string[];
    subtasks?: Subtask[];
}

export const TASK_LIMITS = {
    maxTasks: 2000,
    maxNameLength: 200,
    maxTags: 20,
    maxTagLength: 50,
    maxSubtasks: 200,
    maxSubtaskNameLength: 200,
} as const;

const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high'];
const RECURRENCES: readonly Recurrence[] = ['none', 'daily', 'weekly', 'monthly'];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPriority(value: unknown): value is Priority {
    return typeof value === 'string' && PRIORITIES.includes(value as Priority);
}

function isRecurrence(value: unknown): value is Recurrence {
    return typeof value === 'string' && RECURRENCES.includes(value as Recurrence);
}

function normalizeNullableString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function sanitizeSubtask(value: unknown): Subtask | null {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null;
    return {
        id: value.id,
        name: clampString(value.name, TASK_LIMITS.maxSubtaskNameLength),
        completed: value.completed === true,
        completedAt: normalizeNullableString(value.completedAt),
        createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    };
}

function sanitizeTask(value: unknown): Task | null {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null;
    return {
        id: value.id,
        name: clampString(value.name, TASK_LIMITS.maxNameLength),
        dueDate: normalizeNullableString(value.dueDate),
        priority: isPriority(value.priority) ? value.priority : 'medium',
        tags: Array.isArray(value.tags)
            ? value.tags
                .filter((tag): tag is string => typeof tag === 'string')
                .slice(0, TASK_LIMITS.maxTags)
                .map((tag) => clampString(tag, TASK_LIMITS.maxTagLength))
            : [],
        subtasks: Array.isArray(value.subtasks)
            ? value.subtasks
                .map(sanitizeSubtask)
                .filter((subtask): subtask is Subtask => subtask !== null)
                .slice(0, TASK_LIMITS.maxSubtasks)
            : [],
        recurrence: isRecurrence(value.recurrence) ? value.recurrence : 'none',
        completed: value.completed === true,
        completedAt: normalizeNullableString(value.completedAt),
        createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    };
}

export function createTask(input: CreateTaskInput): Task | null {
    const name = clampString(input.name.trim(), TASK_LIMITS.maxNameLength);
    if (!name || !input.id || !input.now) return null;
    return {
        id: input.id,
        name,
        dueDate: input.dueDate ?? null,
        priority: input.priority ?? 'medium',
        tags: (input.tags ?? []).slice(0, TASK_LIMITS.maxTags).map((tag) => clampString(tag, TASK_LIMITS.maxTagLength)),
        subtasks: (input.subtasks ?? []).slice(0, TASK_LIMITS.maxSubtasks),
        recurrence: input.recurrence ?? 'none',
        completed: false,
        completedAt: null,
        createdAt: input.now,
    };
}

export function toggleTaskCompletion(tasks: readonly Task[], taskId: string, now: string): Task[] {
    return tasks.map((task) => task.id === taskId
        ? {
            ...task,
            completed: !task.completed,
            completedAt: task.completed ? null : now,
        }
        : task
    );
}

export function removeTask(tasks: readonly Task[], taskId: string): Task[] {
    return tasks.filter((task) => task.id !== taskId);
}

export function sanitizeTaskCollection(value: unknown): Task[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value
        .map(sanitizeTask)
        .filter((task): task is Task => task !== null)
        .filter((task) => {
            if (seen.has(task.id)) return false;
            seen.add(task.id);
            return true;
        })
        .slice(-TASK_LIMITS.maxTasks);
}

// ─── 報酬ルール ───────────────────────────────────────────────

/** サブタスク完了のXP。優先度XPの半分（切り捨て）、最低1（Webと同一ルール）。 */
export function getSubtaskRewardXp(priority: Priority): number {
    return Math.max(1, Math.floor(XP_CONFIG.REWARD_BY_PRIORITY[priority] * XP_CONFIG.SUBTASK_REWARD_RATIO));
}

// ─── 繰り返しタスク ───────────────────────────────────────────

function daysInUtcMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** YYYY-MM-DD 形式かつ実在する日付か。 */
function isValidYmdDate(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12) return false;
    return day >= 1 && day <= daysInUtcMonth(year, month - 1);
}

function parseYmdUtc(value: string): Date {
    if (!isValidYmdDate(value)) {
        throw new RangeError(`Invalid YYYY-MM-DD date: ${value}`);
    }
    const [year, month, day] = value.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
}

function formatYmdUtc(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * YYYY-MM-DD を繰り返し周期ぶん進める。毎月は「翌月の同日」で、
 * 存在しない日（1/31→2月など）は月末に丸める（Webと同一ルール）。
 */
export function addRecurrenceInterval(dateStr: string, recurrence: Recurrence): string {
    const date = parseYmdUtc(dateStr);

    if (recurrence === 'daily') {
        date.setUTCDate(date.getUTCDate() + 1);
    } else if (recurrence === 'weekly') {
        date.setUTCDate(date.getUTCDate() + 7);
    } else if (recurrence === 'monthly') {
        const targetFirst = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
        const targetYear = targetFirst.getUTCFullYear();
        const targetMonth = targetFirst.getUTCMonth();
        const targetDay = Math.min(date.getUTCDate(), daysInUtcMonth(targetYear, targetMonth));
        return formatYmdUtc(new Date(Date.UTC(targetYear, targetMonth, targetDay)));
    }

    return formatYmdUtc(date);
}

export interface NextRecurringTaskInput {
    task: Task;
    /** 次回タスクのID */
    taskId: string;
    /** サブタスクごとのID生成器 */
    subtaskIdFor: () => string;
    /** 現在時刻 (ISO 8601) */
    now: string;
    /** 今日 (YYYY-MM-DD)。期限なしタスクの繰り返し起点に使う */
    today: string;
}

/**
 * 繰り返しタスクの次回分を生成する。recurrence が none なら null。
 * 期限は元タスクの期限（無ければ今日）を1周期分進める。
 * サブタスクは未完了状態で引き継ぐ（Webと同一ルール）。
 */
export function buildNextRecurringTask(input: NextRecurringTaskInput): Task | null {
    const { task } = input;
    if (!task.recurrence || task.recurrence === 'none') return null;
    // 期限が不正な形式なら今日を起点にする（永続化データ由来の不正値でも落とさない）
    const base = task.dueDate !== null && isValidYmdDate(task.dueDate) ? task.dueDate : input.today;
    return {
        id: input.taskId,
        name: task.name,
        dueDate: addRecurrenceInterval(base, task.recurrence),
        priority: task.priority,
        tags: [...task.tags],
        subtasks: task.subtasks.map((subtask) => ({
            id: input.subtaskIdFor(),
            name: subtask.name,
            completed: false,
            completedAt: null,
            createdAt: input.now,
        })),
        recurrence: task.recurrence,
        completed: false,
        completedAt: null,
        createdAt: input.now,
    };
}

/** 同内容の未完了繰り返しタスクが既にあるか（次回分の重複生成ガード）。 */
export function hasOpenRecurringDuplicate(tasks: readonly Task[], next: Task): boolean {
    return tasks.some((task) =>
        !task.completed
        && task.recurrence === next.recurrence
        && task.name === next.name
        && task.dueDate === next.dueDate
    );
}

// ─── サブタスク操作 ───────────────────────────────────────────

/**
 * サブタスクを追加する。親タスクは未完了へ戻す（新しい作業が増えたため）。
 * タスクが見つからない・名前が空・上限超過なら null。
 */
export function addSubtaskToTask(
    tasks: readonly Task[],
    taskId: string,
    subtask: { id: string; name: string; now: string },
): Task[] | null {
    const task = tasks.find((candidate) => candidate.id === taskId);
    const name = clampString(subtask.name.trim(), TASK_LIMITS.maxSubtaskNameLength);
    if (!task || !name || task.subtasks.length >= TASK_LIMITS.maxSubtasks) return null;

    return tasks.map((candidate) => candidate.id === taskId
        ? {
            ...candidate,
            completed: false,
            completedAt: null,
            subtasks: [
                ...candidate.subtasks,
                { id: subtask.id, name, completed: false, completedAt: null, createdAt: subtask.now },
            ],
        }
        : candidate
    );
}

export interface RemoveSubtaskResult {
    tasks: Task[];
    /** 残りのサブタスクが全完了になり、親タスクがこの操作で完了したか */
    parentCompleted: boolean;
}

/**
 * サブタスクを削除する。残りが1件以上あり全完了なら親タスクを自動完了する。
 * タスク・サブタスクが見つからなければ null。
 */
export function removeSubtaskFromTask(
    tasks: readonly Task[],
    taskId: string,
    subtaskId: string,
    now: string,
): RemoveSubtaskResult | null {
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) return null;
    const nextSubtasks = task.subtasks.filter((subtask) => subtask.id !== subtaskId);
    if (nextSubtasks.length === task.subtasks.length) return null;

    const shouldAutoComplete = nextSubtasks.length > 0 && nextSubtasks.every((subtask) => subtask.completed);
    const parentCompleted = shouldAutoComplete && !task.completed;

    return {
        tasks: tasks.map((candidate) => candidate.id === taskId
            ? {
                ...candidate,
                subtasks: nextSubtasks,
                completed: shouldAutoComplete ? true : candidate.completed && nextSubtasks.length === 0,
                completedAt: shouldAutoComplete ? (candidate.completedAt ?? now) : candidate.completedAt,
            }
            : candidate
        ),
        parentCompleted,
    };
}

export interface ToggleSubtaskResult {
    tasks: Task[];
    /** この操作でサブタスクが未完了→完了になったか（サブタスク報酬の対象） */
    completedSubtask: boolean;
    /** この操作で全サブタスク完了となり、親タスクが完了したか（タスク報酬の対象） */
    parentCompleted: boolean;
}

/**
 * サブタスクの完了をトグルする。全サブタスク完了で親タスクを自動完了し、
 * 1件でも未完了に戻せば親タスクも未完了へ戻す（Webと同一ルール）。
 */
export function toggleSubtask(
    tasks: readonly Task[],
    taskId: string,
    subtaskId: string,
    now: string,
): ToggleSubtaskResult | null {
    const task = tasks.find((candidate) => candidate.id === taskId);
    const subtask = task?.subtasks.find((candidate) => candidate.id === subtaskId);
    if (!task || !subtask) return null;

    const isCompleting = !subtask.completed;
    const nextSubtasks = task.subtasks.map((candidate) => candidate.id === subtaskId
        ? { ...candidate, completed: isCompleting, completedAt: isCompleting ? now : null }
        : candidate
    );
    const allComplete = nextSubtasks.length > 0 && nextSubtasks.every((candidate) => candidate.completed);

    return {
        tasks: tasks.map((candidate) => candidate.id === taskId
            ? {
                ...candidate,
                subtasks: nextSubtasks,
                completed: allComplete,
                completedAt: allComplete ? (candidate.completedAt ?? now) : null,
            }
            : candidate
        ),
        completedSubtask: isCompleting,
        parentCompleted: allComplete && !task.completed,
    };
}
