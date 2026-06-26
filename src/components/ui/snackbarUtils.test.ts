import { describe, expect, it, vi } from 'vitest';
import {
    MAX_SNACKBAR_MESSAGE_LENGTH,
    MAX_SNACKBARS,
    appendSnackbar,
    clampSnackbarMessage,
    type SnackbarItem,
} from './snackbarUtils';

function makeSnackbar(id: string, message = id): SnackbarItem {
    return {
        id,
        message,
        onUndo: vi.fn(),
        expiresAt: 1000,
    };
}

describe('snackbarUtils', () => {
    it('keeps short snackbar messages unchanged', () => {
        expect(clampSnackbarMessage('保存しました')).toBe('保存しました');
    });

    it('truncates oversized snackbar messages', () => {
        const message = 'a'.repeat(MAX_SNACKBAR_MESSAGE_LENGTH + 10);

        expect(clampSnackbarMessage(message)).toHaveLength(MAX_SNACKBAR_MESSAGE_LENGTH);
        expect(clampSnackbarMessage(message).endsWith('...')).toBe(true);
    });

    it('caps the snackbar queue and reports removed ids', () => {
        const current = [
            makeSnackbar('snack-1'),
            makeSnackbar('snack-2'),
            makeSnackbar('snack-3'),
        ];

        const result = appendSnackbar(current, makeSnackbar('snack-4'));

        expect(result.next).toHaveLength(MAX_SNACKBARS);
        expect(result.next.map((snackbar) => snackbar.id)).toEqual(['snack-2', 'snack-3', 'snack-4']);
        expect(result.removedIds).toEqual(['snack-1']);
    });

    it('preserves undo callbacks for kept snackbars', () => {
        const undo = vi.fn();
        const result = appendSnackbar([], {
            id: 'snack-1',
            message: '戻せます',
            onUndo: undo,
            expiresAt: 1000,
        });

        result.next[0].onUndo?.();

        expect(undo).toHaveBeenCalledTimes(1);
    });
});
