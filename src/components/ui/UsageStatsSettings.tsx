import { BarChart3 } from 'lucide-react';
import { useTaskStore } from '../../stores/useTaskStore';
import { useGameStore } from '../../stores/useGameStore';
import { useLoginBonusStore } from '../../stores/useLoginBonusStore';

interface StatItem {
    icon: string;
    label: string;
    value: string;
}

export function UsageStatsSettings() {
    const tasks = useTaskStore((s) => s.tasks);
    const totalXp = useGameStore((s) => s.character.totalXp);
    const level = useGameStore((s) => s.character.level);
    const chestQueue = useGameStore((s) => s.chestQueue);
    const gachaCount = useGameStore((s) => s.gachaCount);
    const loginStreak = useLoginBonusStore((s) => s.streak);

    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((t) => t.completed).length;
    const openedChests = chestQueue.filter((c) => c.opened).length;

    const items: StatItem[] = [
        { icon: '📋', label: '累計タスク', value: totalTasks.toLocaleString() },
        { icon: '✅', label: '完了タスク', value: completedTasks.toLocaleString() },
        { icon: '⚡', label: '累計XP', value: totalXp.toLocaleString() },
        { icon: '⭐', label: 'レベル', value: `Lv.${level}` },
        { icon: '📦', label: '開封宝箱', value: openedChests.toLocaleString() },
        { icon: '🎯', label: 'タスク消化数', value: gachaCount.toLocaleString() },
        { icon: '🔥', label: '連続ログイン', value: `${loginStreak}日` },
    ];

    return (
        <section className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
            <div className="flex items-start gap-2 mb-3">
                <BarChart3 size={16} className="mt-0.5" style={{ color: 'var(--color-accent-primary)' }} />
                <div>
                    <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>利用統計</h2>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>これまでの累計データ</p>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
                {items.map((item) => (
                    <div
                        key={item.label}
                        className="rounded-lg px-3 py-2 flex items-center justify-between gap-2"
                        style={{ backgroundColor: 'var(--color-bg-secondary)' }}
                    >
                        <span className="text-xs flex items-center gap-1.5 min-w-0" style={{ color: 'var(--color-text-muted)' }}>
                            <span className="flex-shrink-0">{item.icon}</span>
                            <span className="truncate">{item.label}</span>
                        </span>
                        <span className="text-sm font-bold flex-shrink-0" style={{ color: 'var(--color-text-primary)' }}>
                            {item.value}
                        </span>
                    </div>
                ))}
            </div>
        </section>
    );
}
