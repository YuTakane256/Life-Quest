import { expect, test } from '@playwright/test';
import { createWebParityStorage, PARITY_FIXED_NOW } from '@life-quest/core/parityFixture';

for (const theme of ['light', 'dark'] as const) test.describe(theme, () => {
    test.beforeEach(async ({ page }, testInfo) => {
        if (testInfo.project.name === 'mobile-chromium') await page.setViewportSize({ width: 402, height: 874 });
        await page.emulateMedia({ colorScheme: theme });
        await page.clock.install({ time: new Date(PARITY_FIXED_NOW) });
        await page.addInitScript((storage) => {
            if (sessionStorage.getItem('habit-list-fixture')) return;
            localStorage.clear(); sessionStorage.setItem('habit-list-fixture', 'true');
            for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
        }, createWebParityStorage(theme));
        await page.goto('/habits');
        await page.getByRole('button', { name: '習慣「朝に散歩する」を達成にする', exact: true }).waitFor();
    });
    test('completion, saved memo and uncompletion preserve the normal record', async ({ page }, testInfo) => {
        await page.getByRole('button', { name: '習慣「朝に散歩する」を達成にする', exact: true }).click();
        await page.getByPlaceholder('今日の一言...').fill('Saved daily memo');
        await page.getByRole('button', { name: '保存', exact: true }).click();
        await expect(page.getByText('Saved daily memo', { exact: true })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`habit-list-${theme}-completed.png`) });
        await page.getByRole('button', { name: '習慣「朝に散歩する」を未達成にする', exact: true }).click();
        await page.reload();
        await expect(page.getByRole('button', { name: '習慣「朝に散歩する」を達成にする', exact: true })).toBeVisible();
        await expect(page.getByText('Saved daily memo', { exact: true })).toBeVisible();
        const record = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-habits')!).state.dailyRecords.find((entry: { habitId: string; date: string }) => entry.habitId === 'parity-walk' && entry.date === '2026-08-10'));
        expect(record).toMatchObject({ completed: false, memo: 'Saved daily memo' });
    });
    test('existing history selection still displays the saved day and memo', async ({ page }, testInfo) => {
        await page.getByRole('button', { name: '「読書を20分続ける」の達成履歴を表示', exact: true }).click();
        const dialog = page.getByRole('dialog'); await dialog.locator('[title="2026-08-10 達成"]').click();
        await expect(dialog.locator('strong').locator('..')).toContainText('朝の読書タイム');
        await page.screenshot({ path: testInfo.outputPath(`habit-history-${theme}.png`) });
        await page.getByRole('button', { name: '履歴を閉じる', exact: true }).click();
        await expect(page.getByRole('button', { name: '習慣「読書を20分続ける」を未達成にする', exact: true })).toBeVisible();
    });
    test('a stale day is refreshed before allowing a new daily completion', async ({ page }, testInfo) => {
        await page.clock.setSystemTime(new Date('2026-08-11T00:01:00+09:00'));
        const complete = page.getByRole('button', { name: '習慣「朝に散歩する」を達成にする', exact: true });
        await complete.click();
        await expect(page.getByRole('alert').filter({ hasText: '日付または習慣の内容が変わりました' })).toBeVisible();
        await expect(page.getByPlaceholder('今日の一言...')).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath(`habit-list-${theme}-expired.png`) });
        const before = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-habits')!).state.dailyRecords);
        expect(before.some((entry: { date: string }) => entry.date === '2026-08-11')).toBe(false);
        await complete.click(); await page.getByPlaceholder('今日の一言...').fill('New day memo');
        await page.getByRole('button', { name: '保存', exact: true }).click(); await page.reload();
        await expect(page.getByText('New day memo', { exact: true })).toBeVisible();
        const after = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-habits')!).state.dailyRecords);
        expect(after.find((entry: { habitId: string; date: string }) => entry.habitId === 'parity-walk' && entry.date === '2026-08-11')).toMatchObject({ completed: true, memo: 'New day memo' });
        expect(after.find((entry: { habitId: string; date: string }) => entry.habitId === 'parity-walk' && entry.date === '2026-08-10')).toMatchObject({ completed: false, memo: '' });
    });
    test('category filtering recovers after deleting the final item in that category', async ({ page }, testInfo) => {
        await page.getByRole('button', { name: 'カテゴリ: 健康', exact: true }).click();
        await expect(page.getByRole('button', { name: '「読書を20分続ける」の達成履歴を表示', exact: true })).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath(`habit-list-${theme}-filtered.png`) });
        await page.getByRole('button', { name: '「朝に散歩する」を削除', exact: true }).click();
        await page.getByRole('button', { name: '削除する', exact: true }).click();
        await expect(page.getByRole('button', { name: '「読書を20分続ける」の達成履歴を表示', exact: true })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`habit-list-${theme}-reset.png`) });
    });
});
