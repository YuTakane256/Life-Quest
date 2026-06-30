import { beforeEach, describe, expect, it } from 'vitest';
import {
    createWebLocalStorageAdapter,
    createWebPersistStorage,
    getPlatformStorageAdapter,
    getWebLocalStorage,
} from './storage';
import {
    createUnavailableStorageAdapter,
    createWebStorageAdapter,
    createZustandStateStorage,
    type PlatformStorageAdapter,
} from './storageAdapter';

describe('Web storage platform adapter', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('returns the browser localStorage implementation when available', () => {
        expect(getWebLocalStorage()).toBe(localStorage);
    });

    it('wraps browser localStorage behind a platform adapter', () => {
        const adapter = createWebLocalStorageAdapter();

        adapter.setItem('quest-board-adapter-test', 'hello');

        expect(adapter.getItem('quest-board-adapter-test')).toBe('hello');
        expect(localStorage.getItem('quest-board-adapter-test')).toBe('hello');

        adapter.removeItem('quest-board-adapter-test');
        expect(adapter.getItem('quest-board-adapter-test')).toBeNull();
    });

    it('returns a no-op adapter when storage is unavailable', () => {
        const adapter = createUnavailableStorageAdapter();

        expect(adapter.getItem('missing')).toBeNull();
        expect(adapter.setItem('key', 'value')).toBeUndefined();
        expect(adapter.removeItem('key')).toBeUndefined();
    });

    it('exposes the current platform storage adapter', () => {
        const adapter = getPlatformStorageAdapter();

        adapter.setItem('quest-board-platform-test', 'ok');

        expect(adapter.getItem('quest-board-platform-test')).toBe('ok');
    });

    it('creates a Zustand StateStorage from async-compatible adapters', async () => {
        const values = new Map<string, string>();
        const adapter: PlatformStorageAdapter = {
            getItem: async (key) => values.get(key) ?? null,
            setItem: async (key, value) => {
                values.set(key, value);
            },
            removeItem: async (key) => {
                values.delete(key);
            },
        };
        const stateStorage = createZustandStateStorage(adapter);

        await stateStorage.setItem('async-key', 'async-value');

        await expect(stateStorage.getItem('async-key')).resolves.toBe('async-value');

        await stateStorage.removeItem('async-key');
        await expect(stateStorage.getItem('async-key')).resolves.toBeNull();
    });

    it('creates a platform adapter from any Storage-compatible implementation', () => {
        const storage = new Map<string, string>();
        const adapter = createWebStorageAdapter({
            getItem: (key) => storage.get(key) ?? null,
            setItem: (key, value) => {
                storage.set(key, value);
            },
            removeItem: (key) => {
                storage.delete(key);
            },
        } as Storage);

        adapter.setItem('custom-key', 'custom-value');

        expect(adapter.getItem('custom-key')).toBe('custom-value');
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
