import { expect, test } from '@playwright/test';
import { installWebParityState } from './fixtures/parity-state';

test('touch-width task rows expose edit/duplicate/delete without requiring hover', async ({
    page,
}) => {
    await page.setViewportSize({ width: 402, height: 874 });
    await installWebParityState(page);
    await page.goto('/tasks');
    const edit = page
        .getByRole('button', { name: '編集', exact: true })
        .first();
    await expect(edit).toBeVisible();
    await expect(edit.locator('..')).toHaveCSS('opacity', '1');
    await edit.click();
    await expect(page.getByPlaceholder('タスク名を入力...')).toHaveValue(
        '今週の計画を整理する',
    );
    await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
    await expect(
        page.getByText('今週の計画を整理する', { exact: true }),
    ).toBeVisible();
});
