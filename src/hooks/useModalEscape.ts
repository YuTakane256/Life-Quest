import { useEffect } from 'react';

/**
 * モーダルが開いているとき Escape キーで閉じる共通フック。
 * @param open  モーダルが開いているか
 * @param onClose  閉じるコールバック
 */
export function useModalEscape(open: boolean, onClose: () => void): void {
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, onClose]);
}
