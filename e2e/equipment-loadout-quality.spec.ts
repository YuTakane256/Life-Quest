import { expect, test } from '@playwright/test';
import { installWebParityState, waitForWebParityRender } from './fixtures/parity-state';

for (const theme of ['light', 'dark'] as const) test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 402, height: 874 });
        await installWebParityState(page, theme); await page.goto('/character');
    });
    test('unequip, inventory equip and best loadout preserve progression and persist selection', async ({ page }, testInfo) => {
        const equipment = page.locator('[aria-label="装備中の一覧"]');
        const before = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-game')!).state);
        await page.getByRole('button', { name: '武器の鋼の刃を外す', exact: true }).click();
        await expect(equipment.getByText('なし', { exact: true })).toHaveCount(1);
        await page.getByRole('button', { name: '鉄の剣を装備する', exact: true }).click();
        await expect(equipment.getByText('鉄の剣', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: '最強装備を自動装着', exact: true }).click();
        await expect(equipment.getByText('鋼の刃', { exact: true })).toBeVisible();
        await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-game')!).state.equipment.filter((item: { equipped: boolean }) => item.equipped).map((item: { id: string }) => item.id))).toEqual(['parity-steel-blade', 'parity-plate-armor', 'parity-gold-amulet']);
        const after = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-game')!).state);
        expect(after.character).toEqual(before.character); expect(after.gachaCount).toBe(before.gachaCount); expect(after.chestQueue).toEqual(before.chestQueue);
        for (const button of await equipment.getByRole('button').all()) {
            const box = (await button.boundingBox())!; expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
        }
        await equipment.scrollIntoViewIfNeeded(); await waitForWebParityRender(page); await equipment.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`loadout-${theme}.png`) });
    });
    test('320px / 200% text: full equipment names, wrapping and usable buttons', async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 320, height: 568 });
        const longName = 'とても長い名前の伝説を受け継いだ冒険者の鋼の刃';
        await page.evaluate(async (name) => {
            document.documentElement.style.fontSize = '200%';
            const path = '/src/stores/useGameStore.ts'; const { useGameStore } = await import(path);
            useGameStore.setState({ equipment: useGameStore.getState().equipment.map((item: { id: string }) => item.id === 'parity-steel-blade' ? { ...item, name } : item) });
        }, longName);
        const equipment = page.locator('[aria-label="装備中の一覧"]');
        const name = equipment.getByText(longName, { exact: true }); await name.scrollIntoViewIfNeeded();
        expect(await name.evaluate((node) => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight)).toBe(true);
        expect(await equipment.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        const remove = equipment.getByRole('button', { name: `武器の${longName}を外す`, exact: true });
        await remove.scrollIntoViewIfNeeded(); expect((await remove.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await remove.click({ trial: true });
        await page.screenshot({ path: testInfo.outputPath(`loadout-${theme}-large-text.png`) });
        await remove.click(); await expect(equipment.getByText(longName, { exact: true })).toHaveCount(0);
        await page.getByRole('button', { name: '最強装備を自動装着', exact: true }).click();
        await expect(name).toHaveCount(1);
    });
});
