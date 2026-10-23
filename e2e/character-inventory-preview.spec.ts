import { expect, test } from '@playwright/test';
import { installWebParityState } from './fixtures/parity-state';

for (const theme of ['light', 'dark'] as const) test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 402, height: 874 }); await installWebParityState(page, theme); await page.goto('/character');
    });
    test('five-row limit, filtering before slicing and equipment updates preserve progression', async ({ page }) => {
        const before = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-game')!).state);
        for (const name of ['武器の鋼の刃を外す', '防具のプレートアーマーを外す', 'アクセサリーの金のアミュレットを外す']) await page.getByRole('button', { name, exact: true }).click();
        await expect(page.getByText('インベントリ (7/7)', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: /を装備する$/ })).toHaveCount(5);
        await expect(page.getByRole('link', { name: /もっと見る/ })).toContainText('残り2件');
        await expect(page.getByRole('button', { name: '木の剣を装備する', exact: true })).toHaveCount(0);
        await page.getByLabel('種類', { exact: true }).selectOption('weapon');
        await expect(page.getByText('インベントリ (3/7)', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '木の剣を装備する', exact: true })).toBeVisible();
        await page.getByRole('button', { name: '鉄の剣を装備する', exact: true }).click();
        await expect(page.getByRole('button', { name: '武器の鉄の剣を外す', exact: true })).toBeVisible();
        await page.getByRole('button', { name: '最強装備を自動装着', exact: true }).click();
        await page.getByRole('button', { name: '表示条件をリセット', exact: true }).click();
        await expect(page.getByText('インベントリ (4/4)', { exact: true })).toBeVisible();
        const after = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-game')!).state);
        expect(after.equipment).toEqual(before.equipment); expect(after.character).toEqual(before.character);
        expect(after.gachaCount).toBe(before.gachaCount); expect(after.chestQueue).toEqual(before.chestQueue);
    });
    test('preview selections do not carry into the full inventory or back to the character', async ({ page }) => {
        for (const name of ['武器の鋼の刃を外す', '防具のプレートアーマーを外す', 'アクセサリーの金のアミュレットを外す']) await page.getByRole('button', { name, exact: true }).click();
        await page.getByRole('button', { name: '合成', exact: true }).click();
        for (const item of ['鋼の刃', 'プレートアーマー', '金のアミュレット']) await page.getByRole('checkbox', { name: `${item}を合成対象に選択`, exact: true }).click();
        await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(3);
        await page.getByRole('link', { name: /もっと見る/ }).click();
        await expect(page.getByRole('heading', { name: 'インベントリ', exact: true })).toBeVisible();
        await expect(page.getByRole('checkbox')).toHaveCount(0);
        await expect(page.getByRole('button', { name: /を装備する$/ })).toHaveCount(7);
        await page.getByRole('button', { name: 'キャラクター画面に戻る', exact: true }).click();
        await expect(page.getByRole('checkbox')).toHaveCount(0);
        await expect(page.getByRole('button', { name: /を装備する$/ })).toHaveCount(5);
    });
});
