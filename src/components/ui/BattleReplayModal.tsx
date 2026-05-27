import { useEffect, useState } from 'react';
import { X, Pause, Play, FastForward, Trophy, Skull } from 'lucide-react';
import type { BattleHistoryEntry } from '../../types';
import { BATTLE_CONFIG } from '../../config/gameConfig';
import { HpBar } from './HpBar';

interface Props {
    entry: BattleHistoryEntry | null;
    onClose: () => void;
}

export function BattleReplayModal({ entry, onClose }: Props) {
    // -1 = 開始前（フルHP表示）
    const [currentLogIndex, setCurrentLogIndex] = useState<number>(-1);
    const [isPaused, setIsPaused] = useState<boolean>(false);

    // entry が変わったら状態をリセット
    useEffect(() => {
        setCurrentLogIndex(-1);
        setIsPaused(false);
    }, [entry?.id]);

    // 自動進行
    useEffect(() => {
        if (!entry || isPaused) return;
        if (currentLogIndex >= entry.logs.length) return;
        const timer = window.setTimeout(() => {
            setCurrentLogIndex((idx) => idx + 1);
        }, BATTLE_CONFIG.REPLAY_LOG_INTERVAL_MS);
        return () => window.clearTimeout(timer);
    }, [currentLogIndex, isPaused, entry]);

    if (!entry) return null;

    const { logs, enemyMaxHp, enemyName, stage, outcome, turnCount, xpEarned } = entry;

    // HPバーの現在値
    let playerHp: number;
    let enemyHp: number;
    if (currentLogIndex < 0 || logs.length === 0) {
        // 開始前: ログ0番目の playerHp = 最初の自分の攻撃直前 = フルHP
        playerHp = logs[0]?.playerHp ?? 0;
        enemyHp = enemyMaxHp;
    } else {
        const clampedIdx = Math.min(currentLogIndex, logs.length - 1);
        playerHp = logs[clampedIdx].playerHp;
        enemyHp = logs[clampedIdx].enemyHp;
    }
    const maxPlayerHp = logs[0]?.playerHp ?? Math.max(playerHp, 1);
    const isFinished = currentLogIndex >= logs.length;

    const visibleLogs = currentLogIndex < 0 ? [] : logs.slice(0, currentLogIndex + 1);

    const handleJumpToEnd = () => {
        setCurrentLogIndex(logs.length);
        setIsPaused(false);
    };

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center px-4 animate-fade-in"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.75)' }}
            onClick={onClose}
        >
            <div
                className="w-full max-w-lg max-h-[90dvh] rounded-2xl flex flex-col"
                style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* ヘッダー */}
                <div
                    className="flex items-center justify-between px-5 py-3 rounded-t-2xl"
                    style={{ borderBottom: '1px solid var(--color-border-default)' }}
                >
                    <div className="flex items-center gap-2 min-w-0">
                        {outcome === 'victory'
                            ? <Trophy size={18} style={{ color: 'var(--color-accent-gold)', flexShrink: 0 }} />
                            : <Skull size={18} style={{ color: 'var(--color-text-danger)', flexShrink: 0 }} />
                        }
                        <h3 className="text-sm font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>
                            ステージ {stage}: {enemyName}
                        </h3>
                        <span
                            className="text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
                            style={{
                                backgroundColor: outcome === 'victory' ? 'var(--color-accent-gold)' : 'var(--color-text-danger)',
                                color: 'white',
                            }}
                        >
                            {outcome === 'victory' ? '勝利' : '敗北'}
                        </span>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg hover:opacity-70 transition-opacity flex-shrink-0"
                        style={{ color: 'var(--color-text-muted)' }}
                        aria-label="閉じる"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* HPバー */}
                <div className="grid grid-cols-2 gap-3 px-5 pt-4">
                    {/* プレイヤー */}
                    <div className="rounded-xl px-3 py-2" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)' }}>
                        <div className="text-[10px] mb-1" style={{ color: 'var(--color-text-muted)' }}>自分</div>
                        <HpBar current={playerHp} max={maxPlayerHp} variant="player" height="sm" trackColor="var(--color-bg-primary)" />
                    </div>
                    {/* 敵 */}
                    <div className="rounded-xl px-3 py-2" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)' }}>
                        <div className="text-[10px] mb-1 truncate" style={{ color: 'var(--color-text-muted)' }}>{enemyName}</div>
                        <HpBar current={enemyHp} max={enemyMaxHp} variant="enemy" height="sm" trackColor="var(--color-bg-primary)" />
                    </div>
                </div>

                {/* ログ表示エリア */}
                <div
                    className="mx-5 my-3 rounded-xl p-3 overflow-y-auto"
                    style={{
                        backgroundColor: 'var(--color-bg-secondary)',
                        border: '1px solid var(--color-border-default)',
                        minHeight: '180px',
                        maxHeight: '300px',
                        flex: '1 1 auto',
                    }}
                >
                    {visibleLogs.length === 0 && (
                        <div className="text-center text-xs py-4" style={{ color: 'var(--color-text-muted)' }}>
                            まもなく開始…
                        </div>
                    )}
                    {visibleLogs.map((log, i) => (
                        <div key={i} className="text-sm py-1 animate-fade-in" style={{ color: 'var(--color-text-secondary)' }}>
                            <span style={{ color: 'var(--color-text-muted)' }}>[{log.turn}] </span>{log.message}
                        </div>
                    ))}
                    {isFinished && (
                        <div
                            className="mt-3 px-3 py-2 rounded-lg text-center text-sm font-bold animate-fade-in"
                            style={{
                                backgroundColor: outcome === 'victory' ? 'var(--color-accent-gold)22' : 'var(--color-text-danger)22',
                                color: outcome === 'victory' ? 'var(--color-accent-gold)' : 'var(--color-text-danger)',
                                border: `1px solid ${outcome === 'victory' ? 'var(--color-accent-gold)' : 'var(--color-text-danger)'}`,
                            }}
                        >
                            {outcome === 'victory'
                                ? `🏆 ${turnCount}ターンで勝利！ +${xpEarned} XP`
                                : `💀 ${turnCount}ターン目で敗北`}
                        </div>
                    )}
                </div>

                {/* コントロール */}
                <div
                    className="flex items-center justify-center gap-2 px-5 py-3 rounded-b-2xl"
                    style={{ borderTop: '1px solid var(--color-border-default)' }}
                >
                    <button
                        onClick={() => setIsPaused((p) => !p)}
                        disabled={isFinished}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}
                    >
                        {isPaused
                            ? <><Play size={14} /> 再生</>
                            : <><Pause size={14} /> 一時停止</>
                        }
                    </button>
                    <button
                        onClick={handleJumpToEnd}
                        disabled={isFinished}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-40"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}
                    >
                        <FastForward size={14} /> 最後まで
                    </button>
                </div>
            </div>
        </div>
    );
}
