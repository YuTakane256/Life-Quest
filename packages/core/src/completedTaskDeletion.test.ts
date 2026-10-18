import { describe, expect, it } from 'vitest';
import { captureCompletedTaskDeletion, createTask, removeCompletedTasks, type Task } from './tasks.ts';

function task(id = 'done'): Task {
    return { ...createTask({ id, name: id, now: '2026-10-19T00:00:00.000Z', tags: ['test'],
        subtasks: [{ id: 'sub', name: 'sub', completed: true, completedAt: '2026-10-19T00:00:00.000Z', createdAt: '2026-10-18T00:00:00.000Z' }] })!,
    completed: true, completedAt: '2026-10-19T00:00:00.000Z' };
}
describe('completed task deletion approval', () => {
    it('確認時の対象を固定し、後から完了したタスクは追加しない', () => {
        const done = task(); const approval = captureCompletedTaskDeletion([done, { ...task('open'), completed: false }, task('pending')], new Set(['pending']));
        expect(approval.count).toBe(1);
        expect(approval.resolve([done, task('open'), task('pending')])).toEqual(['done']);
    });
    it('同値pull・プロパティ順・無関係な追加では承認を維持する', () => {
        const done = task(); const approval = captureCompletedTaskDeletion([done]);
        const reordered = Object.fromEntries(Object.entries(done).reverse()) as unknown as Task;
        expect(approval.resolve([JSON.parse(JSON.stringify(reordered)), task('new')])).toEqual(['done']);
    });
    it.each(Object.keys(task()) as (keyof Task)[])('%s変更は承認しない', (key) => {
        const done = task(); const approval = captureCompletedTaskDeletion([done]);
        const changed = { ...done, [key]: key === 'subtasks' ? [] : key === 'tags' ? ['changed'] : key === 'completed' ? false : 'changed' } as Task;
        expect(approval.resolve([changed])).toEqual([]);
    });
    it('入れ子のin-place変更も元の承認へ混ぜない', () => {
        const done = task(); const approval = captureCompletedTaskDeletion([done]);
        done.subtasks[0].name = 'changed'; expect(approval.resolve([done])).toEqual([]);
    });
    it('消えた対象と新しいUndo待ちは除外し、残る未変更対象だけを返す', () => {
        const approval = captureCompletedTaskDeletion([task('gone'), task('pending'), task('keep')]);
        expect(approval.resolve([task('pending'), task('keep')], new Set(['pending']))).toEqual(['keep']);
    });
    it('空の承認はその後の完了を削除対象にしない', () => {
        const approval = captureCompletedTaskDeletion([]);
        expect(approval.count).toBe(0); expect(approval.resolve([task()])).toEqual([]);
    });
    it('任意の承認ID集合を削除処理でも制限し、省略時の既存動作を維持する', () => {
        const tasks = [task('approved'), task('new'), task('pending'), { ...task('open'), completed: false }];
        expect(removeCompletedTasks(tasks, new Set(['pending']), new Set(['approved', 'pending']))).toEqual(tasks.slice(1));
        expect(removeCompletedTasks(tasks, new Set(), new Set())).toEqual(tasks);
        expect(removeCompletedTasks(tasks, new Set(['pending']))).toEqual(tasks.slice(2));
    });
});
