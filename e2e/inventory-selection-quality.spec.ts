import { expect, test } from '@playwright/test';
import { installWebParityState, waitForWebParityRender } from './fixtures/parity-state';

for (const theme of ['light', 'dark'] as const) test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 402, height: 874 }); await installWebParityState(page, theme); await page.goto('/character/inventory');
    });
    test('selection clears on view changes; empty filter recovery and sale cancel keep equipment', async ({ page }, testInfo) => {
        const before = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-game')!).state);
        await expect(page.getByText('インベントリ (4/4)', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'チェインメイルを装備する', exact: true })).toBeVisible();
        await waitForWebParityRender(page); await page.screenshot({ path: testInfo.outputPath(`inventory-normal-${theme}.png`) });
        await page.getByRole('button', { name: '合成', exact: true }).click();
        for (const item of ['チェインメイル', '銀の指輪', '鉄の剣']) await page.getByRole('checkbox', { name: `${item}を合成対象に選択`, exact: true }).click();
        await expect(page.getByRole('button', { name: '合成する', exact: true })).toBeVisible();
        await page.getByLabel('種類', { exact: true }).selectOption('weapon');
        await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0); await expect(page.getByRole('button', { name: '合成する', exact: true })).toHaveCount(0);
        await page.getByLabel('レア', { exact: true }).selectOption('legendary'); await expect(page.getByText('条件に合う装備がありません', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: '表示条件をリセット', exact: true }).click();
        await expect(page.getByText('インベントリ (4/4)', { exact: true })).toBeVisible();
        await page.getByRole('checkbox', { name: 'チェインメイルを合成対象に選択', exact: true }).click();
        await waitForWebParityRender(page); await page.screenshot({ path: testInfo.outputPath(`inventory-${theme}.png`) });
        await page.getByRole('button', { name: '素材の選択を解除', exact: true }).click(); await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(0);
        await page.getByRole('button', { name: '売却', exact: true }).click();
        await waitForWebParityRender(page); await page.screenshot({ path: testInfo.outputPath(`inventory-sale-${theme}.png`) });
        await page.getByRole('button', { name: 'チェインメイルを売却して+20XP獲得', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'キャンセル', exact: true }).click();
        const after = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-game')!).state);
        expect(after.equipment).toEqual(before.equipment); expect(after.character).toEqual(before.character);
    });
    test('changed selected values are pruned; explicit reselection can synthesize normally', async ({ page }) => {
        await page.getByRole('button', { name: '合成', exact: true }).click();
        for (const item of ['チェインメイル', '銀の指輪', '鉄の剣']) await page.getByRole('checkbox', { name: `${item}を合成対象に選択`, exact: true }).click();
        await page.evaluate(async () => { const path = '/src/stores/useGameStore.ts'; const { useGameStore } = await import(path); useGameStore.setState({ equipment: useGameStore.getState().equipment.map((item: { id: string }) => item.id === 'parity-chain-mail' ? { ...item, name: '同期後の防具' } : item) }); });
        await expect(page.getByRole('status').filter({ hasText: '装備が変更されたため' })).toContainText('装備が変更されたため'); await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(2);
        await page.getByRole('checkbox', { name: '同期後の防具を合成対象に選択', exact: true }).click(); await page.getByRole('button', { name: '合成する', exact: true }).click();
        await expect(page.getByText('インベントリ (2/2)', { exact: true })).toBeVisible(); await expect(page.getByText(/ランクの装備を合成しました/)).toBeVisible();
        await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-game')!).state.equipment.length)).toBe(5);
    });
    test('320px / 200% text: long item name, filters and actions fit and remain operable', async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 320, height: 568 }); const longName = 'とても長い名前の冒険者が大切に使い続けている木の剣';
        await page.evaluate(async (name) => { document.documentElement.style.fontSize = '200%'; const path = '/src/stores/useGameStore.ts'; const { useGameStore } = await import(path); useGameStore.setState({ equipment: useGameStore.getState().equipment.map((item: { id: string }) => item.id === 'parity-wooden-sword' ? { ...item, name } : item) }); }, longName);
        for (const select of await page.getByRole('combobox').all()) expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await page.getByLabel('種類', { exact: true }).selectOption('armor'); await page.getByLabel('レア', { exact: true }).selectOption('common');
        await expect(page.getByText('条件に合う装備がありません', { exact: true })).toBeVisible(); await page.getByRole('button', { name: '表示条件をリセット', exact: true }).click();
        const name = page.getByText(longName, { exact: true }); expect(await name.evaluate((node) => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight)).toBe(true);
        const equip = page.getByRole('button', { name: `${longName}を装備する`, exact: true }); await equip.click({ trial: true });
        const box = (await equip.boundingBox())!; expect(box.height).toBeGreaterThanOrEqual(44); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(320);
        await page.screenshot({ path: testInfo.outputPath(`inventory-${theme}-large.png`) }); await equip.click(); await expect(equip).toHaveCount(0);
    });
});
