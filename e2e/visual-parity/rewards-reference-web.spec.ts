import { expect, test } from '@playwright/test';
import { installWebParityState, waitForWebParityRender } from '../fixtures/parity-state';

for (const theme of ['light', 'dark'] as const) {
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
        await capture('chest');
        await page.getByText('タップして開ける', { exact: true }).click();
        await expect(page.getByText('キャラクター解放！', { exact: true })).toBeVisible();
        await capture('starter');
    });
}
