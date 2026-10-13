import { expect, test } from '@playwright/test';
import { installWebParityState } from './fixtures/parity-state';

test.beforeEach(async ({ page }) => { await installWebParityState(page); });

test('character shows existing growth, next chest goals and equipment in Web reference order', async ({ page }) => {
    await page.goto('/character');
    await expect(page.getByText('星見ユウ', { exact: true })).toBeVisible();
    await expect(page.getByText('タスク消化数', { exact: true })).toBeVisible();
    await expect(page.getByText('⚔️ 攻撃', { exact: true })).toHaveCSS('white-space', 'nowrap');
    await expect(page.getByText('残り 13', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /宝箱ロードマップ/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: '装備中', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '最強装備を自動装着' })).toBeVisible();
});

test('profile drafts only save explicitly and retain the shared 30-character name limit', async ({ page }) => {
    await page.goto('/character');
    await page.getByRole('button', { name: 'プロフィールを編集', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'プロフィール編集' });
    const name = dialog.getByPlaceholder('名前を入力');
    await expect(name).toHaveAttribute('maxlength', '30');
    await name.fill('Cancelled draft');
    await dialog.getByRole('button', { name: 'プロフィール編集を閉じる' }).click();
    await expect(page.getByText('星見ユウ', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'プロフィールを編集', exact: true }).click();
    const longName = 'PortfolioHero'.repeat(2);
    await name.fill(longName);
    await dialog.getByRole('button', { name: '保存する', exact: true }).click();
    await expect(page.getByText(longName, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'プロフィールを編集', exact: true }).click();
    await expect(name).toHaveValue(longName);
});
