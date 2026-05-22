import { useState, useMemo } from 'react';
import { useStatsStore } from '../stores/useStatsStore';

// ─── ヒートマップ色定義 ─────────────────────────────────────────
const TASK_COLORS = [
    'var(--color-bg-secondary)',   // 0: データなし
    'rgba(99, 102, 241, 0.25)',    // 1: 低XP (1-15)
    'rgba(99, 102, 241, 0.45)',    // 2: 中XP (16-30)
    'rgba(99, 102, 241, 0.65)',    // 3: 高XP (31-50)
    'rgba(99, 102, 241, 0.90)',    // 4: 最高XP (51+)
];
const HABIT_COLORS = [
    'var(--color-bg-secondary)',   // 0: データなし
    'rgba(16, 185, 129, 0.25)',    // 1: 1個達成
    'rgba(16, 185, 129, 0.45)',    // 2: 2-3個達成
    'rgba(16, 185, 129, 0.65)',    // 3: 4個以上
    'rgba(16, 185, 129, 0.90)',    // 4: 全達成
];

const WEEKDAY_LABELS = ['', '月', '', '水', '', '金', ''];
const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

/** YYYY-MM-DD の曜日名を返す */
function getWeekdayName(date: string): string {
    return WEEKDAY_NAMES[new Date(date + 'T00:00:00+09:00').getDay()];
}

function getTaskLevel(xp: number): number {
    if (xp === 0) return 0;
    if (xp <= 15) return 1;
    if (xp <= 30) return 2;
    if (xp <= 50) return 3;
    return 4;
}

function getHabitLevel(count: number, allComplete: boolean): number {
    if (allComplete) return 4;
    if (count === 0) return 0;
    if (count === 1) return 1;
    if (count <= 3) return 2;
    return 3;
}

/** 過去N日分の日付配列を生成 (YYYY-MM-DD) */
function generateDateRange(days: number): string[] {
    const dates: string[] = [];
    const now = new Date();
    const jstOffset = 9 * 60 * 60 * 1000;
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now.getTime() + jstOffset - i * 86400000);
        dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
}

/** 日付を週ごとにグループ化 */
function groupByWeeks(dates: string[]): string[][] {
    const weeks: string[][] = [];
    const firstDate = new Date(dates[0] + 'T00:00:00+09:00');
    const firstDay = firstDate.getDay();
    const paddedDates = [...Array(firstDay).fill(''), ...dates];

    for (let i = 0; i < paddedDates.length; i += 7) {
        weeks.push(paddedDates.slice(i, i + 7));
    }
    const lastWeek = weeks[weeks.length - 1];
    while (lastWeek.length < 7) lastWeek.push('');
    return weeks;
}

/** 月ラベル位置を計算 */
function getMonthLabels(weeks: string[][]): { label: string; weekIndex: number }[] {
    const labels: { label: string; weekIndex: number }[] = [];
    let lastMonth = '';
    const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

    weeks.forEach((week, weekIndex) => {
        const validDate = week.find((d) => d !== '');
        if (!validDate) return;
        const month = validDate.substring(5, 7);
        if (month !== lastMonth) {
            labels.push({ label: MONTH_NAMES[parseInt(month, 10) - 1], weekIndex });
            lastMonth = month;
        }
    });
    return labels;
}

type TabMode = 'tasks' | 'habits';

