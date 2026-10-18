import { expect, test } from '@playwright/test';
import { dismissStartupDialogs } from './helpers';

for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: bulk deletion keeps newly completed and edited tasks`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await page.addInitScript(() => {
            if (sessionStorage.getItem('bulk-fixture')) return;
            localStorage.clear(); sessionStorage.setItem('bulk-fixture', 'true');
            const tasks = ['approved', 'edited', 'later'].map((id) => ({ id, name: id, dueDate: null, priority: 'medium', tags: [], subtasks: [],
                recurrence: 'none', completed: id !== 'later', completedAt: id === 'later' ? null : '2026-10-18T00:00:00.000Z', createdAt: '2026-10-17T00:00:00.000Z' }));
            localStorage.setItem('quest-board-tasks', JSON.stringify({ state: { tasks }, version: 0 }));
        });
        await page.goto('/tasks'); await dismissStartupDialogs(page);
        const prompt = page.getByRole('dialog', { name: '完了タスクを削除しますか？' });
        await page.getByRole('button', { name: '完了2件を削除', exact: true }).click();
        await prompt.getByRole('button', { name: 'キャンセル', exact: true }).click();
        await expect(page.getByRole('button', { name: '完了2件を削除', exact: true })).toBeVisible();
        await page.getByRole('button', { name: '完了2件を削除', exact: true }).click();
        // Isolated Playwright profile only: simulate a pull while the real prompt stays open.
        await page.evaluate(async () => {
            const modulePath = '/src/stores/useTaskStore.ts';
            const { useTaskStore } = await import(modulePath);
            useTaskStore.setState((state: { tasks: Array<{ id: string; name: string; completed: boolean; completedAt: string | null }> }) => ({
                tasks: state.tasks.map((task) => task.id === 'edited' ? { ...task, name: '同期で更新されたタスク' }
                    : task.id === 'later' ? { ...task, completed: true, completedAt: '2026-10-19T00:00:00.000Z' } : task),
            }));
        });
        await expect(prompt).toContainText('タスク2件');
        await prompt.getByRole('button', { name: '削除する', exact: true }).click();
        await expect(prompt).toHaveCount(0);
        await expect(page.getByRole('button', { name: '完了2件を削除', exact: true })).toBeVisible();
        await page.reload();
        await expect(page.getByRole('button', { name: '完了2件を削除', exact: true })).toBeVisible();
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-tasks')!).state.tasks);
        expect(stored.map((item: { id: string }) => item.id)).toEqual(['edited', 'later']);
        expect(stored[0].name).toBe('同期で更新されたタスク');
    });
}
