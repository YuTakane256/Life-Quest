import { expect, test } from '@playwright/test';
import { dismissStartupDialogs } from './helpers';

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        if (window.sessionStorage.getItem('e2e-storage-initialized')) return;
        window.localStorage.clear();
        window.sessionStorage.setItem('e2e-storage-initialized', 'true');
    });
});

test('creates, searches, and completes a task', async ({ page }) => {
    const taskName = 'E2Eで動作確認する';
    await page.goto('/tasks');
    await dismissStartupDialogs(page);

    await expect(page.getByRole('heading', { name: 'タスク', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '新しいタスクを追加' }).click();
    await page.getByPlaceholder('タスク名を入力...').fill(taskName);
    await page.getByRole('button', { name: '追加', exact: true }).click();

    await expect(page.getByText(taskName, { exact: true })).toBeVisible();
    await page.getByPlaceholder('タスクを検索...').fill('E2Eで');
    await expect(page.getByText(taskName, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: `タスク「${taskName}」を完了にする` }).click();
    await expect(page.getByText('完了タスク (1)', { exact: true })).toBeVisible();
});

test('keeps task data after a reload', async ({ page }) => {
    const taskName = '再読み込み後も残る';
    await page.goto('/tasks');
    await dismissStartupDialogs(page);
    await page.getByRole('button', { name: '新しいタスクを追加' }).click();
    await page.getByPlaceholder('タスク名を入力...').fill(taskName);
    await page.getByRole('button', { name: '追加', exact: true }).click();

    await page.reload();
    await expect(page.getByText(taskName, { exact: true })).toBeVisible();
});
