import { beforeEach, describe, expect, it } from 'vitest';
import { sanitizeMotionMode, useMotionStore } from './useMotionStore';

function reset() {
    localStorage.clear();
    useMotionStore.setState({ mode: 'system' });
}

describe('useMotionStore', () => {
    beforeEach(() => reset());

    it('有効な motion mode だけを通し、不正値は system にする', () => {
        expect(sanitizeMotionMode('system')).toBe('system');
        expect(sanitizeMotionMode('standard')).toBe('standard');
        expect(sanitizeMotionMode('reduced')).toBe('reduced');
        expect(sanitizeMotionMode('off')).toBe('system');
        expect(sanitizeMotionMode(null)).toBe('system');
    });

    it('setMode 経由でも不正値を system に戻す', () => {
        useMotionStore.getState().setMode('reduced');
        expect(useMotionStore.getState().mode).toBe('reduced');

        useMotionStore.getState().setMode('off' as never);
        expect(useMotionStore.getState().mode).toBe('system');
    });

    it('persisted state が壊れていても action を維持する', async () => {
        localStorage.setItem('quest-board-motion', JSON.stringify({ state: null, version: 1 }));

        await useMotionStore.persist.rehydrate();

        expect(useMotionStore.getState().mode).toBe('system');
        expect(typeof useMotionStore.getState().setMode).toBe('function');
    });
});
