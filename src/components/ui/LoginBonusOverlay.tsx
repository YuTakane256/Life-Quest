import { useCallback, useEffect, useState } from 'react';
import { Gift, Flame, X } from 'lucide-react';
import { useLoginBonusStore } from '../../stores/useLoginBonusStore';
import { useModalEscape } from '../../hooks/useModalEscape';

export function LoginBonusOverlay() {
    const pendingBonus = useLoginBonusStore((s) => s.pendingBonus);
    const clearPendingBonus = useLoginBonusStore((s) => s.clearPendingBonus);
    const [visible, setVisible] = useState(false);

    const handleDismiss = useCallback(() => {
        setVisible(false);
        window.setTimeout(clearPendingBonus, 300);
    }, [clearPendingBonus]);

    useModalEscape(Boolean(pendingBonus && visible), handleDismiss);

    useEffect(() => {
        if (pendingBonus) setVisible(true);
    }, [pendingBonus]);

    if (!pendingBonus || !visible) return null;

    const titleId = 'login-bonus-overlay-title';

    return (
        <div
            className="fixed inset-0 z-[290] flex items-center justify-center animate-levelup-overlay"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
            onClick={handleDismiss}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="relative px-8 py-10 rounded-3xl mx-4 max-w-sm w-full text-center"
                style={{
                    backgroundColor: 'var(--color-bg-card)',
                    border: '2px solid var(--color-accent-gold)',
                    boxShadow: '0 0 60px rgba(245, 158, 11, 0.4)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    onClick={handleDismiss}
                    className="absolute top-3 right-3 p-1.5 rounded-lg opacity-60 hover:opacity-100 transition-opacity"
                    style={{ color: 'var(--color-text-muted)' }}
                    aria-label="閉じる"
                >
                    <X size={18} />
                </button>

                <div className="flex justify-center mb-3">
                    <Gift size={40} style={{ color: 'var(--color-accent-gold)' }} />
                </div>

                <h2
                    id={titleId}
                    className="text-3xl font-black mb-2"
                    style={{ color: 'var(--color-accent-gold)', letterSpacing: '0.04em' }}
                >
                    ログインボーナス
                </h2>

                <div
                    className="flex items-center justify-center gap-1.5 text-base mb-5"
                    style={{ color: 'var(--color-text-secondary)' }}
                >
                    <Flame size={18} style={{ color: 'var(--color-priority-high)' }} />
                    <span>
                        連続ログイン
                        <span className="mx-1 font-bold" style={{ color: 'var(--color-accent-gold)' }}>
                            {pendingBonus.streak}
                        </span>
                        日目
                    </span>
                </div>

                <div className="flex flex-col gap-2">
                    <div
                        className="flex items-center justify-between px-4 py-2.5 rounded-xl"
                        style={{ backgroundColor: 'var(--color-bg-secondary)' }}
                    >
                        <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                            ⭐ 経験値
                        </span>
                        <span
                            className="text-base font-bold"
                            style={{ color: 'var(--color-accent-emerald)' }}
                        >
                            +{pendingBonus.xp} XP
                        </span>
                    </div>

                    {pendingBonus.chestLabel && (
                        <div
                            className="flex items-center justify-between px-4 py-2.5 rounded-xl"
                            style={{ backgroundColor: 'var(--color-bg-secondary)' }}
                        >
                            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                                🎁 特別報酬
                            </span>
                            <span
                                className="text-sm font-bold text-right"
                                style={{ color: 'var(--color-accent-gold)' }}
                            >
                                {pendingBonus.chestLabel}
                            </span>
                        </div>
                    )}
                </div>

                <p className="mt-5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    タップして閉じる
                </p>
            </div>
        </div>
    );
}
