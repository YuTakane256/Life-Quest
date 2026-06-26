import { beforeEach, describe, expect, it } from 'vitest';
import { sanitizeActiveTitle, useTitleStore } from './useTitleStore';

function reset() {
    localStorage.clear();
    useTitleStore.setState({ activeTitle: null });
}

describe('useTitleStore', () => {
    beforeEach(() => reset());

    it('sanitizes empty, non-string, and long active titles', () => {
        expect(sanitizeActiveTitle(null)).toBeNull();
        expect(sanitizeActiveTitle('  ')).toBeNull();
        expect(sanitizeActiveTitle(123)).toBeNull();
        expect(sanitizeActiveTitle('  草原の挑戦者  ')).toBe('草原の挑戦者');
        expect(sanitizeActiveTitle('x'.repeat(80))).toHaveLength(40);
    });

    it('sets and clears the active title through the store action', () => {
        useTitleStore.getState().setActiveTitle('収集家');
        expect(useTitleStore.getState().activeTitle).toBe('収集家');

        useTitleStore.getState().setActiveTitle(null);
        expect(useTitleStore.getState().activeTitle).toBeNull();
    });

    it('persisted activeTitle を rehydrate 時にも検証する', async () => {
        localStorage.setItem('quest-board-title', JSON.stringify({ state: { activeTitle: '  草原の挑戦者  ' }, version: 1 }));

        await useTitleStore.persist.rehydrate();

        expect(useTitleStore.getState().activeTitle).toBe('草原の挑戦者');
    });

    it('persisted state が壊れていても action を維持する', async () => {
        localStorage.setItem('quest-board-title', JSON.stringify({ state: ['壊れた称号'], version: 1 }));

        await useTitleStore.persist.rehydrate();

        expect(useTitleStore.getState().activeTitle).toBeNull();
        expect(typeof useTitleStore.getState().setActiveTitle).toBe('function');
    });
});
