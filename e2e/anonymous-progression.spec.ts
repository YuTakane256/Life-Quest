import { expect, test, type Page } from '@playwright/test';
import { dismissStartupDialogs } from './helpers';

async function startAnonymous(page: Page) {
    await page.clock.install({ time: new Date('2026-10-14T03:00:00Z') });
    await page.goto('/settings');
    await dismissStartupDialogs(page);
    await expect(page.getByText('クラウド接続は未設定です。これまでどおり端末内のみで動作します。', { exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: 'メインナビゲーション' }).getByRole('button', { name: 'タスク', exact: true }).click();
}

test('earns a starter chest through UI and retains victory progress on map return and reload', async ({ page }) => {
    test.setTimeout(60_000);
    // No pre-earned rewards/fixture injection: a fresh isolated browser context.
    await page.clock.install({ time: new Date('2026-10-14T03:00:00Z') });
    await page.goto('/settings');
    await dismissStartupDialogs(page);
    // Fail before creating data if a reused/local server has cloud config.
    await expect(page.getByText('クラウド接続は未設定です。これまでどおり端末内のみで動作します。', { exact: true })).toBeVisible();
    const navigation = page.getByRole('navigation', { name: 'メインナビゲーション' });
    await navigation.getByRole('button', { name: /^タスク/ }).click();
    const map = navigation.getByRole('button', { name: /^マップ/ });
    await expect(map).toBeDisabled();
    await page.getByRole('button', { name: 'キャラ', exact: true }).click();
    const xp = page.getByRole('progressbar', { name: 'あなた の経験値' });
    const initialXp = Number((await xp.getAttribute('aria-valuetext'))?.split(' / ')[0]);
    expect(Number.isFinite(initialXp)).toBe(true);
    await navigation.getByRole('button', { name: /^タスク/ }).click();

    for (let index = 1; index <= 5; index++) {
        const name = `Progression ${index}`;
        await page.getByRole('button', { name: '新しいタスクを追加' }).click();
        await page.getByPlaceholder('タスク名を入力...').fill(name);
        await page.getByRole('button', { name: '追加', exact: true }).click();
        await page.getByRole('button', { name: `タスク「${name}」を完了にする` }).click();
        // Commit the undo window, then allow the level-up overlay to settle.
        await page.clock.runFor(11_000);
    }
    await page.getByRole('button', { name: 'キャラ', exact: true }).click();
    const earned = await xp.getAttribute('aria-valuetext');
    expect(Number(earned?.split(' / ')[0])).toBe(initialXp + 100);
    const persistedGame = () => page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-game')!).state);
    expect((await persistedGame()).gachaCount).toBe(5);
    await expect(map).toBeDisabled();
    await page.getByRole('button', { name: /青色の宝箱/ }).click();
    await page.getByText('タップして開ける', { exact: true }).click();
    await page.clock.runFor(3_000);
    await expect(page.getByRole('dialog', { name: 'キャラクター解放！' })).toBeVisible();
    await page.getByRole('button', { name: 'バトルへ', exact: true }).click();
    await page.clock.runFor(500);
    await expect(page.getByText('最高到達: ステージ -', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'スタート', exact: true }).click();
    await page.clock.runFor(8_000);
    await expect(page.getByText('勝利！', { exact: true })).toBeVisible();
    await expect(page.getByText('5 XP を獲得！', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'マップへ', exact: true }).click();
    await expect(page.getByText('最高到達: ステージ 1', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'キャラ', exact: true }).click();
    const victoryXp = await xp.getAttribute('aria-valuetext');
    expect(Number(victoryXp?.split(' / ')[0])).toBe(initialXp + 105);

    // The paid task can be undone/re-completed, but is not a new reward source.
    for (const restart of [false, true]) {
        if (restart) await page.reload();
        await expect(xp).toHaveAttribute('aria-valuetext', victoryXp!);
        await navigation.getByRole('button', { name: 'タスク', exact: true }).click();
        await page.getByText('完了タスク (5)', { exact: true }).click();
        await page.getByRole('button', { name: 'タスク「Progression 5」を未完了にする' }).click();
        await page.getByRole('button', { name: 'タスク「Progression 5」を完了にする' }).click();
        await page.clock.runFor(6_000);
        await page.getByRole('button', { name: 'キャラ', exact: true }).click();
        await expect(xp).toHaveAttribute('aria-valuetext', victoryXp!);
        expect((await persistedGame()).completionRewardKeys).toHaveLength(5);
    }
    await page.reload();
    await expect(page.getByRole('dialog', { name: 'ログインボーナス' })).toHaveCount(0);
    await expect(xp).toHaveAttribute('aria-valuetext', victoryXp!);
    await expect(map).toBeEnabled();
    const game = await persistedGame();
    expect(game.gachaCount).toBe(5);
    expect(game.chestQueue).toHaveLength(1);
    expect(game.chestQueue[0]).toMatchObject({ opened: true, isStarterCharacter: true });
    expect(game.battle).toMatchObject({ battleUnlocked: true, maxClearedStage: 1 });
    await map.click();
    await expect(page.getByText('最高到達: ステージ 1', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'スタート', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '再挑戦', exact: true })).toBeVisible();
});

