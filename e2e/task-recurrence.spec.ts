import { expect, test } from '@playwright/test';
import { createWebParityStorage, PARITY_FIXED_NOW } from '@life-quest/core/parityFixture';

for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: recurrence editing, cancellation and reload keep Web behavior`, async ({ page }, testInfo) => {
        if (testInfo.project.name === 'mobile-chromium') await page.setViewportSize({ width: 402, height: 874 });
        await page.emulateMedia({ colorScheme: theme });
        await page.clock.install({ time: new Date(PARITY_FIXED_NOW) });
        await page.addInitScript((storage) => {
            // Seed once in this isolated browser; a reload must read the actual edited storage.
            if (sessionStorage.getItem('task-recurrence-fixture')) return;
            localStorage.clear(); sessionStorage.setItem('task-recurrence-fixture', 'true');
            for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
        }, createWebParityStorage(theme));
        await page.goto('/tasks');
        await page.getByRole('button', { name: '編集', exact: true }).nth(1).click();
        const recurrence = page.getByRole('combobox', { name: /^繰り返し/ });
        await expect(recurrence).toHaveValue('none');
        await page.screenshot({ path: testInfo.outputPath(`task-initial-${theme}.png`) });
        await recurrence.selectOption('weekly');
        await page.screenshot({ path: testInfo.outputPath(`task-edit-${theme}.png`) });
        await page.getByRole('button', { name: '更新', exact: true }).click();
        await page.getByRole('button', { name: '編集', exact: true }).nth(1).click();
        await expect(recurrence).toHaveValue('weekly');
        await recurrence.selectOption('none');
        await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
        await page.reload();
        await page.getByRole('button', { name: '編集', exact: true }).nth(1).click();
        await expect(recurrence).toHaveValue('weekly');
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-tasks')!).state.tasks);
        expect(stored.find((task: { name: string }) => task.name === 'メールを返信する').recurrence).toBe('weekly');
    });
}
