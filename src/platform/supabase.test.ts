import { describe, expect, it } from 'vitest';
import { webSessionStorageAdapter } from './supabase';

describe('web Supabase session storage', () => {
    it('never persists OAuth provider tokens while retaining the normal session', () => {
        webSessionStorageAdapter.setItem('session', JSON.stringify({
            access_token: 'access', refresh_token: 'refresh', provider_token: 'provider', provider_refresh_token: 'provider-refresh',
        }));
        expect(JSON.parse(localStorage.getItem('session')!)).toEqual({ access_token: 'access', refresh_token: 'refresh' });
    });
});
