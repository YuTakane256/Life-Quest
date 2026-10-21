import { expect, test } from '@playwright/test';
import { installWebParityState } from './fixtures/parity-state';

for (const theme of ['light', 'dark'] as const) test.describe(theme, () => {
    test.beforeEach(async ({ page }, testInfo) => {
        if (testInfo.project.name === 'mobile-chromium') await page.setViewportSize({ width: 402, height: 874 });
        await installWebParityState(page, theme); await page.goto('/character');
    });
    test('save / cancel / reopen, avatar state, keyboard focus and blank name fallback', async ({ page }, testInfo) => {
        const open = page.getByRole('button', { name: 'プロフィールを編集', exact: true });
        const dialog = page.getByRole('dialog', { name: 'プロフィール編集', exact: true });
        const name = dialog.getByRole('textbox', { name: 'キャラクター名', exact: true });
        const before = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-game')!).state);
        await open.click(); await expect(name).toBeFocused(); await name.fill('Cancelled draft');
        await dialog.getByRole('button', { name: 'キャンセル', exact: true }).focus(); await page.keyboard.press('Tab');
        await expect(dialog.getByRole('button', { name: 'プロフィール編集を閉じる', exact: true })).toBeFocused();
        await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: 'キャンセル', exact: true })).toBeFocused();
        await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(open).toBeFocused();
        await open.click(); await expect(name).toHaveValue('星見ユウ'); await name.fill('Portfolio hero');
        await dialog.getByRole('button', { name: 'アバターを男性にする', exact: true }).click();
        await expect(dialog.getByRole('button', { name: 'アバターを男性にする', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await page.screenshot({ path: testInfo.outputPath(`profile-${theme}-editor.png`) });
        await dialog.getByRole('button', { name: '保存する', exact: true }).click(); await expect(dialog).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-game')!).state.character.name)).toBe('Portfolio hero');
        const after = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-game')!).state);
        expect(after.character).toEqual({ ...before.character, name: 'Portfolio hero', avatar: 'male' });
        expect(after.equipment).toEqual(before.equipment); expect(after.gachaCount).toBe(before.gachaCount);
        await open.click(); await expect(name).toHaveValue('Portfolio hero'); await name.fill('  ');
        await dialog.getByRole('button', { name: '保存する', exact: true }).click();
        await open.click(); await expect(name).toHaveValue('名無し'); await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click();
    });
    test('concurrent profile change preserves draft; progression-only changes do not block save', async ({ page }, testInfo) => {
        const open = page.getByRole('button', { name: 'プロフィールを編集', exact: true });
        const dialog = page.getByRole('dialog', { name: 'プロフィール編集', exact: true });
        const name = dialog.getByRole('textbox', { name: 'キャラクター名', exact: true });
        await open.click(); await name.fill('Kept draft');
        await page.evaluate(async () => { const path = '/src/stores/useGameStore.ts'; const { useGameStore } = await import(path); const state = useGameStore.getState(); useGameStore.setState({ character: { ...state.character, name: 'Remote profile' } }); });
        await dialog.getByRole('button', { name: '保存する', exact: true }).click();
        await expect(dialog.getByRole('alert')).toContainText('プロフィールが変更されています'); await expect(name).toHaveValue('Kept draft');
        await page.screenshot({ path: testInfo.outputPath(`profile-${theme}-conflict.png`) });
        await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click(); await open.click(); await expect(name).toHaveValue('Remote profile');
        await name.fill('Current draft');
        await page.evaluate(async () => { const path = '/src/stores/useGameStore.ts'; const { useGameStore } = await import(path); const state = useGameStore.getState(); useGameStore.setState({ character: { ...state.character, totalXp: 500 } }); });
        await dialog.getByRole('button', { name: '保存する', exact: true }).click(); await expect(dialog).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-game')!).state.character)).toMatchObject({ name: 'Current draft', totalXp: 500 });
    });
    test('320px / 200% text: dialog scrolls and all actions remain available', async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 320, height: 568 }); await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
        await page.getByRole('button', { name: 'プロフィールを編集', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'プロフィール編集', exact: true });
        await dialog.getByRole('textbox', { name: 'キャラクター名', exact: true }).fill('abcdefghijklmnopqrstuvwxyz1234');
        await expect(dialog.getByRole('textbox')).toHaveAttribute('maxlength', '30');
        expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
        expect((await dialog.boundingBox())!.height).toBeLessThanOrEqual(536);
        for (const button of await dialog.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        await dialog.getByRole('button', { name: 'アバターを男性にする', exact: true }).click();
        await dialog.getByRole('button', { name: '保存する', exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`profile-${theme}-large-text.png`) });
        await dialog.getByRole('button', { name: '保存する', exact: true }).click(); await expect(dialog).toHaveCount(0);
        await page.getByRole('button', { name: 'プロフィールを編集', exact: true }).click(); await expect(dialog.getByRole('textbox')).toHaveValue('abcdefghijklmnopqrstuvwxyz1234');
    });
});
