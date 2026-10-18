import { expect, test } from '@playwright/test';
import { dismissStartupDialogs } from './helpers';

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        if (window.sessionStorage.getItem('e2e-storage-initialized')) return;
        window.localStorage.clear();
        const equipment = Array.from({ length: 7 }, (_, index) => ({
            id: `e2e-item-${index}`,
            templateId: 'wooden_sword',
            name: '木の剣',
            slot: 'weapon',
            rarity: 'common',
            attackBonus: 2,
            defenseBonus: 0,
            hpBonus: 0,
            equipped: false,
        }));
        window.localStorage.setItem('quest-board-game', JSON.stringify({
            state: {
                equipment,
                gachaCount: 0,
                chestQueue: [],
            },
            version: 0,
        }));
        window.sessionStorage.setItem('e2e-storage-initialized', 'true');
    });
});

test('opens the full inventory from the character page', async ({ page }) => {
    await page.goto('/character');
    await dismissStartupDialogs(page);

    const viewAll = page.getByRole('link', { name: /もっと見る/ });
    await expect(viewAll).toBeVisible();
    await viewAll.click();

    await expect(page).toHaveURL(/\/character\/inventory$/);
    await expect(page.getByRole('heading', { name: 'インベントリ', exact: true })).toBeVisible();
    await expect(page.getByText('インベントリ (7/7)', { exact: true })).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: inventory sale cancel/confirm and synthesis keep the normal path`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await page.goto('/character/inventory');
        await dismissStartupDialogs(page);
        await page.getByRole('button', { name: '売却', exact: true }).click();
        await page.getByRole('button', { name: '木の剣を売却して+5XP獲得', exact: true }).first().click();
        const dialog = page.getByRole('dialog', { name: '装備を売却しますか？' });
        await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click();
        await expect(page.getByText('インベントリ (7/7)', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: '木の剣を売却して+5XP獲得', exact: true }).first().click();
        await dialog.getByRole('button', { name: '売却する', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.getByText('インベントリ (6/6)', { exact: true })).toBeVisible();
        await expect(page.getByText('+5 XP 獲得！', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: '合成', exact: true }).click();
        for (let index = 0; index < 3; index++) await page.getByRole('checkbox', { name: '木の剣を合成対象に選択', exact: true }).first().click();
        await page.getByRole('button', { name: '合成する', exact: true }).click();
        await expect(page.getByText('インベントリ (4/4)', { exact: true })).toBeVisible();
        await expect(page.getByText(/ランクの装備を合成しました/)).toBeVisible();
        await page.reload();
        await expect(page.getByText('インベントリ (4/4)', { exact: true })).toBeVisible();
    });
}
