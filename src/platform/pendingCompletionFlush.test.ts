import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPendingCompletionFlush } from './pendingCompletionFlush';
import { useTaskStore } from '../stores/useTaskStore';

describe('registerPendingCompletionFlush', () => {
    let flushSpy: ReturnType<typeof vi.spyOn>;
    let unregister: (() => void) | undefined;

    beforeEach(() => {
        flushSpy = vi.spyOn(useTaskStore.getState(), 'flushPendingCompletions').mockImplementation(() => undefined);
    });

    afterEach(() => {
        unregister?.();
        unregister = undefined;
        vi.restoreAllMocks();
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    });

    it('visibilitychangeでhiddenになるとflushPendingCompletionsを呼ぶ', () => {
        unregister = registerPendingCompletionFlush();

        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));

        expect(flushSpy).toHaveBeenCalledTimes(1);
    });

    it('visibleのままのvisibilitychangeでは呼ばない', () => {
        unregister = registerPendingCompletionFlush();

        document.dispatchEvent(new Event('visibilitychange'));

        expect(flushSpy).not.toHaveBeenCalled();
    });

    it('pagehideでflushPendingCompletionsを呼ぶ', () => {
        unregister = registerPendingCompletionFlush();

        window.dispatchEvent(new Event('pagehide'));

        expect(flushSpy).toHaveBeenCalledTimes(1);
    });

    it('解除後はイベントに反応しない', () => {
        unregister = registerPendingCompletionFlush();
        unregister();
        unregister = undefined;

        window.dispatchEvent(new Event('pagehide'));
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));

        expect(flushSpy).not.toHaveBeenCalled();
    });
});
