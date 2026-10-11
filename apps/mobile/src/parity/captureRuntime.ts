import { createMobileParityStorage, PARITY_FIXED_NOW, type ParityTheme } from '@life-quest/core/parityFixture';

export interface CaptureContext {
    development: boolean;
    variant: unknown;
    applicationId: string | null;
    theme: unknown;
    supabaseUrl: string | undefined;
    supabaseKey: string | undefined;
}

/** Fail closed: neither preview/release nor a configured account can load fixtures. */
export function getCaptureTheme(context: CaptureContext): ParityTheme | null {
    if (context.theme === undefined || context.theme === '') return null;
    if (!context.development || context.variant !== 'parity'
        || context.applicationId !== 'com.yutakane.lifequest.parity'
        || context.supabaseUrl || context.supabaseKey
        || (context.theme !== 'light' && context.theme !== 'dark')) {
        throw new Error('Reference capture requires the anonymous parity development app with no Supabase configuration.');
    }
    return context.theme;
}

export interface CaptureStorage {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
    getMany(keys: string[]): Promise<Record<string, string | null>>;
    setMany(entries: Record<string, string>): Promise<void>;
    removeMany(keys: string[]): Promise<void>;
    getAllKeys(): Promise<string[]>;
    clear(): Promise<void>;
}

/**
 * Intercept the shared AsyncStorage singleton BEFORE the router imports stores.
 * All capture writes stay in memory. Even clear() never touches the real DB.
 * SecureStore is not changed, and cloud configuration is forbidden by the guard.
 */
export function installCaptureRuntime(storage: CaptureStorage, theme: ParityTheme): () => void {
    const values = new Map(Object.entries(createMobileParityStorage(theme)));
    const overrides: CaptureStorage = {
        getItem: async (key) => values.get(key) ?? null,
        setItem: async (key, value) => { values.set(key, value); },
        removeItem: async (key) => { values.delete(key); },
        getMany: async (keys) => Object.fromEntries(keys.map((key) => [key, values.get(key) ?? null])),
        setMany: async (entries) => { for (const [key, value] of Object.entries(entries)) values.set(key, value); },
        removeMany: async (keys) => { for (const key of keys) values.delete(key); },
        getAllKeys: async () => [...values.keys()],
        clear: async () => { values.clear(); },
    };
    const originals = Object.fromEntries(Object.keys(overrides).map((key) => [key, storage[key as keyof CaptureStorage]]));
    Object.assign(storage, overrides);

    // Freeze the wall clock only: timers/performance/animation scheduling still run.
    const NativeDate = globalThis.Date;
    const now = NativeDate.parse(PARITY_FIXED_NOW);
    globalThis.Date = new Proxy(NativeDate, {
        apply: () => new NativeDate(now).toString(),
        construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [now], newTarget),
        get: (target, key) => key === 'now' ? () => now : Reflect.get(target, key),
    });
    return () => {
        Object.assign(storage, originals);
        globalThis.Date = NativeDate;
    };
}
