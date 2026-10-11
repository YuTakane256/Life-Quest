import { expect, test } from '@playwright/test';
import { installWebParityState, waitForWebParityRender } from '../fixtures/parity-state';

const screens = [
    ['tasks', '/tasks', '今週の計画を整理する'],
    ['habits', '/habits', '読書を20分続ける'],
    ['stats', '/stats', '⚡ 合計 245 XP'],
    ['character', '/character', '星見ユウ'],
    ['inventory', '/character/inventory', 'インベントリ (4/4)'],
    ['settings', '/settings', '設定'],
] as const;

for (const theme of ['light', 'dark'] as const) {
    for (const [name, route, ready] of screens) {
        test(`${theme} ${name} reference at 402x874`, async ({ page }, testInfo) => {
            await installWebParityState(page, theme);
            await page.goto(route);
            await expect(page.getByText(ready, { exact: true }).first()).toBeVisible();
            if (name === 'tasks') {
                await page.getByText('完了タスク (1)', { exact: true }).click();
                await expect(page.getByText('朝の散歩を記録する', { exact: true })).toBeVisible();
            }
            if (name === 'settings') {
                await expect(page.getByRole('button', { name: theme === 'dark' ? 'ダーク' : 'ライト', exact: true })).toHaveAttribute('aria-pressed', 'true');
            }
            await waitForWebParityRender(page);
            const path = testInfo.outputPath(`web-${theme}-${name}.png`);
            await page.screenshot({ path, animations: 'disabled', caret: 'hide', scale: 'css' });
            await testInfo.attach(`web-${theme}-${name}`, { path, contentType: 'image/png' });
        });
    }
}
