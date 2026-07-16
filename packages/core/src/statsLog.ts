/**
 * 統計ログ（日別タスクXP・習慣達成状況）の共有ルール。
 * Web/Mobileともに実績（activeDays/perfectDays）の算出元となる、
 * クラウド同期対象外の端末ローカルな履歴。完了したタスク・習慣の記録が
 * 後から削除されても、いつ実績を達成したかの事実は変わらないため、
 * 現存データからの再構築ではなくこのログへの追記で運用する。
 */
import { isValidYmdDate, type Task } from './tasks.ts';
import type { Habit, HabitDailyRecord } from './habits.ts';
import { buildHabitActivityByDate, buildTaskXpByDate, type HabitDayActivity } from './stats.ts';

export type TaskXpLog = Record<string, number>;
export type HabitLog = Record<string, HabitDayActivity>;

export const MAX_STATS_LOG_ENTRIES = 3660;
export const MAX_STATS_DAILY_VALUE = Number.MAX_SAFE_INTEGER;

function nonNegativeInteger(value: number): number | null {
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.min(MAX_STATS_DAILY_VALUE, Math.floor(value));
}

/** エントリ数が上限を超えたら、日付の新しい方から上限件数だけ残す。 */
export function keepRecentEntries<T>(log: Record<string, T>): Record<string, T> {
    const entries = Object.entries(log);
    if (entries.length <= MAX_STATS_LOG_ENTRIES) return log;
    return Object.fromEntries(
        entries
            .sort(([left], [right]) => right.localeCompare(left))
            .slice(0, MAX_STATS_LOG_ENTRIES)
    );
}

export function sanitizeTaskXpLog(raw: unknown): TaskXpLog {
    if (typeof raw !== 'object' || raw === null) return {};
    const out: TaskXpLog = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!isValidYmdDate(key) || typeof value !== 'number') continue;
        const safeValue = nonNegativeInteger(value);
        if (safeValue !== null) out[key] = safeValue;
    }
    return keepRecentEntries(out);
}

export function sanitizeHabitLog(raw: unknown): HabitLog {
    if (typeof raw !== 'object' || raw === null) return {};
    const out: HabitLog = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!isValidYmdDate(key) || typeof value !== 'object' || value === null) continue;
        const entry = value as Record<string, unknown>;
        if (typeof entry.count !== 'number' || typeof entry.allComplete !== 'boolean') continue;
        const safeCount = nonNegativeInteger(entry.count);
        if (safeCount !== null) out[key] = { count: safeCount, allComplete: entry.allComplete };
    }
    return keepRecentEntries(out);
}

/** 指定日のタスクXPを加算する。不正な日付・XPは無視する。 */
export function appendTaskXp(log: TaskXpLog, date: string, xp: number): TaskXpLog {
    if (!isValidYmdDate(date)) return log;
    const safeXp = nonNegativeInteger(xp);
    if (safeXp === null) return log;
    return keepRecentEntries({
        ...log,
        [date]: Math.min(MAX_STATS_DAILY_VALUE, (nonNegativeInteger(log[date] ?? 0) ?? 0) + safeXp),
    });
}

/** 指定日の習慣達成状況を記録する（上書き）。不正な日付・件数は無視する。 */
export function appendHabitActivity(
    log: HabitLog,
    date: string,
    count: number,
    allComplete: boolean,
): HabitLog {
    if (!isValidYmdDate(date)) return log;
    const safeCount = nonNegativeInteger(count);
    if (safeCount === null) return log;
    return keepRecentEntries({ ...log, [date]: { count: safeCount, allComplete } });
}

/**
 * 端末ローカルの統計ログとクラウド（stats_dailyテーブル）由来の統計ログを合成する。
 * 日付ごとにtaskXpは最大値、habitLogはcount最大・allCompleteはORを取る単調マージで、
 * 呼び出し順序やプル回数に依らず結果が一致する（冪等・可換）。値が小さい側を
 * 「取り消す」ことはしない設計方針は、appendTaskXp/appendHabitActivityの
 * 追記オンリー運用と同じ（削除で実績を後退させない）。
 * habitLogのallComplete/countは「その日一度でも到達した最大値」を表すことになる点に注意。
 */
export function mergeTaskXpLogs(local: TaskXpLog, cloud: TaskXpLog): TaskXpLog {
    const merged: TaskXpLog = { ...local };
    for (const [date, xp] of Object.entries(cloud)) {
        merged[date] = Math.max(merged[date] ?? 0, xp);
    }
    return keepRecentEntries(merged);
}

export function mergeHabitLogs(local: HabitLog, cloud: HabitLog): HabitLog {
    const merged: HabitLog = { ...local };
    for (const [date, entry] of Object.entries(cloud)) {
        const existing = merged[date];
        merged[date] = {
            count: Math.max(existing?.count ?? 0, entry.count),
            allComplete: (existing?.allComplete ?? false) || entry.allComplete,
        };
    }
    return keepRecentEntries(merged);
}

/**
 * 永続ログが存在しない端末（初回起動・旧バージョンからの移行）向けに、
 * 現存するtasks/habits/recordsから統計ログを再構築する。
 * 以後は再構築ではなくappendTaskXp/appendHabitActivityで追記していくため、
 * これは初回シードのみに使う。
 */
export function seedStatsLogFromCollections(
    tasks: readonly Task[],
    habits: readonly Habit[],
    records: readonly HabitDailyRecord[],
): { taskXpLog: TaskXpLog; habitLog: HabitLog } {
    return {
        taskXpLog: sanitizeTaskXpLog(buildTaskXpByDate(tasks)),
        habitLog: sanitizeHabitLog(buildHabitActivityByDate(habits, records)),
    };
}
