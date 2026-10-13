import { expect, test } from '@playwright/test';
import { installWebParityState } from './fixtures/parity-state';
import { MAP_CONFIG } from '@life-quest/core/battle';

for (const map of MAP_CONFIG.slice(1)) {
    test(`${map.name} switches at its unlock boundary and keeps progress unchanged`, async ({ page }) => {
        const maxClearedStage = map.stageRange[0] - 1;
        await installWebParityState(page, 'dark', { currentStage: 1, maxClearedStage });
        await page.goto('/map');
        await page.getByRole('button', { name: map.name, exact: true }).click();
        await expect(page.getByRole('button', { name: map.name, exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByText(new RegExp(`^ステージ ${map.stageRange[0]}:`))).toBeVisible();
        await expect(page.getByRole('button', { name: 'スタート', exact: true })).toHaveCount(1);
        await expect(page.getByText(`最高到達: ステージ ${maxClearedStage}`, { exact: true })).toBeVisible();
        await page.getByRole('button', { name: '草原エリア', exact: true }).click();
        await expect(page.getByRole('button', { name: '再挑戦', exact: true })).toHaveCount(10);
    });
}

test('a stale selected area falls back to grassland without revealing locked stages', async ({ page }) => {
    await installWebParityState(page, 'dark', { currentStage: 31, maxClearedStage: 2 });
    await page.goto('/map');
    await expect(page.getByRole('button', { name: '草原エリア', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: '深海エリア（未開放）', exact: true })).toBeDisabled();
    await expect(page.getByText('ステージ 3: 大コウモリ', { exact: true })).toBeVisible();
});

test('a locked map keeps the blue chest goal and exposes no start actions', async ({ page }) => {
    await installWebParityState(page, 'light', { currentStage: 1, maxClearedStage: 0, battleUnlocked: false });
    await page.goto('/map');
    await expect(page.getByRole('heading', { name: 'マップ未解放', exact: true })).toBeVisible();
    await expect(page.getByText(/タスクを5つ消化して青色の宝箱を/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'スタート', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '再挑戦', exact: true })).toHaveCount(0);
});

test('map shows progress, four area gates and the next enemy without starting a locked stage', async ({ page }) => {
    await installWebParityState(page);
    await page.goto('/map');
    await expect(page.getByText('最高到達: ステージ 2', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '草原エリア', exact: true })).toHaveAttribute('aria-pressed', 'true');
    for (const area of ['古城エリア', '天界エリア', '深海エリア']) {
        await expect(page.getByRole('button', { name: `${area}（未開放）`, exact: true })).toBeDisabled();
    }
    await expect(page.getByText('ステージ 3: 大コウモリ', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'スタート', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: '再挑戦', exact: true })).toHaveCount(2);
    await expect(page.getByText('ステージ 11: スケルトン', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '再挑戦', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: /草原エリア — ステージ 1: スライム/ })).toBeVisible();
    await page.clock.runFor(3000);
    await expect(page.getByText('勝利！', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'マップへ', exact: true }).click();
    await expect(page.getByText('最高到達: ステージ 2', { exact: true })).toBeVisible();
});
