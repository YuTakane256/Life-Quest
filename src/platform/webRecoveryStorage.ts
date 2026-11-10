import { getWebLocalStorage } from './storage';

function storage(): Storage {
    const available = getWebLocalStorage();
    if (!available) throw new Error('保存領域を利用できません。');
    return available;
}

export const webRecoveryStorage = {
    getItem: (key: string) => storage().getItem(key),
    setItem: (key: string, value: string) => storage().setItem(key, value),
    removeItem: (key: string) => storage().removeItem(key),
};

export const canLockWebRecovery = () => typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function';

// Keep the existing hashed retirement marker shared by both account-owned journals.
const retirementIndex = 'life-quest:battle-result-retirements:v1';
async function retirementKey(userId: string) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId));
    const hex = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${retirementIndex}:${hex}`;
}

export function withWebRecoveryLock<T>(userId: string, storageKey: string, work: () => Promise<T>) {
    if (!canLockWebRecovery()) return Promise.reject(new Error('安全な保存にはWeb Locks対応ブラウザーが必要です。'));
    return navigator.locks.request(storageKey, async () => {
        if (storage().getItem(retirementIndex) && storage().getItem(await retirementKey(userId))) {
            throw new Error('削除済みアカウントの操作は保存できません。');
        }
        return work();
    });
}

export async function retireWebRecoveryKey(userId: string, storageKey: string) {
    if (!canLockWebRecovery()) return;
    await navigator.locks.request(storageKey, async () => {
        const marker = await retirementKey(userId);
        const local = storage();
        local.removeItem(storageKey);
        local.setItem(retirementIndex, '1');
        local.setItem(marker, '1');
    });
}

/** Takes a non-blocking operation lock. Storage transactions use a separate name. */
export function tryAcquireWebRecoveryLock(name: string): Promise<(() => void) | null> {
    return new Promise((acquired) => {
        if (!canLockWebRecovery()) { acquired(null); return; }
        void navigator.locks.request(name, { ifAvailable: true }, (lock) => {
            if (!lock) { acquired(null); return; }
            return new Promise<void>((release) => { acquired(release); });
        }).catch(() => acquired(null));
    });
}
