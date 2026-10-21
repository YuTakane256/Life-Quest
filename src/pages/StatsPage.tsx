import { useState, useMemo } from 'react';
import {
    generateDateRange as generateDateRangeCore,
    getHabitHeatmapLevel,
    getMonthLabels as getMonthLabelsCore,
    getTaskHeatmapLevel,
    groupDatesByWeeks,
    STATS_DISPLAY_DAYS,
    summarizeStats,
    getStatsDayValue,
    getWeeklyTaskXp,
    getStatsBestRecords,
    formatStatsStreakRange,
} from '@life-quest/core/stats';
import { useStatsStore } from '../stores/useStatsStore';
import { useGameStore } from '../stores/useGameStore';
import { useTitleStore } from '../stores/useTitleStore';
import { shiftDate } from '../utils/dateUtils';
import { useJstToday } from '../hooks/useJstToday';
import { getAchievementProgress, getUnlockedTitles, type AchievementProgress } from '../utils/achievements';
import { getProgressBarA11y } from '../utils/progressBar';
import { getHeatmapCellLabel } from '../utils/statsHeatmapA11y';

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
// 濃淡しきい値は @life-quest/core/stats に移動し、Mobileと共有する
const getTaskLevel = getTaskHeatmapLevel;
const getHabitLevel = getHabitHeatmapLevel;

/** 日付を週ごとにグループ化。実体はcoreと共有（TZ非依存のUTC計算）。 */
const groupByWeeks = groupDatesByWeeks;

/** 月ラベル位置を計算。実体はcoreと共有。 */
const getMonthLabels = getMonthLabelsCore;

type TabMode = 'tasks' | 'habits';

