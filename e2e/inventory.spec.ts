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
