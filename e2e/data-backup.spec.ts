import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { dismissStartupDialogs } from './helpers';

async function addTask(page: Page, name: string) {
    await page.getByRole('button', { name: '新しいタスクを追加' }).click();
    await page.getByPlaceholder('タスク名を入力...').fill(name);
    await page.getByRole('button', { name: '追加', exact: true }).click();
}

for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: actual JSON download, cancel, restore and reload preserve the selected snapshot`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await page.goto('/settings');
        await dismissStartupDialogs(page);
        // Only the disposable anonymous Playwright context may be overwritten.
        await expect(page.getByText('クラウド接続は未設定です。これまでどおり端末内のみで動作します。', { exact: true })).toBeVisible();
        const navigation = page.getByRole('navigation', { name: 'メインナビゲーション' });
        const tasks = navigation.getByRole('button', { name: 'タスク', exact: true });
        const settings = navigation.getByRole('button', { name: '設定', exact: true });
        await tasks.click(); await addTask(page, 'バックアップに残すタスク'); await settings.click();
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.getByRole('button', { name: '保存', exact: true }).click(),
        ]);
        expect(download.suggestedFilename()).toMatch(/^life-quest-backup-\d{4}-\d{2}-\d{2}\.json$/);
        const path = await download.path(); expect(path).not.toBeNull();
        const buffer = await readFile(path!);
        const backup = JSON.parse(buffer.toString());
        expect(backup.tasks.state.tasks).toHaveLength(1);
        expect(backup.tasks.state.tasks[0].name).toBe('バックアップに残すタスク');
        expect(backup.integrity.checksum).toBeTruthy();

        await tasks.click(); await addTask(page, '保存後に追加したタスク'); await settings.click();
        const input = page.locator('input[type="file"]');
        const candidate = { name: 'saved.json', mimeType: 'application/json', buffer };
        await input.setInputFiles(candidate);
        const dialog = page.getByRole('dialog', { name: 'データを上書きしますか？' });
        await expect(dialog).toContainText('タスク');
        await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click();
        await tasks.click(); await expect(page.getByText('保存後に追加したタスク', { exact: true })).toBeVisible();
        await settings.click();
        await input.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('invalid') });
        await expect(page.getByRole('alert')).toContainText('バックアップ操作に失敗しました');

        await input.setInputFiles(candidate);
        await expect(page.getByRole('alert')).toHaveCount(0);
        await Promise.all([
            page.waitForEvent('load'),
            dialog.getByRole('button', { name: '上書きする', exact: true }).click(),
        ]);
        await tasks.click();
        await expect(page.getByText('バックアップに残すタスク', { exact: true })).toBeVisible();
        await expect(page.getByText('保存後に追加したタスク', { exact: true })).toHaveCount(0);
        const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-tasks')!).state.tasks);
        expect(restored).toHaveLength(1); expect(restored[0].name).toBe('バックアップに残すタスク');
    });
}
