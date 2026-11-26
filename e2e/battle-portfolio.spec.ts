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
    const next = page.getByRole('button', { name: '次へ', exact: true });
    const back = page.getByRole('button', { name: 'マップへ', exact: true });
    const nextBox = (await next.boundingBox())!;
    const backBox = (await back.boundingBox())!;
    expect(nextBox.y).toBeCloseTo(backBox.y, 0);
    expect(nextBox.x + nextBox.width).toBeLessThanOrEqual(backBox.x);
    await next.click();
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

for (const [theme, won] of [['light', true], ['dark', false]] as const) {
    test(`${theme} battle result actions fit at 320px and 200% text`, async ({ page }, testInfo) => {
        await installWebParityState(page, theme, undefined, 'battle');
        await page.goto('/map');
        const start = won
            ? page.getByText('ステージ 3: 大コウモリ', { exact: true }).locator('../..').getByRole('button', { name: '再挑戦', exact: true })
            : page.getByRole('button', { name: 'スタート', exact: true });
        await start.click();
        await page.clock.runFor(won ? 3000 : 8000);
        await expect(page.getByRole('heading', { name: won ? '勝利！' : '敗北...', exact: true })).toBeVisible();
        await page.setViewportSize({ width: 320, height: 568 });
        await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
        const primary = page.getByRole('button', { name: won ? '次へ' : 'リトライ', exact: true });
        const back = page.getByRole('button', { name: 'マップへ', exact: true });
        await back.scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`battle-${theme}-large-text.png`), scale: 'css', animations: 'disabled' });

        const primaryBox = (await primary.boundingBox())!;
        const backBox = (await back.boundingBox())!;
        expect(primaryBox.y + primaryBox.height).toBeLessThanOrEqual(backBox.y);
        expect(primaryBox.width).toBeCloseTo(backBox.width, 0);
        for (const action of [primary, back]) {
            const fits = await action.evaluate((button) => {
                const rect = button.getBoundingClientRect();
                const card = button.parentElement!.parentElement!.getBoundingClientRect();
                return rect.width >= 44 && rect.height >= 44 && rect.left >= card.left
                    && rect.right <= Math.min(card.right, document.documentElement.clientWidth)
                    && button.scrollWidth <= button.clientWidth;
            });
            expect(fits).toBe(true);
            await action.click({ trial: true });
        }
        await primary.click();
        await expect(page.getByRole('heading', { name: won ? /ステージ 4:/ : /ステージ 10:/ })).toBeVisible();
        await page.clock.runFor(8000);
        await back.click();
        await expect(page.getByRole('heading', { name: 'マップ', exact: true })).toBeVisible();
    });
}
