import { expect, test } from '@playwright/test';
import { installWebParityState, taskParitySnapshotName, waitForWebParityRender } from '../fixtures/parity-state';

test.beforeEach(async ({ page }) => {
    await installWebParityState(page);
});

test('renders the deterministic dark task reference at 390x844', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page.getByRole('heading', { name: 'タスク', exact: true })).toBeVisible();
    await expect(page.getByText('今週の計画を整理する', { exact: true })).toBeVisible();
    await expect(page.getByText('優先順位を書き出す', { exact: true })).toBeVisible();
    await expect(page.getByText('予定を確認する', { exact: true })).toBeVisible();

    await page.getByText('完了タスク (1)', { exact: true }).click();
    await expect(page.getByText('朝の散歩を記録する', { exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'メインナビゲーション' })).toBeVisible();
    await waitForWebParityRender(page);

    await expect(page).toHaveScreenshot(taskParitySnapshotName, {
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
    });
});
