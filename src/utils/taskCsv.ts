import type { Task } from '../types';

const CSV_HEADERS = [
    'id',
    'name',
    'dueDate',
    'priority',
    'recurrence',
    'tags',
    'completed',
    'completedAt',
    'createdAt',
    'subtaskCount',
    'completedSubtaskCount',
    'subtasks',
] as const;

const FORMULA_TRIGGER_RE = /^[\t\r\n ]*[=+\-@]/;

function neutralizeSpreadsheetFormula(text: string): string {
    return FORMULA_TRIGGER_RE.test(text) ? `'${text}` : text;
}

export function escapeCsvValue(value: unknown): string {
    const text = neutralizeSpreadsheetFormula(String(value ?? ''));
    if (!/[",\n\r]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
}

function formatSubtasks(task: Task): string {
    return task.subtasks
        .map((subtask) => `${subtask.completed ? '[x]' : '[ ]'} ${neutralizeSpreadsheetFormula(subtask.name)}`)
        .join('\n');
}

export function tasksToCsv(tasks: readonly Task[]): string {
    const rows = tasks.map((task) => {
        const completedSubtasks = task.subtasks.filter((subtask) => subtask.completed).length;
        return [
            task.id,
            task.name,
            task.dueDate ?? '',
            task.priority,
            task.recurrence,
            task.tags.join('; '),
            task.completed ? 'true' : 'false',
            task.completedAt ?? '',
            task.createdAt,
            task.subtasks.length,
            completedSubtasks,
            formatSubtasks(task),
        ].map(escapeCsvValue).join(',');
    });

    return [
        CSV_HEADERS.map(escapeCsvValue).join(','),
        ...rows,
    ].join('\n');
}
