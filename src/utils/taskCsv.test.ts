import { describe, expect, it } from 'vitest';
import { escapeCsvValue, tasksToCsv } from './taskCsv';
import type { Task } from '../types';

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'task-1',
        name: 'Write report',
        dueDate: '2026-06-30',
        priority: 'high',
        tags: ['work', 'deep'],
        subtasks: [],
        recurrence: 'none',
        completed: false,
        completedAt: null,
        createdAt: '2026-06-23T00:00:00.000Z',
        ...overrides,
    };
}

describe('escapeCsvValue', () => {
    it('escapes quotes, commas, and line breaks', () => {
        expect(escapeCsvValue('plain')).toBe('plain');
        expect(escapeCsvValue('a,b')).toBe('"a,b"');
        expect(escapeCsvValue('a"b')).toBe('"a""b"');
        expect(escapeCsvValue('a\nb')).toBe('"a\nb"');
    });

    it('neutralizes spreadsheet formula-like values', () => {
        expect(escapeCsvValue('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
        expect(escapeCsvValue('+cmd')).toBe("'+cmd");
        expect(escapeCsvValue('-10')).toBe("'-10");
        expect(escapeCsvValue('@user')).toBe("'@user");
        expect(escapeCsvValue('  =SUM(A1:A2)')).toBe("'  =SUM(A1:A2)");
    });
});

describe('tasksToCsv', () => {
    it('exports task fields and subtask counts', () => {
        const csv = tasksToCsv([
            makeTask({
                name: 'Report, "Q2"',
                subtasks: [
                    { id: 'sub-1', name: 'Draft', completed: true, completedAt: '2026-06-23T01:00:00.000Z', createdAt: '2026-06-23T00:00:00.000Z' },
                    { id: 'sub-2', name: 'Review', completed: false, completedAt: null, createdAt: '2026-06-23T00:00:00.000Z' },
                ],
            }),
        ]);

        expect(csv.split('\n')[0]).toContain('id,name,dueDate');
        expect(csv).toContain('"Report, ""Q2"""');
        expect(csv).toContain(',2,1,');
        expect(csv).toContain('[x] Draft');
        expect(csv).toContain('[ ] Review');
    });

    it('exports formula-like task content as spreadsheet text', () => {
        const csv = tasksToCsv([
            makeTask({
                name: '=IMPORTXML("https://example.com")',
                tags: ['+urgent'],
                subtasks: [
                    { id: 'sub-1', name: '@mention', completed: false, completedAt: null, createdAt: '2026-06-23T00:00:00.000Z' },
                ],
            }),
        ]);

        expect(csv).toContain('"\'=IMPORTXML(""https://example.com"")"');
        expect(csv).toContain("'+urgent");
        expect(csv).toContain("[ ] '@mention");
    });
});
