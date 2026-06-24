import { describe, expect, it } from 'vitest';
import { createSafePersistMerge, isPersistedStateRecord, readPersistedStateRecord } from './persistMerge';

describe('persistMerge', () => {
    it('plain object の persisted state だけを読み取り対象にする', () => {
        expect(isPersistedStateRecord({ mode: 'dark' })).toBe(true);
        expect(isPersistedStateRecord(null)).toBe(false);
        expect(isPersistedStateRecord(['dark'])).toBe(false);
        expect(isPersistedStateRecord('dark')).toBe(false);
    });

    it('非オブジェクトの persisted state は空オブジェクトとして扱う', () => {
        expect(readPersistedStateRecord({ mode: 'dark' })).toEqual({ mode: 'dark' });
        expect(readPersistedStateRecord(['dark'])).toEqual({});
        expect(readPersistedStateRecord(null)).toEqual({});
    });

    it('sanitizer の戻り値だけを current state に重ねる', () => {
        const setMode = () => undefined;
        const merge = createSafePersistMerge<{ mode: string; setMode: () => void }>((persisted) => ({
            mode: persisted.mode === 'dark' ? 'dark' : 'system',
        }));

        const merged = merge({ mode: 'dark', setMode: null }, { mode: 'system', setMode });

        expect(merged).toEqual({ mode: 'dark', setMode });
    });

    it('壊れた persisted state でも current のアクションを落とさない', () => {
        const setMode = () => undefined;
        const merge = createSafePersistMerge<{ mode: string; setMode: () => void }>((persisted) => ({
            mode: persisted.mode === 'dark' ? 'dark' : 'system',
        }));

        const merged = merge('corrupted', { mode: 'dark', setMode });

        expect(merged).toEqual({ mode: 'system', setMode });
    });

    it('sanitizer が例外を投げても current state を維持する', () => {
        const setMode = () => undefined;
        const current = { mode: 'dark', setMode };
        const merge = createSafePersistMerge<typeof current>(() => {
            throw new Error('broken sanitizer');
        });

        expect(merge({ mode: 'light' }, current)).toBe(current);
    });
});
