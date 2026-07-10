import { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Swords } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '../../stores/useGameStore';
import { CHEST_IMAGES, CHEST_FALLBACK_IMAGE, ITEM_IMAGES, RARITY_COLORS, RARITY_LABELS } from '../../config/equipmentAssets';
import type { Rarity, EquipmentSlot } from '../../types';
import heroImg from '@life-quest/assets/images/hero.png';
import heroMaleImg from '@life-quest/assets/images/hero_male.png';
import { useModalEscape } from '../../hooks/useModalEscape';

type Phase = 'idle' | 'revealing' | 'revealed';

const SPARKLE_EMOJIS = ['✨', '⭐', '🌟', '💫', '⚡'];
const PARTICLE_COUNT_BY_RARITY: Record<Rarity, number> = {
    common: 8,
    uncommon: 12,
    rare: 18,
    epic: 24,
    legendary: 36,
};
const STARTER_PARTICLE_COUNT = 36;

const SLOT_LABELS: Record<EquipmentSlot, string> = { weapon: '武器', armor: '防具', accessory: 'アクセサリー' };

const REVEALING_DURATION_MS = 900;
const DISMISS_GUARD_MS = 1500;

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

function generateSparkles(count: number): Sparkle[] {
    return Array.from({ length: count }, (_, i) => ({
        id: i,
        emoji: SPARKLE_EMOJIS[Math.floor(Math.random() * SPARKLE_EMOJIS.length)],
        left: Math.random() * 100,
        top: 40 + Math.random() * 30,
        dx: (Math.random() - 0.5) * 240,
        dy: -160 - Math.random() * 220,
        delay: Math.random() * 0.5,
        size: 16 + Math.random() * 24,
    }));
}

