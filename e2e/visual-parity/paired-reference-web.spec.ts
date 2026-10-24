import { expect, test } from '@playwright/test';
import { installWebParityState, waitForWebParityRender } from '../fixtures/parity-state';

const screens = [
    ['tasks', '/tasks', '今週の計画を整理する'],
    ['habits', '/habits', '読書を20分続ける'],
    ['stats', '/stats', '⚡ 合計 245 XP'],
    ['character', '/character', '星見ユウ'],
    ['inventory', '/character/inventory', 'インベントリ (4/4)'],
    ['map', '/map', '最高到達: ステージ 2'],
    ['settings', '/settings', '設定'],
] as const;

for (const theme of ['light', 'dark'] as const) {
    test(`${theme} title selection reference at 402x874`, async ({ page }, testInfo) => {
        await installWebParityState(page, theme); await page.goto('/stats'); await waitForWebParityRender(page);
        const card = page.getByRole('region', { name: '実績と称号', exact: true });
        await card.getByRole('button', { name: '「習慣の芽」を選択する', exact: true }).click();
        await expect(card.getByRole('status')).toHaveText('表示中: 習慣の芽');
        await card.getByRole('group', { name: '表示する称号', exact: true }).evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.screenshot({ path: testInfo.outputPath(`web-${theme}-title-selected.png`), animations: 'disabled', scale: 'css' });
    });
    test(`${theme} character inventory preview at 402x874`, async ({ page }, testInfo) => {
        await installWebParityState(page, theme); await page.goto('/character'); await waitForWebParityRender(page);
        await page.getByRole('button', { name: '木の剣を装備する', exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`web-${theme}-preview-normal.png`), animations: 'disabled', scale: 'css' });
        for (const name of ['武器の鋼の刃を外す', '防具のプレートアーマーを外す', 'アクセサリーの金のアミュレットを外す']) await page.getByRole('button', { name, exact: true }).click();
        await page.getByRole('link', { name: /もっと見る/ }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`web-${theme}-preview-overflow.png`), animations: 'disabled', scale: 'css' });
    });
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
