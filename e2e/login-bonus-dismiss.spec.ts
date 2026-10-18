import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: login bonus closes at the visible label, not below the card`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await page.goto('/settings');
        await expect(page.getByText('クラウド接続は未設定です。これまでどおり端末内のみで動作します。', { exact: true })).toBeVisible();
        const dialog = page.getByRole('dialog', { name: 'ログインボーナス' });
        await expect(dialog).toBeVisible();
        const close = dialog.getByRole('button', { name: 'ログインボーナスを閉じる', exact: true });
        const box = await close.boundingBox(); expect(box).not.toBeNull(); expect(box!.height).toBeGreaterThanOrEqual(44);
        // Click the text's own rectangle, not an assumed coordinate below it.
        await close.getByText('タップして閉じる', { exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible();
    });
}
