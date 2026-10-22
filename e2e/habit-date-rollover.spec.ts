import { expect, test } from '@playwright/test';
import { createWebParityStorage } from '@life-quest/core/parityFixture';
import { waitForWebParityRender } from './fixtures/parity-state';

// The product's date is JST even when the browser itself is not in Japan.
test.use({ timezoneId: 'UTC' });
for (const theme of ['light', 'dark'] as const) test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 402, height: 874 });
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await page.clock.install({ time: new Date('2026-08-10T14:59:00Z') });
        const storage = createWebParityStorage(theme);
        const data = JSON.parse(storage['quest-board-habits']);
        Object.assign(data.state, {
            habits: [{ id: 'read', name: '読書の一歩', categoryId: 'study', createdAt: '2026-08-09T00:00:00Z' }],
            dailyRecords: [
                { habitId: 'read', date: '2026-08-09', completed: true, memo: '' },
                { habitId: 'read', date: '2026-08-10', completed: true, memo: '昨日までの積み重ね' },
            ],
            restDays: [{ date: '2026-08-10', isRest: true }], allCompleteRewardDates: [],
        });
        storage['quest-board-habits'] = JSON.stringify(data);
        await page.addInitScript((storage) => {
            localStorage.clear(); sessionStorage.clear();
            for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
        }, storage);
        await page.goto('/habits');
        await page.getByRole('button', { name: '「読書の一歩」の達成履歴を表示', exact: true }).waitFor();
        await page.clock.pauseAt(new Date('2026-08-10T14:59:59Z'));
    });
    const records = (page: import('@playwright/test').Page) => page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-habits')!).state);
    const clearToday = async (page: import('@playwright/test').Page) => page.evaluate(async () => {
        const path = '/src/stores/useHabitStore.ts'; const { useHabitStore } = await import(path);
        useHabitStore.setState({ dailyRecords: [], restDays: [] });
    });
    test('midnight refreshes completion / rest / progress without modifying records or growth', async ({ page }, info) => {
        await expect(page.getByRole('button', { name: '習慣「読書の一歩」を未達成にする', exact: true })).toBeVisible();
        await expect(page.getByText(/全習慣達成！/)).toBeVisible(); await expect(page.getByText(/お休み中/)).toBeVisible();
        const before = await records(page); const growth = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-game')!).state.character);
        await waitForWebParityRender(page); await page.screenshot({ path: info.outputPath(`habits-${theme}-before.png`) });
        await page.clock.runFor(1000);
        await expect(page.getByRole('button', { name: '習慣「読書の一歩」を達成にする', exact: true })).toBeVisible();
        await expect(page.getByText(/全習慣達成！/)).toHaveCount(0); await expect(page.getByText(/お休み中/)).toHaveCount(0);
        await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
        await page.screenshot({ path: info.outputPath(`habits-${theme}-after.png`) });
        expect(await records(page)).toEqual(before); expect(await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-game')!).state.character)).toEqual(growth);
    });
    test('open history updates the selected day and uses calendar weekdays in a UTC browser', async ({ page }, info) => {
        await clearToday(page); await page.getByRole('button', { name: '「読書の一歩」の達成履歴を表示', exact: true }).click();
        const dialog = page.getByRole('dialog');
        const first = dialog.locator('button[title]').first(); const firstDate = (await first.getAttribute('title'))!.split(' ')[0];
        expect(await first.evaluate((node) => [...node.parentElement!.children].indexOf(node))).toBe(new Date(`${firstDate}T00:00:00Z`).getUTCDay());
        await dialog.locator('[title="2026-08-10 未記録"]').click(); await expect(dialog.locator('strong').locator('..')).toContainText('未記録');
        await page.screenshot({ path: info.outputPath(`history-${theme}-before.png`) });
        await page.clock.runFor(1000);
        await expect(dialog.locator('[title="2026-08-11 未記録"]')).toBeVisible();
        await expect(dialog.locator('strong').locator('..')).toContainText('未達成'); await expect(dialog.locator('strong').locator('..')).not.toContainText('未記録');
        await page.screenshot({ path: info.outputPath(`history-${theme}-after.png`) });
    });
    test('old-day memo draft is retained but cannot be saved to either day', async ({ page }) => {
        await clearToday(page); await page.getByRole('button', { name: '習慣「読書の一歩」を達成にする', exact: true }).click();
        await page.getByPlaceholder('今日の一言...').fill('日付変更前の下書き');
        // Settle the legitimate pre-midnight completion bonus before freezing the comparison.
        await page.clock.runFor(1);
        await expect.poll(async () => (await records(page)).allCompleteRewardDates).toContain('2026-08-10');
        const before = await records(page);
        await page.clock.runFor(1000); await page.getByRole('button', { name: '保存', exact: true }).click();
        await expect(page.getByPlaceholder('今日の一言...')).toHaveValue('日付変更前の下書き');
        await expect(page.getByRole('alert').filter({ hasText: '日付が変わりました' })).toBeVisible();
        expect(await records(page)).toEqual(before);
    });
    test('rest confirmation from before sleep does not mark the resumed day as rest', async ({ page }) => {
        await clearToday(page); const before = await records(page);
        await page.getByRole('button', { name: '今日をお休みにする', exact: true }).click();
        await page.clock.setSystemTime(new Date('2026-08-12T00:00:00Z')); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await page.getByRole('button', { name: 'お休みにする', exact: true }).click();
        await expect(page.getByRole('button', { name: '今日をお休みにする', exact: true })).toBeVisible(); expect(await records(page)).toEqual(before);
    });
});
