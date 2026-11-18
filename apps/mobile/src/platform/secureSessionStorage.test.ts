import { afterEach, expect, it, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';
import { getSecureSessionStorageState, retrySecureSessionStorage, secureStoreSessionAdapter, subscribeSecureSessionStorage } from './secureSessionStorage';

vi.mock('expo-secure-store', () => ({
    getItemAsync: vi.fn(),
    setItemAsync: vi.fn(),
    deleteItemAsync: vi.fn(),
}));

afterEach(() => { vi.resetAllMocks(); });

it('retains one failed read per key and resumes it only after an explicit retry', async () => {
    const states: string[] = [];
    const unsubscribe = subscribeSecureSessionStorage(() => states.push(getSecureSessionStorageState()));
    vi.mocked(SecureStore.getItemAsync).mockRejectedValue(new Error('private-session-detail'));
    let settled = false;
    const first = secureStoreSessionAdapter.getItem('sb:owner/token');
    const duplicate = secureStoreSessionAdapter.getItem('sb:owner/token');
    void first.then(() => { settled = true; });
    expect(duplicate).toBe(first);
    await vi.waitFor(() => expect(getSecureSessionStorageState()).toBe('blocked'));
    expect(SecureStore.getItemAsync).toHaveBeenCalledExactlyOnceWith('sb_owner_token');
    expect(settled).toBe(false);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();

    retrySecureSessionStorage();
    retrySecureSessionStorage();
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledTimes(2));
    expect(getSecureSessionStorageState()).toBe('blocked');
    expect(settled).toBe(false);
    expect(states).toEqual(['blocked', 'retrying', 'blocked']);

    vi.mocked(SecureStore.getItemAsync).mockResolvedValue('saved-session');
    retrySecureSessionStorage();
    expect(await first).toBe('saved-session');
    expect(getSecureSessionStorageState()).toBe('ready');
    expect(states).toEqual(['blocked', 'retrying', 'blocked', 'retrying', 'ready']);
    unsubscribe();
});

it('retries all interrupted keys and keeps failure visible until every read completes', async () => {
    vi.mocked(SecureStore.getItemAsync).mockRejectedValue(new Error('native-read-failed'));
    const first = secureStoreSessionAdapter.getItem('first-key');
    const second = secureStoreSessionAdapter.getItem('second-key');
    await vi.waitFor(() => expect(SecureStore.getItemAsync).toHaveBeenCalledTimes(2));
    let finishSecond!: (value: string | null) => void;
    const secondRead = new Promise<string | null>((resolve) => { finishSecond = resolve; });
    vi.mocked(SecureStore.getItemAsync).mockImplementation((key) => key === 'first-key' ? Promise.resolve(null) : secondRead);
    retrySecureSessionStorage();
    expect(await first).toBeNull();
    expect(getSecureSessionStorageState()).toBe('retrying');
    finishSecond('saved-second-session');
    expect(await second).toBe('saved-second-session');
    expect(getSecureSessionStorageState()).toBe('ready');
});

it('keeps the existing write/delete behavior and propagates write failures', async () => {
    vi.mocked(SecureStore.setItemAsync).mockRejectedValue(new Error('write-failed'));
    await expect(secureStoreSessionAdapter.setItem('sb:token', 'secret')).rejects.toThrow('write-failed');
    await secureStoreSessionAdapter.removeItem('sb:token');
    expect(SecureStore.setItemAsync).toHaveBeenCalledExactlyOnceWith('sb_token', 'secret');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledExactlyOnceWith('sb_token');
    expect(getSecureSessionStorageState()).toBe('ready');
});
