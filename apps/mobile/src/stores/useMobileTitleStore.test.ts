import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sanitizeActiveTitle, useMobileTitleStore } from './useMobileTitleStore';

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => undefined),
        removeItem: vi.fn(async () => undefined),
    },
}));

describe('useMobileTitleStore', () => {
    beforeEach(() => {
        useMobileTitleStore.setState({ activeTitle: null });
    });

    it('setActiveTitleで称号を設定できる', () => {
        useMobileTitleStore.getState().setActiveTitle('駆け出し冒険者');
        expect(useMobileTitleStore.getState().activeTitle).toBe('駆け出し冒険者');
    });

    it('nullを設定すると称号なしになる', () => {
        useMobileTitleStore.getState().setActiveTitle('駆け出し冒険者');
        useMobileTitleStore.getState().setActiveTitle(null);
        expect(useMobileTitleStore.getState().activeTitle).toBeNull();
    });

    it('空文字はnullとして扱われる', () => {
        useMobileTitleStore.getState().setActiveTitle('   ');
        expect(useMobileTitleStore.getState().activeTitle).toBeNull();
    });
});

describe('sanitizeActiveTitle', () => {
    it('40文字を超える値は切り詰められる', () => {
        const long = 'あ'.repeat(50);
        expect(sanitizeActiveTitle(long)).toBe('あ'.repeat(40));
    });

    it('文字列以外はnullを返す', () => {
        expect(sanitizeActiveTitle(123)).toBeNull();
        expect(sanitizeActiveTitle(undefined)).toBeNull();
    });
});
