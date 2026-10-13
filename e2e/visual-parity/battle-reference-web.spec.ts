import { expect, test } from '@playwright/test';
import { installWebParityState, waitForWebParityRender } from '../fixtures/parity-state';

for (const theme of ['light', 'dark'] as const) {
    test(`${theme} battle victory and defeat reference at 402x874`, async ({ page }, testInfo) => {
        await installWebParityState(page, theme, undefined, 'battle');
        await page.goto('/map');
        await expect(page.getByText('最高到達: ステージ 9', { exact: true })).toBeVisible();
        // Only this isolated browser's timers: no production timer changes.
        await page.clock.pauseAt(new Date('2026-08-10T12:01:00.000Z'));
        await page.clock.setFixedTime(new Date('2026-08-10T12:00:00.000Z'));
        const stage = page.getByText('ステージ 3: 大コウモリ', { exact: true }).locator('..').locator('..');
        // Timers/RAF are paused for exact screenshot state; real clicks are tested separately.
        await stage.getByRole('button', { name: '再挑戦', exact: true }).dispatchEvent('click');
        await expect(page.getByRole('progressbar', { name: '大コウモリ のHP' })).toBeVisible();
        await page.clock.runFor(1000);
        await expect(page.getByRole('progressbar', { name: '大コウモリ のHP' })).toHaveAttribute('aria-valuenow', '44');
        const capture = async (name: string) => {
            await waitForWebParityRender(page);
            await page.getByRole('log', { name: 'バトルログ' }).evaluate((element) => { element.scrollTop = element.scrollHeight; });
            const path = testInfo.outputPath(`web-${theme}-${name}.png`);
            await page.screenshot({ path, animations: 'disabled', caret: 'hide', scale: 'css' });
            await testInfo.attach(`web-${theme}-${name}`, { path, contentType: 'image/png' });
        };
        await capture('battle');
        await page.clock.runFor(2000);
        await expect(page.getByText('勝利！', { exact: true })).toBeVisible();
        await expect(page.getByText('15 XP を獲得！', { exact: true })).toBeVisible();
        await capture('victory');
        await page.getByRole('button', { name: 'マップへ', exact: true }).dispatchEvent('click');
        await page.getByRole('button', { name: 'スタート', exact: true }).dispatchEvent('click');
        await expect(page.getByRole('progressbar', { name: 'ミノタウロス のHP' })).toBeVisible();
        await page.clock.runFor(8000);
        await expect(page.getByText('敗北...', { exact: true })).toBeVisible();
        await capture('defeat');
    });
}
