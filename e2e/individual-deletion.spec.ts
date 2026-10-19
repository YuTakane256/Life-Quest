import { expect, test } from '@playwright/test';
import { createWebParityStorage, PARITY_FIXED_NOW } from '@life-quest/core/parityFixture';

for (const theme of ['light', 'dark'] as const) {
    test.describe(theme, () => {
        test.beforeEach(async ({ page }, testInfo) => {
            if (testInfo.project.name === 'mobile-chromium') await page.setViewportSize({ width: 402, height: 874 });
            await page.emulateMedia({ colorScheme: theme });
            await page.clock.install({ time: new Date(PARITY_FIXED_NOW) });
            await page.addInitScript((storage) => {
                if (sessionStorage.getItem('individual-deletion-fixture')) return;
                localStorage.clear(); sessionStorage.setItem('individual-deletion-fixture', 'true');
                for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
            }, createWebParityStorage(theme));
        });
        test('task cancel/confirm preserves other tasks and persists removal', async ({ page }, testInfo) => {
            await page.goto('/tasks');
            const before = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-tasks')!).state);
            expect(before.tasks.some((item: { id: string }) => item.id === 'parity-plan-week')).toBe(true);
            const remove = page.getByRole('button', { name: '「今週の計画を整理する」を削除', exact: true });
            await remove.click();
            const dialog = page.getByRole('dialog', { name: 'タスクを削除しますか？' });
            await expect(dialog).toContainText('サブタスク');
            await page.screenshot({ path: testInfo.outputPath(`task-delete-${theme}.png`) });
            await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click();
            await expect(remove).toBeVisible();
            await remove.click();
            await dialog.getByRole('button', { name: '削除する', exact: true }).click();
            await expect(remove).toHaveCount(0);
            await expect(page.getByText('メールを返信する', { exact: true })).toBeVisible();
            await page.reload();
            const state = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-tasks')!).state);
            expect(state.tasks.some((item: { id: string }) => item.id === 'parity-plan-week')).toBe(false);
            expect(state.tasks).toHaveLength(before.tasks.length - 1);
            await expect(remove).toHaveCount(0);
        });
        test('habit confirmation explains history removal and preserves other history', async ({ page }, testInfo) => {
            // Match the iOS flow's preceding task deletion as well as its habit/date/theme.
            await page.goto('/tasks');
            await page.getByRole('button', { name: '「今週の計画を整理する」を削除', exact: true }).click();
            await page.getByRole('dialog').getByRole('button', { name: '削除する', exact: true }).click();
            await page.goto('/habits');
            const remove = page.getByRole('button', { name: '「読書を20分続ける」を削除', exact: true });
            await remove.click();
            const dialog = page.getByRole('dialog', { name: '習慣を削除しますか？' });
            await expect(dialog).toContainText('達成履歴・メモ');
            await page.screenshot({ path: testInfo.outputPath(`habit-delete-${theme}.png`) });
            await page.keyboard.press('Escape');
            await expect(dialog).toHaveCount(0);
            await expect(remove).toBeVisible();
            await remove.click();
            await dialog.getByRole('button', { name: '削除する', exact: true }).click();
            await expect(remove).toHaveCount(0);
            await page.reload();
            const state = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-habits')!).state);
            expect(state.habits.map((item: { id: string }) => item.id)).toEqual(['parity-walk']);
            expect(state.dailyRecords).toHaveLength(3);
            expect(state.dailyRecords.every((item: { habitId: string }) => item.habitId === 'parity-walk')).toBe(true);
            await expect(page.getByText('朝に散歩する', { exact: true })).toBeVisible();
        });
        test('a task changed during confirmation stays intact until approved again', async ({ page }) => {
            await page.goto('/tasks');
            await page.getByRole('button', { name: '「メールを返信する」を削除', exact: true }).click();
            await page.evaluate(async () => {
                const path = '/src/stores/useTaskStore.ts'; const { useTaskStore } = await import(path);
                useTaskStore.setState((state: { tasks: { name: string }[] }) => ({ tasks: state.tasks.map((item) =>
                    item.name === 'メールを返信する' ? { ...item, name: '同期後のタスク' } : item) }));
            });
            const dialog = page.getByRole('dialog', { name: 'タスクを削除しますか？' });
            await dialog.getByRole('button', { name: '削除する', exact: true }).click();
            await expect(dialog.getByRole('alert')).toContainText('削除し直してください');
            await expect(dialog.getByRole('button', { name: '削除する', exact: true })).toBeDisabled();
            await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click();
            const remove = page.getByRole('button', { name: '「同期後のタスク」を削除', exact: true });
            await expect(remove).toBeVisible(); await remove.click();
            await expect(dialog.getByRole('button', { name: '削除する', exact: true })).toBeEnabled();
            await dialog.getByRole('button', { name: '削除する', exact: true }).click();
            await expect(remove).toHaveCount(0);
        });
        test('a changed habit memo is retained and explained inside the confirmation', async ({ page }) => {
            await page.goto('/habits');
            await page.getByRole('button', { name: '「読書を20分続ける」を削除', exact: true }).click();
            await page.evaluate(async () => {
                const path = '/src/stores/useHabitStore.ts'; const { useHabitStore } = await import(path);
                useHabitStore.setState((state: { dailyRecords: { habitId: string; memo: string }[] }) => ({
                    dailyRecords: state.dailyRecords.map((entry) => entry.habitId === 'parity-reading' ? { ...entry, memo: '同期後のメモ' } : entry),
                }));
            });
            const dialog = page.getByRole('dialog', { name: '習慣を削除しますか？' });
            await dialog.getByRole('button', { name: '削除する', exact: true }).click();
            await expect(dialog.getByRole('alert')).toContainText('達成記録は変更されています');
            await expect(dialog.getByRole('button', { name: '削除する', exact: true })).toBeDisabled();
            await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click();
            await page.reload();
            await expect(page.getByText('同期後のメモ', { exact: true })).toBeVisible();
            await expect(page.getByRole('button', { name: '「読書を20分続ける」を削除', exact: true })).toBeVisible();
        });
    });
}
