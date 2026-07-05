import { afterEach, describe, expect, it } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { getActiveWebCloudSync, registerWebCloudSyncHooks } from './cloudSync';

describe('registerWebCloudSyncHooks', () => {
    afterEach(() => {
        resetAuthLifecycleHooks();
    });

    it('Supabase環境が未設定ならログイン通知でも同期を開始せず、例外も投げない', async () => {
        const unregister = registerWebCloudSyncHooks();
        await expect(notifyLogin('user-1')).resolves.toBeUndefined();
        expect(getActiveWebCloudSync()).toBeNull();
        await expect(notifyLogout()).resolves.toBeUndefined();
        unregister();
    });

    it('解除後はログイン通知に反応しない', async () => {
        const unregister = registerWebCloudSyncHooks();
        unregister();
        await notifyLogin('user-1');
        expect(getActiveWebCloudSync()).toBeNull();
    });
});
