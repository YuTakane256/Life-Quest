import { expect, test, type Page } from '@playwright/test';
import { installWebParityState, waitForWebParityRender } from '../fixtures/parity-state';

test.beforeEach(async ({ page }) => {
    await installWebParityState(page);
});

async function capture(page: Page, name: string): Promise<void> {
    await waitForWebParityRender(page);
    await expect(page).toHaveScreenshot(name, { animations: 'disabled', caret: 'hide', scale: 'css' });
}

test('renders the deterministic dark habits reference at 390x844', async ({ page }) => {
    await page.goto('/habits');
    await expect(page.getByRole('heading', { name: '習慣', exact: true })).toBeVisible();
    await expect(page.getByText('読書を20分続ける', { exact: true })).toBeVisible();
    await expect(page.getByText('朝に散歩する', { exact: true })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: '本日の習慣達成状況' })).toHaveAttribute('aria-valuetext', '本日 1 / 2 達成');
    await expect(page.getByRole('navigation', { name: 'メインナビゲーション' })).toBeVisible();
    await capture(page, 'habits-page-dark.png');
});

test('renders the deterministic dark statistics reference at 390x844', async ({ page }) => {
    await page.goto('/stats');
    await expect(page.getByRole('heading', { name: '統計', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '今週のXP', exact: true })).toBeVisible();
    await expect(page.getByText('⚡ 合計 245 XP', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '🏅 実績', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'メインナビゲーション' })).toBeVisible();
    await capture(page, 'stats-page-dark.png');
});

test('renders the deterministic dark character reference at 390x844', async ({ page }) => {
    await page.goto('/character');
    await expect(page.getByText('星見ユウ', { exact: true })).toBeVisible();
    await expect(page.getByText('装備中', { exact: true })).toBeVisible();
    await expect(page.getByText('鋼の刃', { exact: true })).toBeVisible();
    await expect(page.getByText('タスク消化数', { exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'メインナビゲーション' })).toBeVisible();
    await capture(page, 'character-page-dark.png');
});

test('renders the deterministic dark inventory reference at 390x844', async ({ page }) => {
    await page.goto('/character/inventory');
    await expect(page.getByRole('heading', { name: 'インベントリ', exact: true })).toBeVisible();
    await expect(page.getByText('インベントリ (4/4)', { exact: true })).toBeVisible();
    await expect(page.getByText('鉄の剣', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /売却/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /合成/ })).toBeVisible();
    await capture(page, 'inventory-page-dark.png');
});

test('renders the deterministic dark settings reference at 390x844', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: '設定', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'テーマ', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ダーク', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: '同期', exact: true })).toBeVisible();
    await capture(page, 'settings-page-dark.png');
});