export function StatsPage() {
    const [mode, setMode] = useState<TabMode>('tasks');
    const { taskXpLog, habitLog } = useStatsStore();
    const totalXp = useGameStore((s) => s.character.totalXp);
    const maxStage = useGameStore((s) => s.battle.maxClearedStage);
    const equipmentCount = useGameStore((s) => s.equipment.length);
    const activeTitle = useTitleStore((s) => s.activeTitle);
    const setActiveTitle = useTitleStore((s) => s.setActiveTitle);

    const today = useJstToday();
    const TOTAL_DAYS = STATS_DISPLAY_DAYS;
    const dates = useMemo(() => generateDateRangeCore(TOTAL_DAYS, today), [TOTAL_DAYS, today]);
    const weeks = useMemo(() => groupByWeeks(dates), [dates]);
    const monthLabels = useMemo(() => getMonthLabels(weeks), [weeks]);

    const weeklyXp = useMemo(() => getWeeklyTaskXp(taskXpLog, today), [taskXpLog, today]);
    const bestRecords = useMemo(() => getStatsBestRecords(taskXpLog, habitLog), [taskXpLog, habitLog]);
    const [showWeeklyDetails, setShowWeeklyDetails] = useState(false);

    const achievementProgress = useMemo(() => {
        const activeDays = Object.values(taskXpLog).filter((xp) => xp > 0).length;
        const perfectDays = Object.values(habitLog).filter((log) => log.allComplete).length;
        return getAchievementProgress({
            totalXp,
            activeDays,
            perfectDays,
            maxStage,
            equipmentCount,
        });
    }, [taskXpLog, habitLog, totalXp, maxStage, equipmentCount]);

    const unlockedTitles = useMemo(() => getUnlockedTitles(achievementProgress), [achievementProgress]);
    const selectedTitle = activeTitle && unlockedTitles.includes(activeTitle) ? activeTitle : null;

    // 集計値
    const stats = useMemo(() => summarizeStats(dates, taskXpLog, habitLog, mode), [mode, dates, taskXpLog, habitLog]);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const detailDate = selectedDate && dates.includes(selectedDate) ? selectedDate : today;
    const selectDate = (date: string) => setSelectedDate(date === today ? null : date);

    const reviewCards = (
        <>
            {/* 直近7日間のタスクXP（習慣モード中も意味を変えない） */}
            <section aria-label="直近7日間のXP" className="order-5 min-w-0 rounded-xl p-4 mb-5 md:mb-0" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>直近7日間のXP</h2>
                    <span className="text-sm font-bold min-w-0 max-w-full break-all" style={{ color: 'var(--color-accent-primary)' }}>
                        ⚡ 合計 {weeklyXp.total.toLocaleString('ja-JP')} XP
                    </span>
                </div>
                <p className="text-[11px] mb-3" style={{ color: 'var(--color-text-muted)' }}>タスクXPのみ。今日を含む7日間（日本時間）。</p>
                <div className="overflow-x-auto max-w-full">
                <div className="flex items-stretch gap-1.5" style={{ minWidth: 260 }}>
                    {weeklyXp.perDay.map(({ date, xp, weekday }) => {
                        const barPct = weeklyXp.max > 0 ? (xp / weeklyXp.max) * 100 : 0;
                        return (
                            <div key={date} className="flex-1 min-w-0 flex flex-col items-center" role="img" aria-label={`${date}（${weekday}）: ${xp.toLocaleString('ja-JP')} XP`}>
                                <div className="flex items-end w-full" style={{ height: 72 }}>
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
                                <span aria-hidden="true" className="mt-1" style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>{weekday}</span>
                                <span aria-hidden="true" className="max-w-full break-all" style={{ color: 'var(--color-text-muted)', fontSize: 9 }}>{xp.toLocaleString('ja-JP')}</span>
                            </div>
                        );
                    })}
                </div>
                </div>
                <button type="button" aria-expanded={showWeeklyDetails} aria-controls="weekly-xp-details" onClick={() => setShowWeeklyDetails((value) => !value)} className="w-full min-h-11 px-3 mt-2 rounded-lg text-xs text-left" style={{ color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg-secondary)' }}>7日間の内訳</button>
                {showWeeklyDetails && <ul id="weekly-xp-details" className="mt-2 space-y-2 text-xs">
                    {weeklyXp.perDay.map(({ date, xp, weekday }) => <li key={date} className="flex flex-wrap gap-2 justify-between" style={{ color: 'var(--color-text-primary)', overflowWrap: 'anywhere' }}><span>{date}（{weekday}）</span><span>{xp.toLocaleString('ja-JP')} XP</span></li>)}
                </ul>}
            </section>

            {/* 自己ベスト記録 */}
            <section aria-label="自己ベスト記録" className="order-6 min-w-0 rounded-xl p-4 mb-5 md:mb-0" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
                <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}>
                    <span>🏆</span>自己ベスト記録
                </h2>
                <p className="text-[11px] mb-3" style={{ color: 'var(--color-text-muted)' }}>保存済みの全期間。同率の場合は最初の達成日を表示します。</p>
                <div className="flex flex-col gap-2">
                    <BestRecordRow
                        icon="⚡"
                        label="1日の最高XP"
                        value={bestRecords.bestXp > 0 ? `${bestRecords.bestXp.toLocaleString('ja-JP')} XP` : '—'}
                        detail={bestRecords.bestXpDate}
                    />
                    <BestRecordRow
                        icon="🔥"
                        label="最長アクティブ連続"
                        value={bestRecords.longestActive.count > 0 ? `${bestRecords.longestActive.count}日` : '—'}
                        detail={formatStatsStreakRange(bestRecords.longestActive)}
                    />
                    <BestRecordRow
                        icon="🌟"
                        label="最長 全習慣達成連続"
                        value={bestRecords.longestPerfect.count > 0 ? `${bestRecords.longestPerfect.count}日` : '—'}
                        detail={formatStatsStreakRange(bestRecords.longestPerfect)}
                    />
                </div>
            </section>

        </>
    );
    const achievementsCard = (
            <section aria-label="実績と称号" className="order-7 min-w-0 md:col-span-2 rounded-xl p-4 mb-5 mt-0 md:mt-5" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', overflowWrap: 'anywhere' }}>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <h2 className="text-sm font-semibold flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}>
                        <span>🏅</span>実績
                    </h2>
                    <span className="text-xs font-bold" style={{ color: 'var(--color-text-secondary)' }}>
                        {achievementProgress.filter((achievement) => achievement.unlocked).length}/{achievementProgress.length} 達成
                    </span>
                </div>
                <div className="flex flex-col gap-2">
                    {achievementProgress.map((achievement) => (
                        <AchievementRow key={achievement.id} achievement={achievement} />
                    ))}
                </div>
                    <div className="mt-4" role="group" aria-label="表示する称号">
                        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>表示する称号</h3>
                        <p className="text-xs my-2" role="status" style={{ color: 'var(--color-text-primary)' }}>表示中: {selectedTitle ?? '称号なし'}</p>
                        <p className="text-xs mb-2" style={{ color: 'var(--color-text-secondary)' }}>{unlockedTitles.length > 0 ? '獲得した称号をキャラ画面に表示できます。' : '実績を達成すると称号を選べます。'}</p>
                        {unlockedTitles.length > 0 && <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => setActiveTitle(null)}
                                aria-pressed={selectedTitle === null}
                                aria-label="称号なしを選択する"
                                className="min-h-11 min-w-11 max-w-full px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
                                style={{
                                    backgroundColor: selectedTitle === null ? 'var(--color-accent-primary)' : 'var(--color-bg-secondary)',
                                    color: selectedTitle === null ? 'white' : 'var(--color-text-secondary)',
                                    border: '1px solid var(--color-border-default)',
                                }}
                            >
                                {selectedTitle === null && <span aria-hidden="true">✓ </span>}称号なし
                            </button>
                            {unlockedTitles.map((title) => (
                                <button
                                    key={title}
                                    type="button"
                                    onClick={() => setActiveTitle(title)}
                                    aria-pressed={selectedTitle === title}
                                    aria-label={`「${title}」を選択する`}
                                    className="min-h-11 min-w-11 max-w-full px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
                                    style={{
                                        backgroundColor: selectedTitle === title ? 'var(--color-accent-primary)' : 'var(--color-bg-secondary)',
                                        color: selectedTitle === title ? 'white' : 'var(--color-text-secondary)',
                                        border: '1px solid var(--color-border-default)',
                                    }}
                                >
                                    {selectedTitle === title && <span aria-hidden="true">✓ </span>}{title}
                                </button>
                            ))}
                        </div>}
                    </div>
            </section>

    );

    return (
        <div className="app-page max-w-lg mx-auto px-4 pt-6 pb-8 grid grid-cols-1 md:grid-cols-2 gap-x-5">
            <div className="order-1 md:col-span-2 flex flex-wrap items-end justify-between gap-3 mb-4">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>統計</h1>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>日々の積み重ねと自己ベスト</p>
                </div>
                <span className="text-[11px] px-2 py-1 rounded-lg" style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)' }}>過去{TOTAL_DAYS}日</span>
            </div>
            {/* セグメントコントロール */}
            <div className="order-2 md:col-span-2 flex rounded-xl p-1 mb-4" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                {(['tasks', 'habits'] as TabMode[]).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setMode(tab)}
                        aria-pressed={mode === tab}
                        className="flex-1 min-h-11 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200"
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
            <div className="order-3 md:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <SummaryCard
                    label={mode === 'tasks' ? '合計XP' : '合計達成数'}
                    value={stats.total}
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
            <div className="order-4 md:col-span-2 min-w-0 rounded-xl p-4 mb-5" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
                <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                    <div>
                        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                            {mode === 'tasks' ? 'XP獲得ヒートマップ' : '習慣達成ヒートマップ'}
                        </h2>
                        <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                            {mode === 'tasks' ? '濃い日ほど獲得XPが多い日です' : '濃い日ほど多くの習慣を達成しています'}
                        </p>
                    </div>
                    <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>セルを選択して詳細</span>
                </div>

                {/* 月ラベル */}
                <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
                <div style={{ width: 26 + weeks.length * 15 }}>
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
                <div className="flex gap-0 mt-5">
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
                        <div key={wi} className="flex flex-col gap-[2px]" style={{ marginRight: 2 }}>
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
                                    <button
                                        key={`${wi}-${di}`}
                                        type="button"
                                        aria-label={getHeatmapCellLabel(date, tooltipText)}
                                        className="rounded-sm cursor-pointer transition-transform hover:scale-125 focus:outline-none focus-visible:ring-2"
                                        style={{
                                            width: '13px',
                                            height: '13px',
                                            backgroundColor: color,
                                            boxShadow: detailDate === date ? 'inset 0 0 0 1px var(--color-text-primary)' : undefined,
                                            '--tw-ring-color': 'var(--color-accent-primary)',
                                        } as React.CSSProperties}
                                        aria-pressed={detailDate === date}
                                        onClick={() => selectDate(date)}
                                        onFocus={() => selectDate(date)}
                                    />
                                );
                            })}
                        </div>
                    ))}
                </div>
                </div>
                </div>

                {/* 小さいセルを押さなくても全日付に移動できる代替操作。詳細は常に現在のログから導出する。 */}
                <div className="mt-3 flex flex-wrap gap-2 items-center text-xs" aria-label="日別統計の操作">
                    <label className="flex flex-wrap items-center gap-2 min-w-0">
                        日付を選択
                        <select aria-label="統計の日付" value={detailDate} onChange={(event) => selectDate(event.target.value)}
                            className="min-h-11 max-w-full rounded-lg px-2" style={{ color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg-secondary)' }}>
                            {[...dates].reverse().map((date) => <option key={date} value={date}>{date}</option>)}
                        </select>
                    </label>
                    <button type="button" className="min-h-11 px-3 rounded-lg disabled:opacity-40" disabled={detailDate === dates[0]} onClick={() => selectDate(shiftDate(detailDate, -1))}>前の日</button>
                    <button type="button" className="min-h-11 px-3 rounded-lg disabled:opacity-40" disabled={detailDate === today} onClick={() => selectDate(shiftDate(detailDate, 1))}>次の日</button>
                    <button type="button" className="min-h-11 px-3 rounded-lg" onClick={() => setSelectedDate(null)}>今日</button>
                </div>
                <div role="status" aria-label="日別統計" className="mt-2 text-xs px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)' }}>
                    {detailDate}: {getStatsDayValue(detailDate, taskXpLog, habitLog, mode)}
                </div>
                <p className="mt-2 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>日本時間・今日を含む{TOTAL_DAYS}日間。現在の連続記録は今日まで途切れず続いた日数です。記録のない日は0として表示します。</p>
                <p className="mt-2 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>保存済みの達成ログを表示します。タスクや習慣を削除しても、過去の達成記録は残ります。</p>

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

            {reviewCards}
            {achievementsCard}
        </div>
    );
}

