import { useEffect } from 'react';

/**
 * モーダルが開いている間、`Escape` キーで `onClose` を呼ぶ。
 * a11y のための最小限のキーボード対応。
 */
export function useModalEscape(open: boolean, onClose: () => void): void {
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                onClose();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, onClose]);
}
