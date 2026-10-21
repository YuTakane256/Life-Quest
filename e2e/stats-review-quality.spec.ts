import { expect, test } from '@playwright/test';
import { installWebParityState } from './fixtures/parity-state';

// The app's calendar remains JST even on a device set to another time zone.
test.use({ timezoneId: 'America/Los_Angeles' });

for (const theme of ['light', 'dark'] as const) test.describe(theme, () => {
    test.beforeEach(async ({ page }, testInfo) => {
        if (testInfo.project.name === 'mobile-chromium') await page.setViewportSize({ width: 402, height: 874 });
        await installWebParityState(page, theme); await page.goto('/stats');
    });
    test('119 days, latest daily values and non-destructive selection', async ({ page }, testInfo) => {
        const details = page.getByRole('status', { name: '日別統計', exact: true });
        const date = page.getByRole('combobox', { name: '統計の日付', exact: true });
        await expect(page.getByText('過去119日', { exact: true })).toBeVisible();
        await expect(details).toHaveText('2026-08-10: 45 XP');
        await expect(date.locator('option')).toHaveCount(119);
        const storage = await page.evaluate(() => localStorage.getItem('quest-board-stats'));
        await page.screenshot({ path: testInfo.outputPath(`stats-${theme}-overview.png`) });
        await page.getByRole('button', { name: '前の日', exact: true }).click(); await expect(details).toHaveText('2026-08-09: 35 XP');
        await page.screenshot({ path: testInfo.outputPath(`stats-${theme}-daily.png`) });
        await page.getByRole('main').getByRole('button', { name: '習慣', exact: true }).click(); await expect(details).toHaveText('2026-08-09: 2個達成 (全達成!)');
        await page.screenshot({ path: testInfo.outputPath(`stats-${theme}-habit-detail.png`) });
        await date.selectOption('2026-04-14'); await expect(details).toHaveText('2026-04-14: 0個達成'); await expect(page.getByRole('button', { name: '前の日', exact: true })).toBeDisabled();
        await page.getByRole('button', { name: '今日', exact: true }).click(); await expect(details).toHaveText('2026-08-10: 1個達成');
        await expect(page.getByRole('button', { name: '次の日', exact: true })).toBeDisabled();
        expect(await page.evaluate(() => localStorage.getItem('quest-board-stats'))).toBe(storage);
        await page.reload(); await expect(details).toHaveText('2026-08-10: 45 XP');
    });
    test('JST rollover without log updates refreshes the window and weekday labels', async ({ page }) => {
        await expect(page.getByRole('combobox', { name: '統計の日付', exact: true })).toHaveValue('2026-08-10');
        await page.clock.pauseAt(new Date('2026-08-10T14:59:59.000Z'));
        await expect(page.getByRole('combobox', { name: '統計の日付', exact: true })).toHaveValue('2026-08-10');
        await page.clock.runFor(1000);
        await expect(page.getByRole('status', { name: '日別統計', exact: true })).toHaveText('2026-08-11: 0 XP');
        const date = page.getByRole('combobox', { name: '統計の日付', exact: true });
        await expect(date.locator('option').first()).toHaveText('2026-08-11');
        await expect(date.locator('option').last()).toHaveText('2026-04-15');
        // Browser default may be UTC or America/Los_Angeles: labels are calendar-day based.
        const weekly = page.getByRole('heading', { name: '今週のXP', exact: true }).locator('..').locator('..');
        const lastBar = weekly.locator('[title]').last();
        await expect(lastBar).toHaveAttribute('title', '2026-08-11: 0 XP');
        await expect(lastBar.locator('..').locator('..').getByText('火', { exact: true })).toBeVisible();
    });
    test('320px / 200% text keeps date controls usable without page overflow', async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 320, height: 568 }); await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
        const date = page.getByRole('combobox', { name: '統計の日付', exact: true });
        await date.selectOption('2026-08-09');
        await expect(page.getByRole('status', { name: '日別統計', exact: true })).toHaveText('2026-08-09: 35 XP');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        for (const name of ['前の日', '次の日', '今日']) {
            const control = page.getByRole('button', { name, exact: true }); const box = await control.boundingBox();
            expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.width).toBeLessThanOrEqual(288);
        }
        await date.scrollIntoViewIfNeeded(); await page.screenshot({ path: testInfo.outputPath(`stats-${theme}-small-large-text.png`) });
        await page.getByRole('button', { name: '今日', exact: true }).click(); await expect(date).toHaveValue('2026-08-10');
    });
});
