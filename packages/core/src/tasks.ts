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
