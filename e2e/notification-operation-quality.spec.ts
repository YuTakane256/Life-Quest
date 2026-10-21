import { expect, test } from '@playwright/test';
import { createWebParityStorage, PARITY_FIXED_NOW } from '@life-quest/core/parityFixture';
for (const theme of ['light', 'dark'] as const) test.describe(theme, () => {
    test.beforeEach(async ({ page }, testInfo) => {
        if (testInfo.project.name === 'mobile-chromium') await page.setViewportSize({ width: 402, height: 874 });
        await page.emulateMedia({ colorScheme: theme }); await page.clock.install({ time: new Date(PARITY_FIXED_NOW) });
        await page.addInitScript((storage) => {
            if (!sessionStorage.getItem('notification-fixture')) {
                localStorage.clear(); sessionStorage.setItem('notification-fixture', 'true');
                for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
            }
            const scope = window as unknown as { fixtureGrant: () => void; fixtureNotifications: unknown[] };
            scope.fixtureNotifications = [];
            // Browser permission UI and delivery are test doubles, never the real OS.
            class FixtureNotification {
                static permission = 'default';
                static requestPermission() { return new Promise<string>((resolve) => { scope.fixtureGrant = () => { FixtureNotification.permission = 'granted'; resolve('granted'); }; }); }
                constructor(...args: unknown[]) { scope.fixtureNotifications.push(args); }
            }
            Object.defineProperty(window, 'Notification', { configurable: true, value: FixtureNotification });
        }, createWebParityStorage(theme));
        await page.goto('/settings');
    });
    test('OFF during permission request survives a late grant and reload', async ({ page }, testInfo) => {
        const toggle = page.getByRole('switch', { name: '通知のON/OFF', exact: true }); await toggle.click();
        await expect(toggle).toHaveAttribute('aria-busy', 'true'); await expect(toggle).toHaveAttribute('aria-checked', 'true');
        await page.screenshot({ path: testInfo.outputPath(`notification-${theme}-pending.png`) });
        await toggle.click(); await page.evaluate(() => (window as unknown as { fixtureGrant: () => void }).fixtureGrant());
        await expect(toggle).toHaveAttribute('aria-checked', 'false'); await expect(toggle).toHaveAttribute('aria-busy', 'false');
        await page.screenshot({ path: testInfo.outputPath(`notification-${theme}-off.png`) });
        await page.reload(); await expect(toggle).toHaveAttribute('aria-checked', 'false');
        expect(await page.evaluate(() => (window as unknown as { fixtureNotifications: unknown[] }).fixtureNotifications)).toEqual([]);
    });
    test('normal enable, hour selection and disable persist', async ({ page }) => {
        const toggle = page.getByRole('switch', { name: '通知のON/OFF', exact: true }); await toggle.click();
        await page.evaluate(() => (window as unknown as { fixtureGrant: () => void }).fixtureGrant()); await expect(toggle).toHaveAttribute('aria-busy', 'false');
        await page.getByLabel('習慣リマインダー時刻', { exact: true }).selectOption('22');
        await toggle.click(); await expect(toggle).toHaveAttribute('aria-checked', 'false'); await page.reload();
        const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('quest-board-notifications')!).state);
        expect(settings).toMatchObject({ enabled: false, habitReminderHour: 22 });
    });
});
