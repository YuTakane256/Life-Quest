import { expect, test } from '@playwright/test';
import { installWebParityState } from './fixtures/parity-state';

test.beforeEach(async ({ page }) => {
    await installWebParityState(page);
});

test('navigation adapts to the viewport and preserves the same destinations', async ({ page }) => {
    await page.goto('/tasks');
    const desktop = page.viewportSize()!.width >= 768;
    const nav = page.getByRole('navigation', { name: 'メインナビゲーション' });
    await expect(page.locator('.app-navigation-inner')).toHaveCSS('flex-direction', desktop ? 'column' : 'row');
    if (desktop) {
        await expect(page.locator('.app-navigation-brand')).toBeVisible();
        const box = (await nav.boundingBox())!;
        expect(box.x).toBe(0);
        expect(box.y).toBe(0);
        expect(box.height).toBe(page.viewportSize()!.height);
        // Same menu supports keyboard navigation on PC without changing the data.
        await page.keyboard.press('Alt+3');
    } else {
        await expect(page.locator('.app-navigation-brand')).toBeHidden();
        await expect(page.locator('.app-navigation-inner')).toHaveCSS('height', '64px');
        await nav.getByRole('button', { name: '統計', exact: true }).click();
    }
    await expect(page).toHaveURL(/\/stats$/);
    await expect(nav.getByRole('button', { name: '統計', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('statistics uses wider grids on PC and stacked content on phone without page overflow', async ({ page }) => {
    await page.goto('/stats');
    await expect(page.getByText('⚡ 合計 245 XP', { exact: true })).toBeVisible();
    const desktop = page.viewportSize()!.width >= 768;
    const columns = await page.locator('.app-page').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(desktop ? 2 : 1);
    const summary = page.getByText('⚡ 合計XP', { exact: true }).locator('..').locator('..');
    const summaryColumns = await summary.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    expect(summaryColumns).toBe(desktop ? 4 : 2);
    const weekly = (await page.getByRole('heading', { name: '直近7日間のXP', exact: true }).boundingBox())!;
    const best = (await page.getByRole('heading', { name: /自己ベスト記録$/ }).boundingBox())!;
    if (desktop) {
        expect(Math.abs(weekly.y - best.y)).toBeLessThan(1);
        expect(best.x).toBeGreaterThan(weekly.x);
    } else {
        expect(best.y).toBeGreaterThan(weekly.y);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
});
