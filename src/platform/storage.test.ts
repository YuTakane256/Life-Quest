import { beforeEach, describe, expect, it } from 'vitest';
import { createWebPersistStorage, getWebLocalStorage } from './storage';

describe('Web storage platform adapter', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('returns the browser localStorage implementation when available', () => {
        expect(getWebLocalStorage()).toBe(localStorage);
    });

    it('creates Zustand-compatible JSON persist storage', () => {
        const storage = createWebPersistStorage<{ count: number }>();

        expect(storage).toBeDefined();
        storage?.setItem('quest-board-test', { state: { count: 3 }, version: 1 });

        expect(JSON.parse(localStorage.getItem('quest-board-test') || '{}')).toEqual({
            state: { count: 3 },
            version: 1,
        });
        expect(storage?.getItem('quest-board-test')).toEqual({
            state: { count: 3 },
            version: 1,
        });
    });
});