test('two real tabs completing the same task share one durable reward', async ({ page, context }) => {
    test.setTimeout(60_000);
    await startAnonymous(page);
    await page.getByRole('button', { name: '新しいタスクを追加' }).click();
    await page.getByPlaceholder('タスク名を入力...').fill('Shared reward');
    await page.getByRole('button', { name: '追加', exact: true }).click();
    const other = await context.newPage();
    await startAnonymous(other);
    const done = (tab: Page) => tab.getByRole('button', { name: 'タスク「Shared reward」を完了にする' });
    await expect(done(other)).toBeVisible();
    await Promise.all([done(page).click(), done(other).click()]);
    await Promise.all([page.clock.runFor(11_000), other.clock.runFor(11_000)]);
    const readGame = () => page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-game')!).state);
    await expect.poll(async () => (await readGame()).completionRewardKeys.length).toBe(1);
    expect(await readGame()).toMatchObject({ gachaCount: 1, character: { totalXp: 40 } });
    for (const tab of [page, other]) {
        await tab.getByRole('button', { name: 'キャラ', exact: true }).click();
        await expect(tab.getByRole('progressbar', { name: 'あなた の経験値' })).toHaveAttribute('aria-valuetext', '40 / 80');
    }
    await other.close();
    await page.reload();
    await expect(page.getByRole('progressbar', { name: 'あなた の経験値' })).toHaveAttribute('aria-valuetext', '40 / 80');
});

for (const theme of ['light', 'dark'] as const) {
    test(`missing lock support shows a ${theme} error instead of an unprotected reward`, async ({ page }, testInfo) => {
        await page.emulateMedia({ colorScheme: theme });
        await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
        await startAnonymous(page);
        await page.getByRole('button', { name: '新しいタスクを追加' }).click();
        await page.getByPlaceholder('タスク名を入力...').fill('Unsupported lock');
        await page.getByRole('button', { name: '追加', exact: true }).click();
        await page.getByRole('button', { name: 'タスク「Unsupported lock」を完了にする' }).click();
        await page.clock.runFor(6_000);
        const notice = page.getByRole('alert').filter({ hasText: 'Web Locks' });
        await expect(notice).toBeVisible();
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-game')!).state);
        expect(saved).toMatchObject({ gachaCount: 0, completionRewardKeys: [], character: { totalXp: 20 } });
        await page.screenshot({ path: `docs/screenshots/anonymous-rewards/${testInfo.project.name}-${theme}-error.png` });
        await page.getByRole('button', { name: '報酬保存エラーを閉じる' }).click();
        await expect(notice).toHaveCount(0);
    });
}
