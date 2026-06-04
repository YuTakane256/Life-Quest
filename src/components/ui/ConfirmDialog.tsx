import type { ReactNode } from 'react';
import { useModalEscape } from '../../hooks/useModalEscape';

interface Props {
    open: boolean;
    title: string;
    message: ReactNode;
    confirmLabel: string;
    cancelLabel?: string;
    /** 確認ボタンの背景色。CSS 変数の指定を想定（例: `var(--color-accent-sky)`）。デフォルトは danger。 */
    confirmColor?: string;
    onConfirm: () => void;
    onClose: () => void;
}

export function ConfirmDialog({
    open,
    title,
    message,
    confirmLabel,
    cancelLabel = 'キャンセル',
    confirmColor = 'var(--color-text-danger)',
    onConfirm,
    onClose,
}: Props) {
    useModalEscape(open, onClose);

    if (!open) return null;

    const titleId = 'confirm-dialog-title';

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="w-full max-w-sm rounded-2xl p-5 animate-fade-in"
                style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
            >
                <h3 id={titleId} className="text-base font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>
                    {title}
                </h3>
                <p className="text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>
                    {message}
                </p>
                <div className="flex gap-2">
                    <button
                        onClick={onConfirm}
                        className="flex-1 py-2.5 rounded-lg text-sm font-medium"
                        style={{ backgroundColor: confirmColor, color: 'white' }}
                    >
                        {confirmLabel}
                    </button>
                    <button
                        onClick={onClose}
                        className="px-4 py-2.5 rounded-lg text-sm"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}
                    >
                        {cancelLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
