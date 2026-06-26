import { useEffect } from 'react';

export function shouldHandleModalEscape(event: KeyboardEvent): boolean {
    return event.key === 'Escape' && !event.defaultPrevented && !event.isComposing;
}

/**
 * モーダルが開いているとき Escape キーで閉じる共通フック。
 * @param open  モーダルが開いているか
 * @param onClose  閉じるコールバック
 */
export function useModalEscape(open: boolean, onClose: () => void): void {
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (shouldHandleModalEscape(e)) onClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, onClose]);
}
