import { expect, test } from '@playwright/test';
import { installWebParityState, waitForWebParityRender } from '../fixtures/parity-state';

for (const theme of ['light', 'dark'] as const) {
    test(`${theme} static acquisition history reference at 402x874`, async ({ page }, testInfo) => {
        await installWebParityState(page, theme, undefined, 'history'); await page.goto('/character');
        await waitForWebParityRender(page);
        await page.getByRole('heading', { name: '獲得履歴 (3)', exact: true }).scrollIntoViewIfNeeded();
        const path = testInfo.outputPath(`web-${theme}-history-fixed.png`);
        await page.screenshot({ path, animations: 'disabled', scale: 'css' });
        await testInfo.attach('fixed-history', { path, contentType: 'image/png' });
    });
    test(`${theme} reward reference at 402x874`, async ({ page }, testInfo) => {
        await installWebParityState(page, theme, undefined, 'rewards');
        await page.goto('/character');
        const capture = async (name: string) => {
            await waitForWebParityRender(page);
            const path = testInfo.outputPath(`web-${theme}-${name}.png`);
            await page.screenshot({ path, animations: 'disabled', scale: 'css' });
            await testInfo.attach(name, { path, contentType: 'image/png' });
        };
        const login = page.getByRole('dialog', { name: 'ログインボーナス' });
        await expect(login).toBeVisible();
        await capture('login');
        await login.getByRole('button', { name: 'ログインボーナスを閉じる', exact: true }).click();
        await expect(login).toHaveCount(0);
        await page.getByRole('button', { name: /青色の宝箱/ }).click();
        await expect(page.getByText('タップして開ける', { exact: true })).toBeVisible();
        // Fixed dark scrim needs bright foreground even in light theme.
        await expect(page.locator('p').filter({ hasText: /^青色の宝箱$/ })).toHaveCSS('color', 'rgb(241, 245, 249)');
        await expect(page.getByText('タップして開ける', { exact: true })).toHaveCSS('color', 'rgb(203, 213, 225)');
        await capture('chest');
        await page.getByText('タップして開ける', { exact: true }).click();
        await expect(page.getByText('キャラクター解放！', { exact: true })).toBeVisible();
        await capture('starter');
        await page.getByRole('button', { name: '閉じる', exact: true }).click();
        await page.getByRole('button', { name: /木の宝箱/ }).click();
        await page.getByText('タップして開ける', { exact: true }).click();
        await page.getByRole('button', { name: 'インベントリに追加', exact: true }).click();
        const history = page.getByRole('heading', { name: '獲得履歴 (2)', exact: true });
        await history.scrollIntoViewIfNeeded();
        await expect(history).toBeVisible();
        await expect(history.locator('..').getByText('キャラクター獲得', { exact: true })).toBeVisible();
        const path = testInfo.outputPath(`web-${theme}-history.png`);
        await page.screenshot({ path, animations: 'disabled', scale: 'css' });
        await testInfo.attach('history', { path, contentType: 'image/png' });
    });
}