export function ChestOpeningOverlay() {
    const pendingChestReveal = useGameStore((s) => s.pendingChestReveal);
    const clearPendingChestReveal = useGameStore((s) => s.clearPendingChestReveal);
    const characterAvatar = useGameStore((s) => s.character.avatar);
    const navigate = useNavigate();

    const [phase, setPhase] = useState<Phase>('idle');
    const [canDismiss, setCanDismiss] = useState(false);
    const [visible, setVisible] = useState(false);

    // 装備のレアリティ（starter なら legendary 相当の派手さで扱う）
    const effectiveRarity: Rarity | null = pendingChestReveal?.equipment?.rarity ?? null;

    // 演出色: 装備があればそのレアリティ色、青宝箱なら宝箱ブルー
    const accentColor = useMemo(() => {
        if (!pendingChestReveal) return 'var(--color-rarity-common)';
        if (effectiveRarity) return RARITY_COLORS[effectiveRarity];
        if (pendingChestReveal.isStarterCharacter) return 'var(--color-chest-blue)';
        return 'var(--color-rarity-common)';
    }, [pendingChestReveal, effectiveRarity]);

    const particleCount = useMemo(() => {
        if (!pendingChestReveal) return 0;
        if (effectiveRarity) return PARTICLE_COUNT_BY_RARITY[effectiveRarity];
        if (pendingChestReveal.isStarterCharacter) return STARTER_PARTICLE_COUNT;
        return 0;
    }, [pendingChestReveal, effectiveRarity]);

    const sparkles = useMemo(
        () => (pendingChestReveal ? generateSparkles(particleCount) : []),
        // 新しい reveal イベントごとにパーティクルを再生成
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [pendingChestReveal?.id, particleCount]
    );

    // 新しい reveal イベントが来たら状態をリセット
    useEffect(() => {
        if (pendingChestReveal) {
            setPhase('idle');
            setCanDismiss(false);
            setVisible(true);
        }
    }, [pendingChestReveal?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // phase 'revealing' から 'revealed' への自動遷移
    useEffect(() => {
        if (phase !== 'revealing') return;
        const t = window.setTimeout(() => setPhase('revealed'), REVEALING_DURATION_MS);
        return () => window.clearTimeout(t);
    }, [phase]);

    // phase 'revealed' 突入後の誤閉じ防止ガード
    useEffect(() => {
        if (phase !== 'revealed') return;
        const t = window.setTimeout(() => setCanDismiss(true), DISMISS_GUARD_MS);
        return () => window.clearTimeout(t);
    }, [phase]);

    const handleDismiss = useCallback(() => {
        setVisible(false);
        window.setTimeout(clearPendingChestReveal, 300);
    }, [clearPendingChestReveal]);

    const handleAdvance = useCallback(() => {
        if (phase === 'idle') {
            setPhase('revealing');
        } else if (phase === 'revealed' && canDismiss) {
            handleDismiss();
        }
    }, [canDismiss, handleDismiss, phase]);

    const handleGoToBattle = useCallback(() => {
        handleDismiss();
        // 閉じる演出と被らないよう少し遅延させる
        window.setTimeout(() => navigate('/map'), 100);
    }, [handleDismiss, navigate]);

    useModalEscape(Boolean(pendingChestReveal && visible && phase === 'revealed' && canDismiss), handleDismiss);

    if (!pendingChestReveal || !visible) return null;

    const { equipment, label, chestType, isStarterCharacter } = pendingChestReveal;
    const titleId = 'chest-opening-overlay-title';

    const chestImage = CHEST_IMAGES[chestType] || CHEST_FALLBACK_IMAGE;
    const heroAvatar = characterAvatar === 'male' ? heroMaleImg : heroImg;

    return (
        <div
            className="fixed inset-0 z-[310] flex items-center justify-center animate-levelup-overlay"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.82)' }}
            onClick={handleAdvance}
        >
            {/* 閉じるボタン（revealed && canDismiss でのみ表示） */}
            {phase === 'revealed' && canDismiss && (
                <button
                    onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
                    className="absolute top-4 right-4 p-2 rounded-lg opacity-70 hover:opacity-100 transition-opacity z-10"
                    style={{ color: 'var(--color-text-muted)', backgroundColor: 'rgba(0,0,0,0.4)' }}
                    aria-label="閉じる"
                >
                    <X size={20} />
                </button>
            )}

            {/* 背後の放射状ライト（revealing/revealed フェーズ） */}
            {phase !== 'idle' && (
                <div
                    className="absolute pointer-events-none animate-light-beam"
                    style={{
                        width: '90vmin',
                        height: '90vmin',
                        background: `radial-gradient(circle, ${accentColor}cc 0%, ${accentColor}33 35%, transparent 70%)`,
                        animationIterationCount: phase === 'revealed' ? 'infinite' : 1,
                        animationDuration: phase === 'revealed' ? '3s' : '0.9s',
                    }}
                />
            )}

            {/* パーティクル（revealing/revealed フェーズ） */}
            {phase !== 'idle' && (
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
                                color: accentColor,
                                textShadow: `0 0 12px ${accentColor}`,
                                ['--dx' as string]: `${s.dx}px`,
                                ['--dy' as string]: `${s.dy}px`,
                            } as React.CSSProperties}
                        >
                            {s.emoji}
                        </div>
                    ))}
                </div>
            )}

            {/* Phase 1: idle — 揺れる宝箱とプロンプト */}
            {phase === 'idle' && (
                <div className="relative flex flex-col items-center px-6">
                    <div
                        className="absolute inset-0 -m-12 rounded-full pointer-events-none"
                        style={{
                            background: `radial-gradient(circle, ${accentColor}55 0%, transparent 70%)`,
                            filter: 'blur(20px)',
                        }}
                    />
                    <img
                        src={chestImage}
                        alt={label}
                        className="w-48 h-48 object-contain animate-chest-idle animate-pulse-glow relative"
                        draggable={false}
                    />
                    <p
                        className="mt-8 text-lg font-bold animate-fade-in"
                        style={{ color: 'var(--color-text-primary)', textShadow: `0 0 16px ${accentColor}` }}
                    >
                        {label}
                    </p>
                    <p
                        className="mt-2 text-sm animate-fade-in"
                        style={{ color: 'var(--color-text-muted)' }}
                    >
                        タップして開ける
                    </p>
                </div>
            )}

            {/* Phase 2: revealing — 宝箱が爆発光と共に消える */}
            {phase === 'revealing' && (
                <div className="relative">
                    <img
                        src={chestImage}
                        alt={label}
                        className="w-48 h-48 object-contain animate-chest-burst"
                        draggable={false}
                    />
                </div>
            )}

            {/* Phase 3: revealed — アイテム / キャラ表示 */}
            {phase === 'revealed' && (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={titleId}
                    className="relative px-7 py-8 rounded-3xl mx-4 max-w-sm w-full text-center animate-item-reveal"
                    style={{
                        backgroundColor: 'var(--color-bg-card)',
                        border: `2px solid ${accentColor}`,
                        boxShadow: `0 0 60px ${accentColor}66`,
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* スターターキャラ（青宝箱） */}
                    {isStarterCharacter && equipment === null && (
                        <>
                            <div className="flex justify-center mb-3">
                                <div
                                    className="w-24 h-24 rounded-xl overflow-hidden"
                                    style={{ background: 'linear-gradient(135deg, var(--color-accent-primary), var(--color-accent-secondary))' }}
                                >
                                    <img src={heroAvatar} alt="Hero" className="w-full h-full object-cover" />
                                </div>
                            </div>
                            <h2
                                id={titleId}
                                className="text-2xl font-black mb-1"
                                style={{ color: accentColor, textShadow: `0 0 12px ${accentColor}` }}
                            >
                                キャラクター解放！
                            </h2>
                            <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>
                                バトルが解放されました
                            </p>
                            <div className="flex flex-col gap-2">
                                <button
                                    onClick={handleGoToBattle}
                                    className="w-full py-3 rounded-xl text-base font-bold flex items-center justify-center gap-2 transition-transform active:scale-95"
                                    style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}
                                >
                                    <Swords size={18} /> バトルへ
                                </button>
                                <button
                                    onClick={handleDismiss}
                                    disabled={!canDismiss}
                                    className="w-full py-2.5 rounded-xl text-sm transition-opacity disabled:opacity-50"
                                    style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}
                                >
                                    閉じる
                                </button>
                            </div>
                        </>
                    )}

                    {/* 通常の装備獲得 */}
                    {equipment && (
                        <>
                            <div className="flex justify-center mb-3">
                                <div
                                    className="w-24 h-24 rounded-xl flex items-center justify-center"
                                    style={{ backgroundColor: `${accentColor}22`, border: `1px solid ${accentColor}66` }}
                                >
                                    {ITEM_IMAGES[equipment.templateId] ? (
                                        <img
                                            src={ITEM_IMAGES[equipment.templateId]}
                                            alt={equipment.name}
                                            className="w-20 h-20 object-contain drop-shadow"
                                        />
                                    ) : (
                                        <span className="text-4xl">⚔️</span>
                                    )}
                                </div>
                            </div>
                            <div
                                className="inline-block px-3 py-0.5 rounded-full text-xs font-semibold mb-2"
                                style={{ backgroundColor: `${accentColor}22`, color: accentColor, border: `1px solid ${accentColor}66` }}
                            >
                                {RARITY_LABELS[equipment.rarity]} · {SLOT_LABELS[equipment.slot]}
                            </div>
                            <h2
                                id={titleId}
                                className="text-2xl font-black mb-4"
                                style={{ color: accentColor, textShadow: `0 0 12px ${accentColor}` }}
                            >
                                {equipment.name}
                            </h2>
                            <div className="flex flex-col gap-2 mb-4">
                                {equipment.attackBonus > 0 && <StatRow icon="⚔️" label="攻撃" value={`+${equipment.attackBonus}`} />}
                                {equipment.defenseBonus > 0 && <StatRow icon="🛡️" label="防御" value={`+${equipment.defenseBonus}`} />}
                                {equipment.hpBonus > 0 && <StatRow icon="❤️" label="HP" value={`+${equipment.hpBonus}`} />}
                            </div>
                            <button
                                onClick={handleDismiss}
                                disabled={!canDismiss}
                                className="w-full py-3 rounded-xl text-base font-bold transition-opacity active:scale-95 disabled:opacity-50"
                                style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}
                            >
                                インベントリに追加
                            </button>
                        </>
                    )}

                    {/* 防御: 装備なし & スターターでもない（現状は発生しないが念のため） */}
                    {!equipment && !isStarterCharacter && (
                        <>
                            <h2 id={titleId} className="text-xl font-bold mb-2" style={{ color: 'var(--color-text-muted)' }}>
                                ハズレ…
                            </h2>
                            <button
                                onClick={handleDismiss}
                                className="w-full py-2.5 rounded-xl text-sm"
                                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}
                            >
                                閉じる
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}

function StatRow({ icon, label, value }: { icon: string; label: string; value: string }) {
    return (
        <div
            className="flex items-center justify-between px-4 py-2 rounded-xl"
            style={{ backgroundColor: 'var(--color-bg-secondary)' }}
        >
            <span className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {icon} {label}
            </span>
            <span className="text-base font-bold" style={{ color: 'var(--color-accent-emerald)' }}>
                {value}
            </span>
        </div>
    );
}
