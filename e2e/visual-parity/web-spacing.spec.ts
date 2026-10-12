import { expect, test } from '@playwright/test';
import { installWebParityState } from '../fixtures/parity-state';

test.beforeEach(async ({ page }) => { await installWebParityState(page); });

test('utility padding, margins and nav height survive the base reset', async ({ page }) => {
    await page.goto('/tasks');
    const layout = await page.locator('.app-page').evaluate((element) => {
        const style = getComputedStyle(element);
        return { left: style.paddingLeft, right: style.paddingRight, top: style.paddingTop };
    });
    expect(layout).toEqual({ left: '16px', right: '16px', top: '24px' });
    await expect(page.locator('.app-navigation-inner')).toHaveCSS('height', '64px');
    await expect(page.locator('h1')).toHaveCSS('margin-top', '0px');
    await page.getByRole('button', { name: '新しいタスクを追加' }).click();
    await expect(page.getByPlaceholder('タスク名を入力...')).toBeVisible();
});

test('detail page padding also survives and settings remains operable', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('.app-page')).toHaveCSS('padding-left', '20px');
    await expect(page.locator('.app-page')).toHaveCSS('padding-top', '24px');
    await page.getByRole('button', { name: 'ライト', exact: true }).click();
    await expect(page.getByRole('button', { name: 'ライト', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
