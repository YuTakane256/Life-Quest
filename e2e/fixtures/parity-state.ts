import { expect, type Page } from '@playwright/test';
import { createWebParityStorage, PARITY_FIXED_NOW, type ParityTheme } from '@life-quest/core/parityFixture';

export const taskParitySnapshotName = 'task-page-dark.png';

/** The existing 390px regression defaults to dark; paired references select either theme. */
export async function installWebParityState(page: Page, theme: ParityTheme = 'dark', battleProgress?: {
    currentStage: number;
    maxClearedStage: number;
    battleUnlocked?: boolean;
}): Promise<void> {
    const storage = createWebParityStorage(theme);
    if (battleProgress) {
        // Isolated Playwright browser only; never writes a running user's store.
        const game = JSON.parse(storage['quest-board-game']);
        Object.assign(game.state.battle, battleProgress);
        storage['quest-board-game'] = JSON.stringify(game);
    }
    await page.clock.install({ time: new Date(PARITY_FIXED_NOW) });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.addInitScript((storage) => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
        class ParityNotification {
            static permission: NotificationPermission = 'default';
            static requestPermission = async (): Promise<NotificationPermission> => 'default';
        }
        Object.defineProperty(window, 'Notification', { configurable: true, value: ParityNotification });
        Math.random = () => 0.123456789;
    }, storage);
}

export async function waitForWebParityRender(page: Page): Promise<void> {
    await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(Array.from(document.images).map((image) => {
            if (image.complete) return Promise.resolve();
            return new Promise<void>((resolve) => {
                image.addEventListener('load', () => resolve(), { once: true });
                image.addEventListener('error', () => resolve(), { once: true });
            });
        }));
        window.scrollTo(0, 0);
    });
    await expect(page.locator('body')).toBeVisible();
}
