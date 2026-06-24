import { ChevronDown, History, Skull, Trophy } from 'lucide-react';
import type { BattleHistoryEntry } from '../../types';
import { formatRelativeTime } from '../../utils/dateUtils';

const HISTORY_PREVIEW_COUNT = 10;

interface BattleHistoryPanelProps {
    history: BattleHistoryEntry[];
    showAll: boolean;
    onToggleShowAll: () => void;
    onSelectEntry: (entry: BattleHistoryEntry) => void;
}

export function BattleHistoryPanel({ history, showAll, onToggleShowAll, onSelectEntry }: BattleHistoryPanelProps) {
    if (history.length === 0) return null;

    const visibleHistory = showAll ? history : history.slice(0, HISTORY_PREVIEW_COUNT);

    return (
        <details
            className="mb-4 rounded-xl group"
            style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
        >
            <summary
                className="flex items-center justify-between px-4 py-2.5 cursor-pointer select-none list-none"
                style={{ color: 'var(--color-text-primary)' }}
            >
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                    <History size={16} style={{ color: 'var(--color-accent-primary)' }} />
                    バトル履歴 ({history.length})
                </span>
                <ChevronDown size={16} className="transition-transform group-open:rotate-180" style={{ color: 'var(--color-text-muted)' }} />
            </summary>
            <div className="flex flex-col gap-1.5 px-3 pb-3">
                {visibleHistory.map((entry) => {
                    const isVictory = entry.outcome === 'victory';
                    return (
                        <button
                            key={entry.id}
                            onClick={() => onSelectEntry(entry)}
                            aria-label="バトル履歴を再生"
                            className="text-left flex items-center gap-3 px-3 py-2 rounded-lg transition-colors hover:opacity-80"
                            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)' }}
                        >
                            <div
                                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                                style={{ backgroundColor: isVictory ? 'var(--color-accent-gold)33' : 'var(--color-text-danger)33' }}
                            >
                                {isVictory
                                    ? <Trophy size={18} style={{ color: 'var(--color-accent-gold)' }} />
                                    : <Skull size={18} style={{ color: 'var(--color-text-danger)' }} />
                                }
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="text-sm font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>
                                        ステージ {entry.stage}: {entry.enemyName}
                                    </div>
                                    <div className="text-[10px] flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                                        {formatRelativeTime(entry.timestamp)}
                                    </div>
                                </div>
                                <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                                    {entry.turnCount}ターン
                                    {isVictory && (
                                        <span style={{ color: 'var(--color-accent-gold)', marginLeft: 6 }}>
                                            · +{entry.xpEarned} XP
                                        </span>
                                    )}
                                </div>
                            </div>
                        </button>
                    );
                })}
                {history.length > HISTORY_PREVIEW_COUNT && (
                    <button
                        onClick={onToggleShowAll}
                        className="mt-1 py-1.5 rounded-lg text-xs transition-colors hover:opacity-80"
                        style={{ color: 'var(--color-accent-primary)', backgroundColor: 'var(--color-bg-secondary)' }}
                    >
                        {showAll ? '折りたたむ' : `もっと見る (${history.length - HISTORY_PREVIEW_COUNT}件)`}
                    </button>
                )}
            </div>
        </details>
    );
}
