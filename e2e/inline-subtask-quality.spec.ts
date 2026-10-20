import { expect, test } from '@playwright/test';
import { createWebParityStorage, PARITY_FIXED_NOW } from '@life-quest/core/parityFixture';

for (const theme of ['light', 'dark'] as const) test.describe(theme, () => {
    test.beforeEach(async ({ page }, testInfo) => {
        if (testInfo.project.name === 'mobile-chromium') await page.setViewportSize({ width: 402, height: 874 });
        await page.emulateMedia({ colorScheme: theme }); await page.clock.install({ time: new Date(PARITY_FIXED_NOW) });
        await page.addInitScript((storage) => {
            if (sessionStorage.getItem('inline-subtask-fixture')) return;
            localStorage.clear(); sessionStorage.setItem('inline-subtask-fixture', 'true');
            for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
        }, createWebParityStorage(theme));
        await page.goto('/tasks');
    });
    test('add, complete, uncomplete and delete a child without changing sibling tasks', async ({ page }, testInfo) => {
        const field = page.getByRole('textbox', { name: 'タスク「今週の計画を整理する」のサブタスク名' });
        await field.fill('Inline step'); await field.press('Enter');
        await expect(field).toHaveValue('');
        const complete = page.getByRole('button', { name: 'サブタスク「Inline step」を完了にする', exact: true });
        await expect(complete).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`inline-${theme}-added.png`) });
        await complete.click();
        await page.getByRole('button', { name: 'サブタスク「Inline step」を未完了にする', exact: true }).click();
        await page.getByRole('button', { name: 'サブタスク「Inline step」を削除', exact: true }).click();
        await expect(complete).toHaveCount(0); await page.reload();
        const state = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-tasks')!).state);
        expect(state.tasks).toHaveLength(3);
        const parent = state.tasks.find((item: { id: string }) => item.id === 'parity-plan-week');
        expect(parent.completed).toBe(false); expect(parent.subtasks.map((item: { id: string }) => item.id)).toEqual(['parity-plan-week-draft', 'parity-plan-week-review']);
    });
    test('changed parent preserves the draft and requires explicit reset', async ({ page }, testInfo) => {
        const field = page.getByRole('textbox', { name: 'タスク「今週の計画を整理する」のサブタスク名' });
        await field.fill('Kept draft');
        await page.getByRole('button', { name: 'サブタスク「優先順位を書き出す」を未完了にする', exact: true }).click();
        await field.press('Enter');
        await expect(page.getByRole('alert')).toContainText('このタスクは変更されています'); await expect(field).toHaveValue('Kept draft');
        await page.screenshot({ path: testInfo.outputPath(`inline-${theme}-conflict.png`) });
        await page.getByRole('button', { name: '入力をやり直す', exact: true }).click(); await expect(field).toHaveValue('');
        await field.fill('Retry step'); await field.press('Enter');
        await expect(page.getByRole('button', { name: 'サブタスク「Retry step」を完了にする', exact: true })).toBeVisible();
        await page.reload();
        const state = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-tasks')!).state);
        const parent = state.tasks.find((item: { id: string }) => item.id === 'parity-plan-week');
        expect(parent.subtasks.some((item: { name: string }) => item.name === 'Kept draft')).toBe(false);
        expect(parent.subtasks.at(-1).name).toBe('Retry step');
    });
});
