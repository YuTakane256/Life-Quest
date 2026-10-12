import { expect, test } from '@playwright/test';
import { installWebParityState, waitForWebParityRender } from '../fixtures/parity-state';

const viewports = [
    ['desktop', { width: 1440, height: 900 }],
    ['phone', { width: 402, height: 874 }],
] as const;
const screens = [
    ['tasks', '/tasks', '今週の計画を整理する'],
    ['habits', '/habits', '読書を20分続ける'],
    ['stats', '/stats', '⚡ 合計 245 XP'],
] as const;

for (const theme of ['light', 'dark'] as const) {
    for (const [size, viewport] of viewports) {
        for (const [screen, route, ready] of screens) {
            test(`${theme} ${screen} ${size} at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
                await page.setViewportSize(viewport);
                await installWebParityState(page, theme);
                await page.goto(route);
                await expect(page.getByText(ready, { exact: true }).first()).toBeVisible();
                if (screen === 'tasks') {
                    await page.getByText('完了タスク (1)', { exact: true }).click();
                    await expect(page.getByText('朝の散歩を記録する', { exact: true })).toBeVisible();
                }
                await expect(page.getByRole('navigation', { name: 'メインナビゲーション' })).toBeVisible();
                await expect(page.locator('.app-navigation-inner')).toHaveCSS('flex-direction', size === 'desktop' ? 'column' : 'row');
                await waitForWebParityRender(page);
                // Keep screenshots independent of Playwright's incidental pointer position.
                await page.mouse.move(0, 0);
                const filename = `web-${theme}-${screen}-${size}.png`;
                const path = testInfo.outputPath(filename);
                await page.screenshot({ path, animations: 'disabled', caret: 'hide', scale: 'css' });
                await testInfo.attach(filename, { path, contentType: 'image/png' });
            });
        }
    }
}
