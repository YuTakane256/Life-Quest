import { expect, test } from '@playwright/test';
import { createWebParityStorage, PARITY_FIXED_NOW } from '@life-quest/core/parityFixture';

for (const theme of ['light', 'dark'] as const) test.describe(theme, () => {
    test.beforeEach(async ({ page }, testInfo) => {
        if (testInfo.project.name === 'mobile-chromium') await page.setViewportSize({ width: 402, height: 874 });
        await page.emulateMedia({ colorScheme: theme }); await page.clock.install({ time: new Date(PARITY_FIXED_NOW) });
        await page.addInitScript((storage) => {
            if (sessionStorage.getItem('task-list-fixture')) return;
            localStorage.clear(); sessionStorage.setItem('task-list-fixture', 'true');
            for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
        }, createWebParityStorage(theme));
        await page.goto('/tasks');
        // Let initial lazy loading/hydration finish before pausing the test clock.
        await page.getByPlaceholder('タスクを検索...').waitFor({ state: 'visible' });
        // Keep Undo within its existing deadline even when CI form input is slow.
        await page.clock.pauseAt(new Date(Date.parse(PARITY_FIXED_NOW) + 60_000));
    });
    test('normal completion and duplication can still be undone', async ({ page }, testInfo) => {
        const complete = page.getByRole('button', { name: 'タスク「メールを返信する」を完了にする', exact: true });
        await complete.click(); await page.getByRole('button', { name: '元に戻す', exact: true }).click();
        await expect(complete).toBeVisible();
        await complete.locator('..').getByRole('button', { name: '複製', exact: true }).click();
        await expect(complete).toHaveCount(2); await page.getByRole('button', { name: '元に戻す', exact: true }).click();
        await expect(complete).toHaveCount(1);
        await page.screenshot({ path: testInfo.outputPath(`task-list-${theme}-reset.png`) });
        await page.reload();
        const state = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-tasks')!).state);
        expect(state.tasks).toHaveLength(3); expect(state.tasks.find((item: { id: string }) => item.id === 'parity-reply-email').completed).toBe(false);
    });
    test('an edited duplicate is retained when its old Undo is pressed', async ({ page }, testInfo) => {
        const complete = page.getByRole('button', { name: 'タスク「メールを返信する」を完了にする', exact: true });
        await complete.locator('..').getByRole('button', { name: '複製', exact: true }).click();
        await complete.last().locator('..').getByRole('button', { name: '編集', exact: true }).click();
        await page.getByPlaceholder('タスク名を入力...').fill('Edited duplicate');
        await page.getByRole('button', { name: '更新', exact: true }).click();
        await page.getByRole('button', { name: '元に戻す', exact: true }).click();
        await expect(page.getByRole('alert')).toContainText('複製後に内容が変更されたため');
        await expect(page.getByText('Edited duplicate', { exact: true })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`task-list-${theme}-edited-undo.png`) });
        await page.reload();
        const state = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-tasks')!).state);
        expect(state.tasks).toHaveLength(4); expect(state.tasks.some((item: { name: string }) => item.name === 'Edited duplicate')).toBe(true);
    });
    test('CSV includes current full data even when search hides all rows', async ({ page }, testInfo) => {
        await page.getByPlaceholder('タスクを検索...').fill('No match');
        await page.screenshot({ path: testInfo.outputPath(`task-list-${theme}-filtered.png`) });
        const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'タスクをCSVで保存', exact: true }).click();
        const download = await pending; expect(download.suggestedFilename()).toBe('life-quest-tasks-2026-08-10.csv');
        const stream = await download.createReadStream(); expect(stream).toBeTruthy();
        const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
        const csv = Buffer.concat(chunks).toString('utf8');
        for (const name of ['今週の計画を整理する', 'メールを返信する', '朝の散歩を記録する']) expect(csv).toContain(name);
        await page.getByRole('button', { name: '検索をクリア', exact: true }).click();
        await expect(page.getByText('メールを返信する', { exact: true })).toBeVisible();
    });
});
