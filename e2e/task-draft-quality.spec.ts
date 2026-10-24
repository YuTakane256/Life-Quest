import { expect, test } from '@playwright/test';
import { createWebParityStorage, PARITY_FIXED_NOW } from '@life-quest/core/parityFixture';

for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: an edited child list cannot erase a concurrently received child`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await page.clock.install({ time: new Date(PARITY_FIXED_NOW) });
        await page.addInitScript((storage) => {
            for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
        }, createWebParityStorage(theme));
        await page.goto('/tasks');
        await page.getByRole('button', { name: '編集', exact: true }).first().click();
        await page.getByPlaceholder('サブタスクを入力 (Enterで追加)').fill('Draft child');
        await page.getByPlaceholder('サブタスクを入力 (Enterで追加)').press('Enter');
        await page.evaluate(async () => {
            const { useTaskStore } = await import('/src/stores/useTaskStore.ts');
            // A cloud pull can replace this collection while the form is open.
            useTaskStore.setState((state) => ({ tasks: state.tasks.map((task) => task.id === 'parity-plan-week'
                ? { ...task, subtasks: [...task.subtasks, { id: 'received-child', name: 'Received child', completed: false,
                    completedAt: null, createdAt: '2026-10-25T00:00:00.000Z' }] } : task) }));
        });
        await page.getByRole('button', { name: '更新', exact: true }).click();
        await expect(page.getByRole('alert').filter({ hasText: 'このタスクは変更または削除されています' })).toBeVisible();
        const names = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-tasks')!).state.tasks
            .find((task: { id: string }) => task.id === 'parity-plan-week').subtasks.map((child: { name: string }) => child.name));
        expect(names).toContain('Received child'); expect(names).not.toContain('Draft child');
        await expect(page.locator('form').getByText('Draft child', { exact: true })).toBeVisible();
    });

    test(`${theme}: task draft does not overwrite a concurrently completed task`, async ({ page }, testInfo) => {
        if (testInfo.project.name === 'mobile-chromium') await page.setViewportSize({ width: 402, height: 874 });
        await page.emulateMedia({ colorScheme: theme });
        await page.clock.install({ time: new Date(PARITY_FIXED_NOW) });
        await page.addInitScript((storage) => {
            if (sessionStorage.getItem('task-draft-fixture')) return;
            localStorage.clear(); sessionStorage.setItem('task-draft-fixture', 'true');
            for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
        }, createWebParityStorage(theme));
        await page.goto('/tasks');
        await page.getByRole('button', { name: '編集', exact: true }).nth(1).click();
        await page.getByPlaceholder('タスク名を入力...').fill('Draft conflict');
        await page.getByRole('button', { name: 'タスク「メールを返信する」を完了にする', exact: true }).click();
        await page.getByRole('button', { name: '更新', exact: true }).click();
        await expect(page.getByRole('alert').filter({ hasText: 'このタスクは変更または削除されています' })).toBeVisible();
        await expect(page.getByPlaceholder('タスク名を入力...')).toHaveValue('Draft conflict');
        await page.screenshot({ path: testInfo.outputPath(`task-draft-${theme}-conflict.png`), fullPage: true });
        await page.clock.runFor(5500);
        await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
        await page.reload();
        const records = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-tasks')!).state.tasks);
        expect(records.find((task: { name: string }) => task.name === 'メールを返信する')).toMatchObject({ completed: true });
        expect(records.some((task: { name: string }) => task.name === 'Draft conflict')).toBe(false);
        await page.getByRole('button', { name: '新しいタスクを追加', exact: true }).click();
        await expect(page.getByPlaceholder('タスク名を入力...')).toHaveValue('');
        await page.getByPlaceholder('タスク名を入力...').fill('Fresh task');
        await page.getByRole('button', { name: '追加', exact: true }).click();
        await expect(page.getByText('Fresh task', { exact: true })).toBeVisible();
    });
}
