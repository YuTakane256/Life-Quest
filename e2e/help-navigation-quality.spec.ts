import { expect, test } from '@playwright/test';
import { installWebParityState } from './fixtures/parity-state';

for (const theme of ['light', 'dark'] as const) test.describe(theme, () => {
    test.beforeEach(async ({ page }, testInfo) => {
        if (testInfo.project.name === 'mobile-chromium') await page.setViewportSize({ width: 402, height: 874 });
        await installWebParityState(page, theme); await page.goto('/help');
    });
    test('search, empty recovery, heading focus and settings return', async ({ page }, testInfo) => {
        const search = page.getByRole('searchbox', { name: 'ヘルプをキーワードで検索' });
        const navigation = page.getByRole('navigation', { name: 'ヘルプセクション', exact: true });
        await expect(page.getByRole('status', { name: 'ヘルプの検索結果' })).toHaveText('8件のヘルプセクション');
        await page.screenshot({ path: testInfo.outputPath(`help-${theme}-overview.png`) });
        await page.evaluate(() => {
            const original = Element.prototype.scrollIntoView;
            Element.prototype.scrollIntoView = function(options) {
                (window as unknown as { helpScroll: unknown }).helpScroll = options;
                original.call(this, options);
            };
        });
        await navigation.getByRole('button', { name: 'バトル・マップへ移動する' }).click();
        await expect(page.getByRole('heading', { name: 'バトル・マップ', exact: true })).toBeFocused();
        expect(await page.evaluate(() => (window as unknown as { helpScroll: { behavior: string } }).helpScroll.behavior)).toBe('instant');
        await search.fill('20:00'); await expect(page.getByRole('status', { name: 'ヘルプの検索結果' })).toHaveText('1件のヘルプセクション');
        await expect(navigation.getByRole('button')).toHaveCount(1); await expect(navigation.getByRole('button', { name: '通知へ移動する' })).toBeVisible();
        await expect(page.getByText(/設定した時刻（日本時間、初期値20:00）/)).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`help-${theme}-search.png`) });
        await page.getByRole('button', { name: '検索をクリア', exact: true }).click(); await expect(search).toBeFocused();
        await search.fill('No matching help'); await expect(page.getByText('一致する項目がありません', { exact: true })).toBeVisible(); await expect(navigation.getByRole('button')).toHaveCount(0);
        await page.getByRole('button', { name: 'すべての使い方を表示' }).click(); await expect(search).toHaveValue(''); await expect(search).toBeFocused();
        await expect(navigation.getByRole('button')).toHaveCount(8);
        await page.getByRole('button', { name: '戻る', exact: true }).click(); await expect(page).toHaveURL(/\/tasks$/);
        await page.goto('/settings'); await page.getByRole('button', { name: /使い方.*タスク、習慣/ }).click();
        await expect(page).toHaveURL(/\/help$/); await page.getByRole('button', { name: '戻る', exact: true }).click(); await expect(page).toHaveURL(/\/settings$/);
    });
    test('320px and 200% text keep controls and content within the screen', async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 320, height: 568 });
        await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
        const search = page.getByRole('searchbox', { name: 'ヘルプをキーワードで検索' });
        const navigation = page.getByRole('navigation', { name: 'ヘルプセクション', exact: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        for (const button of await navigation.getByRole('button').all()) {
            const bounds = await button.boundingBox(); expect(bounds!.width).toBeLessThanOrEqual(280); expect(bounds!.height).toBeGreaterThanOrEqual(44);
        }
        await navigation.getByRole('button', { name: 'キャラクター・レベル・装備へ移動する' }).click();
        await expect(page.getByRole('heading', { name: 'キャラクター・レベル・装備', exact: true })).toBeFocused();
        await search.fill('No matching help');
        const restore = page.getByRole('button', { name: 'すべての使い方を表示' });
        await restore.evaluate((button) => button.scrollIntoView({ block: 'center', behavior: 'instant' }));
        const restoreBounds = await restore.boundingBox();
        const bottomNav = await page.getByRole('navigation', { name: 'メインナビゲーション' }).boundingBox();
        expect(restoreBounds!.y + restoreBounds!.height).toBeLessThanOrEqual(bottomNav!.y);
        await page.screenshot({ path: testInfo.outputPath(`help-${theme}-small-large-text.png`) });
        await page.getByRole('button', { name: 'すべての使い方を表示' }).click(); await expect(search).toBeFocused();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
});
