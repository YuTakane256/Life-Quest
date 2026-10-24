import { expect, test } from '@playwright/test';
import { ACHIEVEMENTS } from '@life-quest/core/achievements';
import { installWebParityState } from './fixtures/parity-state';

for (const theme of ['light', 'dark'] as const) test.describe(theme, () => {
    test.beforeEach(async ({ page }, testInfo) => {
        if (testInfo.project.name === 'mobile-chromium') await page.setViewportSize({ width: 402, height: 874 });
        await installWebParityState(page, theme); await page.goto('/stats');
    });
    test('all achievement conditions, status and titles; selection persists and reaches character', async ({ page }, testInfo) => {
        const card = page.getByRole('region', { name: '実績と称号', exact: true });
        await expect(card.getByText('2/6 達成', { exact: true })).toBeVisible();
        for (const definition of ACHIEVEMENTS) {
            const row = card.getByTestId(`achievement-${definition.id}`);
            await expect(row.getByRole('heading', { name: definition.title, exact: true })).toBeVisible();
            await expect(row.getByText(definition.description, { exact: true })).toBeVisible();
            await expect(row.getByText(`獲得称号: ${definition.rewardTitle}`, { exact: true })).toBeVisible();
            await expect(row.getByRole('progressbar', { name: definition.title, exact: true })).toBeVisible();
        }
        await expect(card.getByRole('progressbar', { name: '成長の第一歩', exact: true })).toHaveAttribute('aria-valuetext', '達成・330 / 30・獲得称号: 駆け出し冒険者');
        await card.evaluate((node) => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
        await page.screenshot({ path: testInfo.outputPath(`achievements-${theme}-overview.png`) });
        const originalLogs = await page.evaluate(() => localStorage.getItem('quest-board-stats'));
        await page.evaluate(() => {
            const target = window as unknown as { titleWrites: number }; target.titleWrites = 0;
            const original = Storage.prototype.setItem;
            Storage.prototype.setItem = function (key, value) {
                if (this === localStorage && key === 'quest-board-title') target.titleWrites++;
                return original.call(this, key, value);
            };
        });
        const writes = () => page.evaluate(() => (window as unknown as { titleWrites: number }).titleWrites);
        const title = card.getByRole('button', { name: '「駆け出し冒険者」を選択する', exact: true });
        await card.getByRole('button', { name: '称号なしを選択する', exact: true }).click();
        await expect(card.getByRole('status')).toHaveText('表示中: 称号なし');
        expect(await writes()).toBe(1);
        await card.getByRole('button', { name: '称号なしを選択する', exact: true }).click(); expect(await writes()).toBe(1);
        await title.focus(); await page.keyboard.press('Space'); await expect(title).toHaveAttribute('aria-pressed', 'true');
        await expect(card.getByRole('status')).toHaveText('表示中: 駆け出し冒険者');
        expect(await writes()).toBe(2); await title.click(); expect(await writes()).toBe(2);
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-title')!).state.activeTitle)).toBe('駆け出し冒険者');
        await page.getByRole('navigation').getByRole('button', { name: 'キャラ', exact: true }).click();
        await expect(page.getByText('駆け出し冒険者', { exact: true })).toBeVisible();
        await page.getByRole('navigation').getByRole('button', { name: '統計', exact: true }).click();
        await expect(card.getByRole('status')).toHaveText('表示中: 駆け出し冒険者');
        await card.getByRole('button', { name: '「習慣の芽」を選択する', exact: true }).click();
        await expect(card.getByRole('status')).toHaveText('表示中: 習慣の芽');
        expect(await writes()).toBe(3);
        await card.getByRole('group', { name: '表示する称号', exact: true }).evaluate((node) => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.screenshot({ path: testInfo.outputPath(`achievements-${theme}-selected.png`) });
        await card.getByRole('button', { name: '称号なしを選択する', exact: true }).click();
        await expect(card.getByRole('status')).toHaveText('表示中: 称号なし');
        expect(await writes()).toBe(4);
        await card.getByRole('button', { name: '称号なしを選択する', exact: true }).click(); expect(await writes()).toBe(4);
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-title')!).state.activeTitle)).toBeNull();
        expect(await page.evaluate(() => localStorage.getItem('quest-board-stats'))).toBe(originalLogs);
    });
    test('320px and 200% text: all unlocked / empty / long progress remain readable', async ({ page }, testInfo) => {
        await page.setViewportSize({ width: 320, height: 568 });
        await page.evaluate(async () => {
            document.documentElement.style.fontSize = '200%';
            const statsPath = '/src/stores/useStatsStore.ts'; const gamePath = '/src/stores/useGameStore.ts';
            const { useStatsStore } = await import(statsPath); const { useGameStore } = await import(gamePath);
            const game = useGameStore.getState();
            useStatsStore.setState({ taskXpLog: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`2026-08-0${i + 1}`, 10])), habitLog: Object.fromEntries(Array.from({ length: 3 }, (_, i) => [`2026-08-0${i + 1}`, { count: 1, allComplete: true }])) });
            useGameStore.setState({ character: { ...game.character, totalXp: 1_000_000_000_000 }, battle: { ...game.battle, maxClearedStage: 20 }, equipment: Array.from({ length: 10 }, (_, i) => ({ ...game.equipment[0], id: `achievement-test-${i}` })) });
        });
        const card = page.getByRole('region', { name: '実績と称号', exact: true });
        await expect(card.getByText('6/6 達成', { exact: true })).toBeVisible();
        await expect(card.getByText('達成 · 1,000,000,000,000/30', { exact: true })).toBeVisible();
        for (const definition of ACHIEVEMENTS) {
            const description = card.getByTestId(`achievement-${definition.id}`).getByText(definition.description, { exact: true });
            expect(await description.evaluate((node) => node.scrollWidth <= node.clientWidth && getComputedStyle(node).whiteSpace !== 'nowrap')).toBe(true);
        }
        for (const button of await card.getByRole('button').all()) {
            const bounds = await button.boundingBox(); expect(bounds!.height).toBeGreaterThanOrEqual(44); expect(bounds!.width).toBeGreaterThanOrEqual(44);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await card.getByText('達成 · 1,000,000,000,000/30', { exact: true }).evaluate((node) => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
        await page.screenshot({ path: testInfo.outputPath(`achievements-${theme}-large-text.png`) });
        await page.evaluate(async () => {
            const statsPath = '/src/stores/useStatsStore.ts'; const gamePath = '/src/stores/useGameStore.ts';
            const { useStatsStore } = await import(statsPath); const { useGameStore } = await import(gamePath);
            const game = useGameStore.getState();
            useStatsStore.setState({ taskXpLog: {}, habitLog: {} });
            useGameStore.setState({ character: { ...game.character, totalXp: 0 }, battle: { ...game.battle, maxClearedStage: 0 }, equipment: [] });
        });
        await expect(card.getByText('0/6 達成', { exact: true })).toBeVisible();
        await expect(card.getByText('実績を達成すると称号を選べます。', { exact: true })).toBeVisible();
        await expect(card.getByRole('button')).toHaveCount(0); await expect(card.getByRole('status')).toHaveText('表示中: 称号なし');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
});
