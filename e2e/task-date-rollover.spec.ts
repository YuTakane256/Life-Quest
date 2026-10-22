import { expect, test } from '@playwright/test';
import { createWebParityStorage } from '@life-quest/core/parityFixture';
import { createTask } from '@life-quest/core/tasks';
import { waitForWebParityRender } from './fixtures/parity-state';

for (const theme of ['light', 'dark'] as const) test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 402, height: 874 });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await page.clock.install({ time: new Date('2026-08-10T14:59:00Z') });
        const storage = createWebParityStorage(theme);
        const tasks = JSON.parse(storage['quest-board-tasks']);
        tasks.state.tasks = [
            createTask({ id: 'today', name: '今日の一歩', dueDate: '2026-08-10', now: '2026-08-10T00:00:00Z' }),
            createTask({ id: 'tomorrow', name: '明日の一歩', dueDate: '2026-08-11', now: '2026-08-10T00:00:00Z' }),
            createTask({ id: 'none', name: '期限なしの一歩', now: '2026-08-10T00:00:00Z' }),
        ];
        storage['quest-board-tasks'] = JSON.stringify(tasks);
        await page.addInitScript((storage) => {
            localStorage.clear(); sessionStorage.clear();
            for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
        }, storage);
        await page.goto('/tasks');
        await page.getByPlaceholder('タスクを検索...').waitFor();
        await page.clock.pauseAt(new Date('2026-08-10T14:59:59Z'));
    });
    const rowName = (name: string) => `タスク「${name}」を完了にする`;
    test('today filter updates at JST midnight without changing saved tasks or growth', async ({ page }, info) => {
        await page.getByRole('button', { name: '今日まで', exact: true }).click();
        await expect(page.getByRole('button', { name: rowName('今日の一歩'), exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: rowName('明日の一歩'), exact: true })).toHaveCount(0);
        const before = await page.evaluate(() => [localStorage.getItem('quest-board-tasks'), JSON.parse(localStorage.getItem('quest-board-game')!).state.character]);
        await waitForWebParityRender(page); await page.screenshot({ path: info.outputPath(`tasks-${theme}-before.png`) });
        await page.clock.runFor(1000);
        await expect(page.getByRole('button', { name: rowName('明日の一歩'), exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: rowName('期限なしの一歩'), exact: true })).toHaveCount(0);
        await expect(page.locator('[title="2026-08-10"]')).toContainText('昨日');
        await expect(page.locator('[title="2026-08-11"]')).toContainText('今日');
        await page.screenshot({ path: info.outputPath(`tasks-${theme}-after.png`) });
        expect(await page.evaluate(() => [localStorage.getItem('quest-board-tasks'), JSON.parse(localStorage.getItem('quest-board-game')!).state.character])).toEqual(before);
    });
    test('window focus refreshes overdue results after sleep without resetting search', async ({ page }) => {
        await page.getByPlaceholder('タスクを検索...').fill('今日の');
        await page.getByRole('button', { name: '期限切れ', exact: true }).click();
        await expect(page.getByText('該当するタスクがありません', { exact: true })).toBeVisible();
        await page.clock.setSystemTime(new Date('2026-08-12T00:00:00Z'));
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(page.getByRole('button', { name: rowName('今日の一歩'), exact: true })).toBeVisible();
        await expect(page.getByPlaceholder('タスクを検索...')).toHaveValue('今日の');
        await expect(page.locator('[title="2026-08-10"]')).toContainText('2日前');
        await expect(page.getByRole('button', { name: rowName('明日の一歩'), exact: true })).toHaveCount(0);
    });
    test('editing draft and completion Undo survive the date change', async ({ page }) => {
        const row = page.getByRole('button', { name: rowName('今日の一歩'), exact: true });
        await row.locator('..').getByRole('button', { name: '編集', exact: true }).click();
        await page.getByPlaceholder('タスク名を入力...').fill('入力中の次の一歩');
        await row.click(); await page.clock.runFor(1000);
        await expect(page.getByPlaceholder('タスク名を入力...')).toHaveValue('入力中の次の一歩');
        await page.getByRole('button', { name: '元に戻す', exact: true }).click();
        await expect(row).toBeVisible();
        const state = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-tasks')!).state);
        expect(state.tasks.find((task: { id: string }) => task.id === 'today').completed).toBe(false);
        expect(state.tasks.find((task: { id: string }) => task.id === 'today').name).toBe('今日の一歩');
    });
});
