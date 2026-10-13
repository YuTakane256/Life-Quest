import { expect, test } from '@playwright/test';
import { installWebParityState } from './fixtures/parity-state';

test('battle portraits, victory and next-stage controls remain usable', async ({ page }) => {
    await installWebParityState(page, 'dark', undefined, 'battle');
    await page.goto('/map');
    await page.getByText('ステージ 3: 大コウモリ', { exact: true }).locator('..').locator('..')
        .getByRole('button', { name: '再挑戦', exact: true }).click();
    await expect(page.getByRole('progressbar', { name: '星見ユウ のHP' })).toHaveAttribute('aria-valuemax', '125');
    await expect(page.getByRole('button', { name: /強撃/ })).toBeVisible();
    await page.clock.runFor(3000);
    await expect(page.getByText('勝利！', { exact: true })).toBeVisible();
    await expect(page.getByText('15 XP を獲得！', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '次へ', exact: true }).click();
    await expect(page.getByRole('heading', { name: /ステージ 4: 角ウサギ/ })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: '角ウサギ のHP' })).toHaveAttribute('aria-valuemax', '90');
});

test('defeat permits retry and map return without awarding victory XP', async ({ page }) => {
    await installWebParityState(page, 'light', undefined, 'battle');
    await page.goto('/map');
    await page.getByRole('button', { name: 'スタート', exact: true }).click();
    await expect(page.getByRole('heading', { name: /ステージ 10: ミノタウロス/ })).toBeVisible();
    await page.clock.runFor(8000);
    await expect(page.getByText('敗北...', { exact: true })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: '星見ユウ のHP' })).toHaveAttribute('aria-valuenow', '0');
    await expect(page.getByText(/XP を獲得！/)).toHaveCount(0);
    await page.getByRole('button', { name: 'リトライ', exact: true }).click();
    await expect(page.getByRole('button', { name: /防御態勢/ })).toBeVisible();
    await page.clock.runFor(8000);
    await expect(page.getByText('敗北...', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'マップへ', exact: true }).click();
    await expect(page.getByText('最高到達: ステージ 9', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'キャラ', exact: true }).click();
    await expect(page.getByText('330 / 400', { exact: true })).toBeVisible();
});
