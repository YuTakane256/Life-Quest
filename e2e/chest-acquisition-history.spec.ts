import { expect, test } from '@playwright/test';
import { installWebParityState } from './fixtures/parity-state';

for (const theme of ['light', 'dark'] as const) test.describe(theme, () => {
    test('history follows the inventory, survives removal of awarded inventory and never regrants rewards', async ({ page }) => {
        await installWebParityState(page, theme, undefined, 'history'); await page.goto('/character');
        const heading = page.getByRole('heading', { name: '獲得履歴 (3)', exact: true });
        const history = heading.locator('..');
        await expect(heading).toBeVisible();
        await expect(history.getByText('キャラクター獲得', { exact: true })).toHaveCount(1);
        await expect(history.getByText('木の剣', { exact: true })).toHaveCount(1);
        await expect(history.getByText('未開封の金の宝箱', { exact: true })).toHaveCount(0);
        const labels = history.locator('img');
        expect(await labels.evaluateAll((images) => images.map((image) => image.getAttribute('alt')))).toEqual(['木の宝箱', '銀の宝箱', '青色の宝箱']);
        await expect(history.getByRole('button')).toHaveCount(0);
        const before = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-game')!).state);
        await page.goto('/character/inventory');
        await page.goBack(); await expect(heading).toBeVisible(); await page.reload(); await expect(heading).toBeVisible();
        const after = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-game')!).state);
        expect(after).toEqual(before);
        await page.evaluate(async () => { const path = '/src/stores/useGameStore.ts'; const { useGameStore } = await import(path); useGameStore.setState({ equipment: [] }); });
        await expect(history.getByText('木の剣', { exact: true })).toHaveCount(1);
        await page.evaluate(async () => { const path = '/src/stores/useGameStore.ts'; const { useGameStore } = await import(path); useGameStore.setState({ chestQueue: [] }); });
        await expect(heading).toHaveCount(0);
    });
});
