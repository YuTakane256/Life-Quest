import { expect, test } from '@playwright/test';
import { LAYOUT_TOKENS } from '@life-quest/core/designTokens';
import { installWebParityState } from './fixtures/parity-state';

test('responsive page spacing and add form survive the CSS reset', async ({ page }) => {
    await installWebParityState(page);
    await page.goto('/tasks');
    const width = page.viewportSize()?.width ?? 0;
    const desktop = width >= 768;
    const spacing = await page.locator('.app-page').evaluate((element) => {
        const style = getComputedStyle(element);
        return { left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight), top: parseFloat(style.paddingTop) };
    });
    expect(spacing.top).toBe(LAYOUT_TOKENS.page.top);
    expect(spacing.right).toBe(spacing.left);
    if (desktop) {
        expect(spacing.left).toBeGreaterThanOrEqual(24);
        await expect(page.locator('.app-navigation')).toHaveCSS('width', width >= 1280 ? '232px' : '216px');
    } else {
        expect(spacing.left).toBe(LAYOUT_TOKENS.page.horizontal);
        await expect(page.locator('.app-navigation-inner')).toHaveCSS('height', `${LAYOUT_TOKENS.navigation.height}px`);
        await expect(page.locator('h1')).toHaveCSS('font-size', `${LAYOUT_TOKENS.heading.size}px`);
        await expect(page.locator('.app-navigation-label').first()).toHaveCSS('font-size', `${LAYOUT_TOKENS.navigation.labelSize}px`);
        await expect(page.locator('.app-navigation-icon svg').first()).toHaveAttribute('width', String(LAYOUT_TOKENS.navigation.iconSize));
    }
    await page.getByRole('button', { name: '新しいタスクを追加' }).click();
    const input = page.getByPlaceholder('タスク名を入力...');
    await expect(input).toBeVisible();
    await expect(input).toHaveCSS('padding-left', '12px');
    await expect(input).toHaveCSS('padding-top', '10px');
});
