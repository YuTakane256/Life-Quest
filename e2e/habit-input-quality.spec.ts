import { expect, test } from '@playwright/test';
import { createWebParityStorage, PARITY_FIXED_NOW } from '@life-quest/core/parityFixture';

for (const theme of ['light', 'dark'] as const) {
    test.describe(theme, () => {
    test.beforeEach(async ({ page }, testInfo) => {
        if (testInfo.project.name === 'mobile-chromium') await page.setViewportSize({ width: 402, height: 874 });
        await page.emulateMedia({ colorScheme: theme });
        await page.clock.install({ time: new Date(PARITY_FIXED_NOW) });
        await page.addInitScript((storage) => {
            if (sessionStorage.getItem('habit-input-fixture')) return;
            localStorage.clear(); sessionStorage.setItem('habit-input-fixture', 'true');
            for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
        }, createWebParityStorage(theme));
        await page.goto('/habits');
    });
    test(`${theme}: add, memo, cancel and rest-day confirmation preserve normal operation`, async ({ page }, testInfo) => {
        await page.getByRole('button', { name: '新しい習慣を追加', exact: true }).click();
        await page.getByPlaceholder('新しい習慣を入力...').fill('Input habit');
        await page.locator('form').getByRole('button', { name: /健康/ }).click();
        await page.getByRole('button', { name: '追加', exact: true }).click();
        await page.getByRole('button', { name: '習慣「Input habit」を達成にする', exact: true }).click();
        await page.getByPlaceholder('今日の一言...').fill('Saved memo');
        await page.screenshot({ path: testInfo.outputPath(`habit-${theme}-memo.png`) });
        await page.getByRole('button', { name: '保存', exact: true }).click();
        await expect(page.getByText('Saved memo', { exact: true })).toBeVisible();
        await page.reload();
        await expect(page.getByText('Saved memo', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: '今日をお休みにする', exact: true }).click();
        await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
        await expect(page.getByRole('button', { name: '今日をお休みにする', exact: true })).toBeEnabled();
        await page.getByRole('button', { name: '今日をお休みにする', exact: true }).click();
        await page.getByRole('button', { name: 'お休みにする', exact: true }).click();
        await expect(page.getByRole('button', { name: '今日をお休みにする', exact: true })).toBeDisabled();
    });
    test(`${theme}: expired memo and rest confirmations do not write another day`, async ({ page }, testInfo) => {
        await page.getByRole('button', { name: '習慣「朝に散歩する」を達成にする', exact: true }).click();
        await page.getByPlaceholder('今日の一言...').fill('Previous day draft');
        await page.clock.setSystemTime(new Date('2026-08-11T00:01:00+09:00'));
        await page.getByRole('button', { name: '保存', exact: true }).click();
        await expect(page.getByRole('alert').filter({ hasText: '日付が変わりました' })).toBeVisible();
        await expect(page.getByPlaceholder('今日の一言...')).toHaveValue('Previous day draft');
        await page.screenshot({ path: testInfo.outputPath(`habit-${theme}-expired.png`) });
        await page.getByRole('button', { name: 'スキップ', exact: true }).click();
        await page.getByRole('button', { name: '今日をお休みにする', exact: true }).click();
        await page.clock.setSystemTime(new Date('2026-08-12T00:01:00+09:00'));
        await page.getByRole('button', { name: 'お休みにする', exact: true }).click();
        const state = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-habits')!).state);
        expect(state.restDays).toEqual([]);
        expect(state.dailyRecords.some((entry: { memo: string }) => entry.memo === 'Previous day draft')).toBe(false);
    });
    });
}
