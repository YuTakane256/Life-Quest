import * as SecureStore from 'expo-secure-store';

export type SecureSessionStorageState = 'ready' | 'blocked' | 'retrying';

const reads = new Map<string, Promise<string | null>>();
const interrupted = new Set<string>();
const retryWaiters = new Map<string, () => void>();
const listeners = new Set<() => void>();
let state: SecureSessionStorageState = 'ready';

export const getSecureSessionStorageState = (): SecureSessionStorageState => state;
export function subscribeSecureSessionStorage(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

function publish(): void {
    const next = retryWaiters.size > 0 ? 'blocked' : interrupted.size > 0 ? 'retrying' : 'ready';
    if (state === next) return;
    state = next;
    for (const listener of [...listeners]) listener();
}

export function retrySecureSessionStorage(): void {
    const waiters = [...retryWaiters.values()];
    retryWaiters.clear();
    publish();
    waiters.forEach((resume) => resume());
}

// Keep the existing SDK storage keys; SecureStore permits only letters, digits and "._-".
function storageKey(key: string): string {
    return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

function readSession(key: string): Promise<string | null> {
    const existing = reads.get(key);
    if (existing) return existing;
    const work = (async () => {
        for (;;) {
            try {
                return await SecureStore.getItemAsync(key);
            } catch {
                // Returning null here would turn a temporarily unreadable session into a logout.
                // Keep the SDK request pending so its normal startup/recovery listeners resume.
                interrupted.add(key);
                await new Promise<void>((resume) => {
                    retryWaiters.set(key, resume);
                    publish();
                });
            }
        }
    })().finally(() => {
        reads.delete(key);
        interrupted.delete(key);
        publish();
    });
    reads.set(key, work);
    return work;
}

/** A failed read is retried explicitly; it never becomes a missing session. */
export const secureStoreSessionAdapter = {
    getItem: (key: string) => readSession(storageKey(key)),
    setItem: (key: string, value: string) => SecureStore.setItemAsync(storageKey(key), value),
    removeItem: (key: string) => SecureStore.deleteItemAsync(storageKey(key)),
};
