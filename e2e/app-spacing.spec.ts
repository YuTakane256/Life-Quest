import { expect, test } from '@playwright/test';
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
    expect(spacing.top).toBe(24);
    expect(spacing.right).toBe(spacing.left);
    if (desktop) {
        expect(spacing.left).toBeGreaterThanOrEqual(24);
        await expect(page.locator('.app-navigation')).toHaveCSS('width', width >= 1280 ? '232px' : '216px');
    } else {
        expect(spacing.left).toBe(16);
        await expect(page.locator('.app-navigation-inner')).toHaveCSS('height', '64px');
    }
    await page.getByRole('button', { name: '新しいタスクを追加' }).click();
    const input = page.getByPlaceholder('タスク名を入力...');
    await expect(input).toBeVisible();
    await expect(input).toHaveCSS('padding-left', '12px');
    await expect(input).toHaveCSS('padding-top', '10px');
});
