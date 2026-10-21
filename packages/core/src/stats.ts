/**
 * 統計表示（ヒートマップ・サマリー）のための共有計算ロジック。
 *
 * ヒートマップの濃淡しきい値・日付グリッドの組み立てはWebのStatsPageと
 * 同一ルール。日付計算はUTCベースの純関数で、`today`（JSTのYYYY-MM-DD）を
 * 注入して決定的にテストできる。
 *
 * build* は初回シード用の現存データからの導出。表示は両クライアントとも
 * 永続統計ログを用い、削除後も達成した事実を残す（statsLog参照）。
 */
import { areAllHabitsComplete, type Habit, type HabitDailyRecord } from './habits.ts';
import { isoToJstYmd, shiftDate } from './dates.ts';
import { XP_CONFIG } from './progression.ts';
import { getSubtaskRewardXp, type Task } from './tasks.ts';

/** Web/Mobileの振り返り期間。今日を含む119日（17週）。 */
export const STATS_DISPLAY_DAYS = 119;
export type StatsMode = 'tasks' | 'habits';

/** 現存するタスク/習慣ではなく、保存済みの日別ログから表示用集計を導出する。 */
export function summarizeStats(
    dates: readonly string[],
    taskXpLog: Readonly<Record<string, number>>,
    habitLog: Readonly<Record<string, HabitDayActivity>>,
    mode: StatsMode,
) {
    let total = 0;
    let activeDays = 0;
    let currentStreak = 0;
    let maxStreak = 0;
    for (const date of dates) {
        const active = mode === 'tasks' ? (taskXpLog[date] ?? 0) > 0 : (habitLog[date]?.allComplete ?? false);
        total += mode === 'tasks' ? (taskXpLog[date] ?? 0) : (habitLog[date]?.count ?? 0);
        if (active) { activeDays += 1; currentStreak += 1; }
        else currentStreak = 0;
        maxStreak = Math.max(maxStreak, currentStreak);
    }
    return { total, activeDays, currentStreak, maxStreak };
}

/** 日別詳細と読み上げで同じ値を使う。濃淡レベルではなく実数を伝える。 */
export function getStatsDayValue(
    date: string,
    taskXpLog: Readonly<Record<string, number>>,
    habitLog: Readonly<Record<string, HabitDayActivity>>,
    mode: StatsMode,
): string {
    if (mode === 'tasks') return `${(taskXpLog[date] ?? 0).toLocaleString('ja-JP')} XP`;
    const { count = 0, allComplete = false } = habitLog[date] ?? {};
    return `${count.toLocaleString('ja-JP')}個達成${allComplete ? ' (全達成!)' : ''}`;
}

// ─── ヒートマップ濃淡レベル ───────────────────────────────────

/** タスクXPを濃淡レベル(0-4)へ。しきい値はWebと同一（0 / 1-15 / 16-30 / 31-50 / 51+）。 */
export function getTaskHeatmapLevel(xp: number): number {
    if (xp <= 0) return 0;
    if (xp <= 15) return 1;
    if (xp <= 30) return 2;
    if (xp <= 50) return 3;
    return 4;
}

/** 習慣達成数を濃淡レベル(0-4)へ。全達成は常に最大（Webと同一）。 */
export function getHabitHeatmapLevel(count: number, allComplete: boolean): number {
    if (allComplete) return 4;
    if (count <= 0) return 0;
    if (count === 1) return 1;
    if (count <= 3) return 2;
    return 3;
}

// ─── 日付グリッド ─────────────────────────────────────────────

/** YYYY-MM-DD の曜日 (0=日) をTZ非依存で返す。 */
function weekdayOf(date: string): number {
    return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** today で終わる過去 days 日分の日付配列 (YYYY-MM-DD、昇順)。 */
export function generateDateRange(days: number, today: string): string[] {
    const dates: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
        dates.push(shiftDate(today, -i, { normalizeInvalid: true }));
    }
    return dates;
}

/**
 * 日付を週ごと（日曜始まり・各週7要素）にグループ化する。
 * 先頭は曜日に合わせて '' でパディングする（Webと同一）。
 */
export function groupDatesByWeeks(dates: readonly string[]): string[][] {
    if (dates.length === 0) return [];
    const padded = [...Array<string>(weekdayOf(dates[0])).fill(''), ...dates];
    const weeks: string[][] = [];
    for (let i = 0; i < padded.length; i += 7) {
        weeks.push(padded.slice(i, i + 7));
    }
    const lastWeek = weeks[weeks.length - 1];
    while (lastWeek.length < 7) lastWeek.push('');
    return weeks;
}

const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

/** 月の変わり目の週にラベルを付ける（Webと同一）。 */
export function getMonthLabels(weeks: readonly (readonly string[])[]): { label: string; weekIndex: number }[] {
    const labels: { label: string; weekIndex: number }[] = [];
    let lastMonth = '';
    weeks.forEach((week, weekIndex) => {
        const validDate = week.find((date) => date !== '');
        if (!validDate) return;
        const month = validDate.substring(5, 7);
        if (month !== lastMonth) {
            labels.push({ label: MONTH_LABELS[Number(month) - 1], weekIndex });
            lastMonth = month;
        }
    });
    return labels;
}

// ─── 集計 ─────────────────────────────────────────────────────

/**
 * 完了タスク・完了サブタスクから、JST日付ごとの獲得XPを導出する。
 * XP額は報酬ルール（優先度XP・サブタスクは半分）と同一。
 */
export function buildTaskXpByDate(tasks: readonly Task[]): Record<string, number> {
    const xpByDate: Record<string, number> = {};
    const add = (date: string | null, xp: number): void => {
        if (date === null) return;
        xpByDate[date] = (xpByDate[date] ?? 0) + xp;
    };

    for (const task of tasks) {
        if (task.completed) {
            add(isoToJstYmd(task.completedAt), XP_CONFIG.REWARD_BY_PRIORITY[task.priority]);
        }
        for (const subtask of task.subtasks) {
            if (subtask.completed) {
                add(isoToJstYmd(subtask.completedAt), getSubtaskRewardXp(task.priority));
            }
        }
    }
    return xpByDate;
}

export interface HabitDayActivity {
    /** その日に達成した習慣数 */
    count: number;
    /** その日の全習慣達成（日次ボーナスと同じ判定） */
    allComplete: boolean;
}

/** 習慣レコードから、日付ごとの達成数と全達成フラグを導出する。 */
export function buildHabitActivityByDate(
    habits: readonly Habit[],
    records: readonly HabitDailyRecord[],
): Record<string, HabitDayActivity> {
    const activity: Record<string, HabitDayActivity> = {};
    const dates = new Set(records.filter((record) => record.completed).map((record) => record.date));
    for (const date of dates) {
        activity[date] = {
            count: records.filter((record) => record.date === date && record.completed).length,
            allComplete: areAllHabitsComplete(habits, records, date),
        };
    }
    return activity;
}
