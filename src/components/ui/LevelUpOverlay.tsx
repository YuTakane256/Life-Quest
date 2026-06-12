import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { useGameStore } from '../../stores/useGameStore';
import { useModalEscape } from '../../hooks/useModalEscape';

const SPARKLE_COUNT = 28;
const SPARKLE_EMOJIS = ['✨', '⭐', '🌟', '💫', '⚡'];

interface Sparkle {
    id: number;
    emoji: string;
    left: number;
    top: number;
    dx: number;
    dy: number;
    delay: number;
    size: number;
}

function generateSparkles(): Sparkle[] {
    return Array.from({ length: SPARKLE_COUNT }, (_, i) => ({
        id: i,
        emoji: SPARKLE_EMOJIS[Math.floor(Math.random() * SPARKLE_EMOJIS.length)],
        left: Math.random() * 100,
        top: 50 + Math.random() * 30,
        dx: (Math.random() - 0.5) * 200,
        dy: -150 - Math.random() * 200,
        delay: Math.random() * 0.8,
        size: 16 + Math.random() * 20,
    }));
}

export function LevelUpOverlay() {
    const levelUpEvent = useGameStore((s) => s.levelUpEvent);
    const clearLevelUpEvent = useGameStore((s) => s.clearLevelUpEvent);
    const [visible, setVisible] = useState(false);

    const sparkles = useMemo(() => (levelUpEvent ? generateSparkles() : []), [levelUpEvent]);
    const handleDismiss = useCallback(() => {
        setVisible(false);
        window.setTimeout(clearLevelUpEvent, 300);
    }, [clearLevelUpEvent]);

    useModalEscape(Boolean(levelUpEvent && visible), handleDismiss);

    useEffect(() => {
        if (levelUpEvent) {
            setVisible(true);
            const t = window.setTimeout(handleDismiss, 4500);
            return () => window.clearTimeout(t);
        }
    }, [levelUpEvent, handleDismiss]);

    if (!levelUpEvent || !visible) return null;

    const titleId = 'level-up-overlay-title';

    return (
        <div
            className="fixed inset-0 z-[300] flex items-center justify-center animate-levelup-overlay"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
            onClick={handleDismiss}
        >
            {/* キラキラパーティクル */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                {sparkles.map((s) => (
                    <div
                        key={s.id}
                        className="absolute animate-sparkle"
                        style={{
                            left: `${s.left}%`,
                            top: `${s.top}%`,
                            fontSize: `${s.size}px`,
                            animationDelay: `${s.delay}s`,
                            // CSS変数でアニメーション方向を制御
                            ['--dx' as string]: `${s.dx}px`,
                            ['--dy' as string]: `${s.dy}px`,
                        } as React.CSSProperties}
                    >
                        {s.emoji}
                    </div>
                ))}
            </div>

            {/* メインコンテンツ */}
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
                    <Sparkles size={36} style={{ color: 'var(--color-accent-gold)' }} />
                </div>

                <h2
                    id={titleId}
                    className="animate-levelup-title text-5xl font-black mb-2"
                    style={{ color: 'var(--color-accent-gold)', letterSpacing: '0.04em' }}
                >
                    LEVEL UP!
                </h2>

                <div
                    className="text-base mb-5"
                    style={{ color: 'var(--color-text-secondary)' }}
                >
                    Lv.{levelUpEvent.fromLevel}
                    <span className="mx-2" style={{ color: 'var(--color-text-muted)' }}>→</span>
                    <span style={{ color: 'var(--color-accent-gold)', fontWeight: 700 }}>
                        Lv.{levelUpEvent.toLevel}
                    </span>
                </div>

                <div className="flex flex-col gap-2">
                    <StatRow
                        icon="⚔️"
                        label="攻撃"
                        gain={levelUpEvent.attackGain}
                        delay={0.6}
                    />
                    <StatRow
                        icon="🛡️"
                        label="防御"
                        gain={levelUpEvent.defenseGain}
                        delay={0.8}
                    />
                    <StatRow
                        icon="❤️"
                        label="HP"
                        gain={levelUpEvent.hpGain}
                        delay={1.0}
                    />
                </div>

                <p
                    className="mt-5 text-xs"
                    style={{ color: 'var(--color-text-muted)' }}
                >
                    タップして閉じる
                </p>
            </div>
        </div>
    );
}

function StatRow({ icon, label, gain, delay }: { icon: string; label: string; gain: number; delay: number }) {
    return (
        <div
            className="animate-stat-slide flex items-center justify-between px-4 py-2.5 rounded-xl"
            style={{
                backgroundColor: 'var(--color-bg-secondary)',
                animationDelay: `${delay}s`,
            }}
        >
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {icon} {label}
            </span>
            <span
                className="text-base font-bold"
                style={{ color: 'var(--color-accent-emerald)' }}
            >
                +{gain}
            </span>
        </div>
    );
}
