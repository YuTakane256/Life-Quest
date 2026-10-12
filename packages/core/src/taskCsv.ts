import type { Task } from './tasks.ts';

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
function neutralizeSpreadsheetFormula(text: string) {
    return FORMULA_TRIGGER_RE.test(text) ? `'${text}` : text;
}
export function escapeCsvValue(value: unknown): string {
    const text = neutralizeSpreadsheetFormula(String(value ?? ''));
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
export function tasksToCsv(tasks: readonly Task[]): string {
    const rows = tasks.map((task) =>
        [
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
            task.subtasks.filter((subtask) => subtask.completed).length,
            task.subtasks
                .map(
                    (subtask) =>
                        `${subtask.completed ? '[x]' : '[ ]'} ${neutralizeSpreadsheetFormula(subtask.name)}`,
                )
                .join('\n'),
        ]
            .map(escapeCsvValue)
            .join(','),
    );
    return [CSV_HEADERS.map(escapeCsvValue).join(','), ...rows].join('\n');
}
