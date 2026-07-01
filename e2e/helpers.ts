import type { Page } from '@playwright/test';

export async function dismissStartupDialogs(page: Page): Promise<void> {
    const loginBonusDialog = page.getByRole('dialog', { name: 'ログインボーナス' });
    try {
        await loginBonusDialog.waitFor({ state: 'visible', timeout: 2_000 });
    } catch {
        return;
    }
    await loginBonusDialog.getByRole('button', { name: '閉じる' }).click();
    await loginBonusDialog.waitFor({ state: 'hidden' });
}