export function StatsPage() {
    const [mode, setMode] = useState<TabMode>('tasks');
    const { taskXpLog, habitLog } = useStatsStore();

    const TOTAL_DAYS = 119;
    const dates = useMemo(() => generateDateRange(TOTAL_DAYS), []);
    const weeks = useMemo(() => groupByWeeks(dates), [dates]);
    const monthLabels = useMemo(() => getMonthLabels(weeks), [weeks]);

    // 直近7日間のXP集計
    const weeklyXp = useMemo(() => {
        const perDay = generateDateRange(7).map((date) => ({ date, xp: taskXpLog[date] || 0 }));
        const total = perDay.reduce((sum, d) => sum + d.xp, 0);
        const max = Math.max(...perDay.map((d) => d.xp), 0);
        return { perDay, total, max };
    }, [taskXpLog]);

    // 集計値
    const stats = useMemo(() => {
        if (mode === 'tasks') {
            let totalXp = 0;
            let activeDays = 0;
            let currentStreak = 0;
            let maxStreak = 0;
            let tempStreak = 0;

            for (const date of dates) {
                const xp = taskXpLog[date] || 0;
                totalXp += xp;
                if (xp > 0) {
                    activeDays++;
                    tempStreak++;
                    maxStreak = Math.max(maxStreak, tempStreak);
                } else {
                    tempStreak = 0;
                }
            }
            for (let i = dates.length - 1; i >= 0; i--) {
                if ((taskXpLog[dates[i]] || 0) > 0) currentStreak++;
                else break;
            }

            return { totalXp, activeDays, currentStreak, maxStreak };
        } else {
            let totalCompletions = 0;
            let perfectDays = 0;
            let currentStreak = 0;
            let maxStreak = 0;
            let tempStreak = 0;

            for (const date of dates) {
                const log = habitLog[date];
                const count = log?.count || 0;
                totalCompletions += count;
                if (log?.allComplete) {
                    perfectDays++;
                    tempStreak++;
                    maxStreak = Math.max(maxStreak, tempStreak);
                } else {
                    tempStreak = 0;
                }
            }
            for (let i = dates.length - 1; i >= 0; i--) {
                if (habitLog[dates[i]]?.allComplete) currentStreak++;
                else break;
            }
            return { totalXp: totalCompletions, activeDays: perfectDays, currentStreak, maxStreak };
        }
    }, [mode, dates, taskXpLog, habitLog]);

    const [tooltipInfo, setTooltipInfo] = useState<{ date: string; value: string } | null>(null);

    return (
        <div className="max-w-lg mx-auto px-4 pt-6 pb-8">
            {/* ヘッダー */}
            <h1 className="text-2xl font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>統計</h1>

            {/* 今週のXPサマリー */}
            <div className="rounded-xl p-4 mb-5" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>今週のXP</h2>
                    <span className="text-sm font-bold" style={{ color: 'var(--color-accent-primary)' }}>
                        ⚡ 合計 {weeklyXp.total.toLocaleString()} XP
                    </span>
                </div>
                <div className="flex items-stretch gap-1.5" style={{ height: '88px' }}>
                    {weeklyXp.perDay.map(({ date, xp }) => {
                        const barPct = weeklyXp.max > 0 ? (xp / weeklyXp.max) * 100 : 0;
                        return (
                            <div key={date} className="flex-1 flex flex-col items-center">
                                <div className="flex-1 flex items-end w-full">
                                    <div
                                        className="w-full rounded-t transition-all"
                                        title={`${date}: ${xp} XP`}
                                        style={{
                                            height: `${barPct}%`,
                                            minHeight: '3px',
                                            backgroundColor: xp > 0 ? 'var(--color-accent-primary)' : 'var(--color-border-default)',
                                        }}
                                    />
                                </div>
                                <span className="text-[10px] mt-1" style={{ color: 'var(--color-text-muted)' }}>{getWeekdayName(date)}</span>
                                <span className="text-[9px]" style={{ color: 'var(--color-text-muted)' }}>{xp}</span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* セグメントコントロール */}
            <div className="flex rounded-xl p-1 mb-5" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                {(['tasks', 'habits'] as TabMode[]).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setMode(tab)}
                        className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200"
                        style={{
                            backgroundColor: mode === tab ? 'var(--color-accent-primary)' : 'transparent',
                            color: mode === tab ? 'white' : 'var(--color-text-muted)',
                        }}
                    >
                        {tab === 'tasks' ? 'タスク' : '習慣'}
                    </button>
                ))}
            </div>

            {/* サマリーカード */}
            <div className="grid grid-cols-2 gap-3 mb-5">
                <SummaryCard
                    label={mode === 'tasks' ? '合計XP' : '合計達成数'}
                    value={stats.totalXp}
                    icon={mode === 'tasks' ? '⚡' : '✅'}
                />
                <SummaryCard
                    label={mode === 'tasks' ? 'アクティブ日数' : '全達成日数'}
                    value={stats.activeDays}
                    icon="📅"
                />
                <SummaryCard label="現在の連続記録" value={stats.currentStreak} icon="🔥" />
                <SummaryCard label="最長連続記録" value={stats.maxStreak} icon="🏆" />
            </div>

            {/* ヒートマップ */}
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
                <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>
                    {mode === 'tasks' ? 'XP獲得ヒートマップ' : '習慣達成ヒートマップ'}
                </h2>

                {/* 月ラベル */}
                <div className="flex ml-7 mb-1 gap-0" style={{ position: 'relative' }}>
                    {monthLabels.map(({ label, weekIndex }, i) => (
                        <div
                            key={i}
                            className="text-[10px] absolute"
                            style={{
                                color: 'var(--color-text-muted)',
                                left: `${weekIndex * 15}px`,
                            }}
                        >
                            {label}
                        </div>
                    ))}
                </div>

                {/* ヒートマップ本体 */}
                <div className="flex gap-0 mt-5" style={{ overflowX: 'auto' }}>
                    {/* 曜日ラベル */}
                    <div className="flex flex-col gap-[2px] mr-1 flex-shrink-0">
                        {WEEKDAY_LABELS.map((label, i) => (
                            <div
                                key={i}
                                className="text-[9px] flex items-center justify-end"
                                style={{ width: '22px', height: '13px', color: 'var(--color-text-muted)' }}
                            >
                                {label}
                            </div>
                        ))}
                    </div>

                    {/* 週ごとのカラム */}
                    {weeks.map((week, wi) => (
                        <div key={wi} className="flex flex-col gap-[2px]">
                            {week.map((date, di) => {
                                if (date === '') {
                                    return (
                                        <div key={`${wi}-${di}`} style={{ width: '13px', height: '13px' }} />
                                    );
                                }

                                let level: number;
                                let tooltipText: string;

                                if (mode === 'tasks') {
                                    const xp = taskXpLog[date] || 0;
                                    level = getTaskLevel(xp);
                                    tooltipText = `${xp} XP`;
                                } else {
                                    const log = habitLog[date];
                                    const count = log?.count || 0;
                                    const allComplete = log?.allComplete || false;
                                    level = getHabitLevel(count, allComplete);
                                    tooltipText = allComplete ? `${count}個 (全達成!)` : `${count}個達成`;
                                }

                                const color = mode === 'tasks' ? TASK_COLORS[level] : HABIT_COLORS[level];

                                return (
                                    <div
                                        key={`${wi}-${di}`}
                                        className="rounded-sm cursor-pointer transition-transform hover:scale-125"
                                        style={{
                                            width: '13px',
                                            height: '13px',
                                            backgroundColor: color,
                                        }}
                                        onClick={() => setTooltipInfo(tooltipInfo?.date === date ? null : { date, value: tooltipText })}
                                        onMouseEnter={() => setTooltipInfo({ date, value: tooltipText })}
                                        onMouseLeave={() => setTooltipInfo(null)}
                                    />
                                );
                            })}
                        </div>
                    ))}
                </div>

                {/* ツールチップ */}
                {tooltipInfo && (
                    <div className="mt-3 text-xs px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)' }}>
                        <span style={{ color: 'var(--color-text-muted)' }}>{tooltipInfo.date}</span>
                        <span className="ml-2 font-medium">{tooltipInfo.value}</span>
                    </div>
                )}

                {/* 凡例 */}
                <div className="flex items-center justify-end gap-1 mt-3">
                    <span className="text-[10px] mr-1" style={{ color: 'var(--color-text-muted)' }}>少</span>
                    {(mode === 'tasks' ? TASK_COLORS : HABIT_COLORS).map((color, i) => (
                        <div
                            key={i}
                            className="rounded-sm"
                            style={{ width: '11px', height: '11px', backgroundColor: color }}
                        />
                    ))}
                    <span className="text-[10px] ml-1" style={{ color: 'var(--color-text-muted)' }}>多</span>
                </div>
            </div>

        </div>
    );
}

function SummaryCard({ label, value, icon }: { label: string; value: number; icon: string }) {
    return (
        <div className="rounded-xl px-4 py-3" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
            <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>{icon} {label}</div>
            <div className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{value.toLocaleString()}</div>
        </div>
    );
}
