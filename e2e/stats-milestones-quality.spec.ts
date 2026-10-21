import { expect, test } from '@playwright/test';
import { installWebParityState } from './fixtures/parity-state';

test.use({ timezoneId: 'America/Los_Angeles' });
for (const theme of ['light', 'dark'] as const) test.describe(theme, () => {
    test.beforeEach(async ({ page }, testInfo) => {
        if (testInfo.project.name === 'mobile-chromium') await page.setViewportSize({ width: 402, height: 874 });
        await installWebParityState(page, theme); await page.goto('/stats');
    });
    test('same weekly total, daily breakdown and saved all-time records', async ({ page }, testInfo) => {
        const weekly = page.getByRole('region', { name: '直近7日間のXP', exact: true });
        const best = page.getByRole('region', { name: '自己ベスト記録', exact: true });
        await expect(weekly.getByText('⚡ 合計 245 XP', { exact: true })).toBeVisible();
        await expect(weekly.getByRole('img')).toHaveCount(7);
        await expect(weekly.getByRole('img', { name: '2026-08-10（月）: 45 XP', exact: true })).toBeVisible();
        const original = await page.evaluate(() => localStorage.getItem('quest-board-stats'));
        await weekly.evaluate((node) => node.scrollIntoView({ block: 'start', behavior: 'instant' })); await page.screenshot({ path: testInfo.outputPath(`milestones-${theme}-weekly.png`) });
        await best.evaluate((node) => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
        await expect(best.getByText('50 XP', { exact: true })).toBeVisible(); await expect(best.getByText('2026-08-08', { exact: true })).toBeVisible();
        await expect(best.getByText('2026-08-04 〜 2026-08-10', { exact: true })).toBeVisible();
        await expect(best.getByText('2026-08-08 〜 2026-08-09', { exact: true })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`milestones-${theme}-best.png`) });
        const toggle = weekly.getByRole('button', { name: '7日間の内訳', exact: true });
        await toggle.click(); await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(weekly.getByRole('listitem')).toHaveCount(7);
        await expect(weekly.getByRole('listitem').last()).toHaveText('2026-08-10（月）45 XP');
        await page.getByRole('main').getByRole('button', { name: '習慣', exact: true }).click();
        await expect(weekly.getByText('⚡ 合計 245 XP', { exact: true })).toBeVisible(); await expect(weekly.getByText('タスクXPのみ。今日を含む7日間（日本時間）。', { exact: true })).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem('quest-board-stats'))).toBe(original);
        await toggle.click(); await expect(weekly.getByRole('listitem')).toHaveCount(0);
    });
    test('320px / 200% text and long numbers remain readable in the breakdown and records', async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 320, height: 568 }); await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
        const weekly = page.getByRole('region', { name: '直近7日間のXP', exact: true });
        const best = page.getByRole('region', { name: '自己ベスト記録', exact: true });
        await weekly.getByRole('button', { name: '7日間の内訳', exact: true }).click();
        await expect(weekly.getByRole('listitem')).toHaveCount(7);
        await page.evaluate(async () => {
            const path = '/src/stores/useStatsStore.ts'; const { useStatsStore } = await import(path);
            // Only this isolated browser fixture, never a normal signed-in client.
            useStatsStore.setState({ taskXpLog: { '2026-08-10': 1_000_000_000_000 }, habitLog: {} });
        });
        await expect(weekly.getByRole('listitem').last()).toHaveText('2026-08-10（月）1,000,000,000,000 XP');
        await expect(best.getByText('1,000,000,000,000 XP', { exact: true })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const toggle = await weekly.getByRole('button', { name: '7日間の内訳', exact: true }).boundingBox(); expect(toggle!.height).toBeGreaterThanOrEqual(44);
        await best.evaluate((node) => node.scrollIntoView({ block: 'start', behavior: 'instant' })); await page.screenshot({ path: testInfo.outputPath(`milestones-${theme}-large-text.png`) });
        await page.evaluate(async () => { const path = '/src/stores/useStatsStore.ts'; const { useStatsStore } = await import(path); useStatsStore.setState({ taskXpLog: {}, habitLog: {} }); });
        await expect(weekly.getByText('⚡ 合計 0 XP', { exact: true })).toBeVisible(); await expect(best.getByText('—', { exact: true })).toHaveCount(3);
        await expect(best.getByText('1,000,000,000,000 XP', { exact: true })).toHaveCount(0);
    });
});
