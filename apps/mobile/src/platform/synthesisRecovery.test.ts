import { afterEach, expect, it, vi } from 'vitest';
import { captureAuthSessionScope, notifyLogin, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { synthesisRecoveryKey } from '@life-quest/core/synthesisRecovery';

const { disk, write, stopOutbox, retireBattle } = vi.hoisted(() => ({
    disk: new Map<string, string>(),
    write: vi.fn<(key: string, value: string) => Promise<void>>(),
    stopOutbox: vi.fn(async () => {}),
    retireBattle: vi.fn(async () => {}),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: async (key: string) => disk.get(key) ?? null,
    setItem: write,
    removeItem: async (key: string) => { disk.delete(key); },
} }));
vi.mock('./battleResultRecovery', () => ({ battleResultRecovery: { retire: retireBattle } }));
vi.mock('./authStores', () => ({ clearMobileCloudStores: vi.fn(), resetCloudSessionSeeded: vi.fn() }));
vi.mock('./cloudOutbox', () => ({ stopMobileOutboxForAccountDeletion: stopOutbox }));
vi.mock('./cloudSync', () => ({ stopMobileCloudSyncForAccountDeletion: vi.fn() }));
vi.mock('../stores/useMobileLoginBonusStore', () => ({ useMobileLoginBonusStore: { getState: () => ({ clearPendingBonus: vi.fn() }) } }));
vi.mock('./cloudSessionRecovery', () => ({ releaseMobileCloudDisplayOwner: vi.fn() }));
import { synthesisRecovery } from './synthesisRecovery';
import { cleanupDeletedMobileAccount } from './accountDeletion';

afterEach(() => { resetAuthLifecycleHooks(); disk.clear(); write.mockReset(); });

it('deletes only the retired account journal even if auth changes while a write is still pending', async () => {
    const ownerKey = synthesisRecoveryKey('retiring-owner');
    const nextKey = synthesisRecoveryKey('other-owner');
    disk.set(nextKey, 'unrelated journal');
    await notifyLogin('retiring-owner');
    let resume!: () => void;
    const held = new Promise<void>((resolve) => { resume = resolve; });
    write.mockImplementationOnce(async (key, value) => { await held; disk.set(key, value); });
    const rejected = expect(synthesisRecovery.prepare('retiring-owner', ['one', 'two', 'three'], () => 'stable')).rejects.toThrow();
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const deleted = cleanupDeletedMobileAccount('retiring-owner', captureAuthSessionScope().isCurrent);
    await vi.waitFor(() => expect(retireBattle).toHaveBeenCalledWith('retiring-owner'));
    await notifyLogin('other-owner');
    resume();
    await rejected;
    await deleted;
    expect(disk.has(ownerKey)).toBe(false);
    expect(disk.get(nextKey)).toBe('unrelated journal');
    expect(stopOutbox).not.toHaveBeenCalled();
});