function SummaryCard({ label, value, icon }: { label: string; value: number; icon: string }) {
    return (
        <div className="min-w-0 rounded-xl px-4 py-3" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
            <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>{icon} {label}</div>
            <div className="text-xl font-bold break-all" style={{ color: 'var(--color-text-primary)' }}>{value.toLocaleString()}</div>
        </div>
    );
}

function AchievementRow({ achievement }: { achievement: AchievementProgress }) {
    const percent = Math.round(achievement.progress * 100);
    const a11y = getProgressBarA11y(
        achievement.current,
        achievement.target,
        () => `${achievement.unlocked ? '達成' : '未達成'}・${achievement.current.toLocaleString('ja-JP')} / ${achievement.target.toLocaleString('ja-JP')}・獲得称号: ${achievement.rewardTitle}`,
    );
    return (
        <div data-testid={`achievement-${achievement.id}`} className="min-w-0 rounded-lg px-3 py-3" style={{ backgroundColor: 'var(--color-bg-secondary)', overflowWrap: 'anywhere' }}>
            <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                <div className="flex items-start gap-2 min-w-0 flex-1 basis-40">
                    <span className="text-base flex-shrink-0" aria-hidden="true">{achievement.icon}</span>
                    <div className="min-w-0">
                        <h3 className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>{achievement.title}</h3>
                        <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>{achievement.description}</p>
                    </div>
                </div>
                <span
                    className="text-xs px-2 py-1 rounded-lg max-w-full"
                    style={{
                        backgroundColor: achievement.unlocked ? 'rgba(245, 158, 11, 0.18)' : 'var(--color-bg-card)',
                        color: 'var(--color-text-primary)',
                        border: '1px solid var(--color-border-default)',
                    }}
                    aria-hidden="true"
                >
                    {achievement.unlocked ? '達成' : '未達成'} · {achievement.current.toLocaleString('ja-JP')}/{achievement.target.toLocaleString('ja-JP')}
                </span>
            </div>
            <p className="text-xs mb-2" style={{ color: 'var(--color-text-secondary)' }}>獲得称号: {achievement.rewardTitle}</p>
            <div
                className="h-1.5 rounded-full overflow-hidden"
                style={{ backgroundColor: 'var(--color-bg-card)' }}
                {...(a11y.max > 0
                    ? {
                        role: 'progressbar' as const,
                        'aria-valuenow': a11y.current,
                        'aria-valuemin': 0,
                        'aria-valuemax': a11y.max,
                        'aria-valuetext': a11y.text,
                        'aria-label': achievement.title,
                    }
                    : {})}
            >
                <div
                    className="h-full rounded-full transition-all"
                    style={{
                        width: `${percent}%`,
                        backgroundColor: achievement.unlocked ? 'var(--color-accent-gold)' : 'var(--color-accent-primary)',
                    }}
                />
            </div>
        </div>
    );
}

function BestRecordRow({ icon, label, value, detail }: { icon: string; label: string; value: string; detail: string }) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--color-bg-secondary)', overflowWrap: 'anywhere' }}>
            <div className="flex items-center gap-2 min-w-0">
                <span className="text-base flex-shrink-0">{icon}</span>
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
            </div>
            <div className="flex flex-col items-end min-w-0 max-w-full">
                <span className="text-sm font-bold" style={{ color: 'var(--color-accent-gold)' }}>{value}</span>
                {detail && <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{detail}</span>}
            </div>
        </div>
    );
}
