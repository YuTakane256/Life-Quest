import { clampString } from './validation';

export interface Habit {
    id: string;
    name: string;
    categoryId: string;
    createdAt: string;
}

export interface HabitDailyRecord {
    habitId: string;
    date: string;
    completed: boolean;
    memo: string;
}

export interface RestDay {
    date: string;
    isRest: boolean;
}

export const HABIT_LIMITS = {
    maxHabits: 500,
    maxRecords: 50_000,
    maxNameLength: 200,
    maxCategoryIdLength: 50,
    maxMemoLength: 500,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createHabit(id: string, name: string, categoryId: string, now: string): Habit | null {
    const safeName = clampString(name.trim(), HABIT_LIMITS.maxNameLength);
    if (!id || !safeName || !now) return null;
    return {
        id,
        name: safeName,
        categoryId: clampString(categoryId, HABIT_LIMITS.maxCategoryIdLength) || 'general',
        createdAt: now,
    };
}

export function toggleHabitDailyRecord(
    records: readonly HabitDailyRecord[],
    habitId: string,
    date: string,
): HabitDailyRecord[] {
    const existing = records.find((record) => record.habitId === habitId && record.date === date);
    if (!existing) {
        return [...records, { habitId, date, completed: true, memo: '' }];
    }
    return records.map((record) => record === existing
        ? { ...record, completed: !record.completed }
        : record
    );
}

/** ISO日時のYYYY-MM-DD部分。日付として読めなければ null。 */
function toYmdOrNull(value: string): string | null {
    const ymd = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
}

/**
 * 指定日にすべての習慣が完了しているか。習慣が1つも無い場合は false。
 * 指定日より後に作成された習慣は達成の必要なしとみなす（Webと同一ルール）。
 */
export function areAllHabitsComplete(
    habits: readonly Habit[],
    records: readonly HabitDailyRecord[],
    date: string,
): boolean {
    if (habits.length === 0) return false;
    const completedIds = new Set(
        records
            .filter((record) => record.date === date && record.completed)
            .map((record) => record.habitId),
    );
    return habits.every((habit) => {
        const createdDate = toYmdOrNull(habit.createdAt);
        if (createdDate !== null && date < createdDate) return true;
        return completedIds.has(habit.id);
    });
}

export function removeHabitData(
    habits: readonly Habit[],
    records: readonly HabitDailyRecord[],
    habitId: string,
): { habits: Habit[]; records: HabitDailyRecord[] } {
    return {
        habits: habits.filter((habit) => habit.id !== habitId),
        records: records.filter((record) => record.habitId !== habitId),
    };
}

export function sanitizeHabitCollection(value: unknown): Habit[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value
        .filter(isRecord)
        .filter((habit) => typeof habit.id === 'string' && typeof habit.name === 'string')
        .map((habit) => ({
            id: habit.id as string,
            name: clampString(habit.name as string, HABIT_LIMITS.maxNameLength),
            categoryId: typeof habit.categoryId === 'string'
                ? clampString(habit.categoryId, HABIT_LIMITS.maxCategoryIdLength)
                : 'general',
            createdAt: typeof habit.createdAt === 'string' ? habit.createdAt : '',
        }))
        .filter((habit) => {
            if (!habit.name || seen.has(habit.id)) return false;
            seen.add(habit.id);
            return true;
        })
        .slice(-HABIT_LIMITS.maxHabits);
}

export function sanitizeHabitRecords(value: unknown, habitIds: ReadonlySet<string>): HabitDailyRecord[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value
        .filter(isRecord)
        .filter((record) => typeof record.habitId === 'string' && typeof record.date === 'string')
        .map((record) => ({
            habitId: record.habitId as string,
            date: record.date as string,
            completed: record.completed === true,
            memo: typeof record.memo === 'string' ? clampString(record.memo, HABIT_LIMITS.maxMemoLength) : '',
        }))
        .filter((record) => {
            const key = `${record.habitId}:${record.date}`;
            if (!habitIds.has(record.habitId) || seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(-HABIT_LIMITS.maxRecords);
}

// ─── カテゴリ ─────────────────────────────────────────────────

export interface HabitCategory {
    id: string;
    name: string;
    /** 絵文字アイコン */
    icon: string;
    /** HEX カラーコード */
    color: string;
}

export const HABIT_CATEGORIES: readonly HabitCategory[] = [
    { id: 'health',    name: '健康',     icon: '💪', color: '#10b981' },
    { id: 'study',     name: '勉強',     icon: '📚', color: '#3b82f6' },
    { id: 'work',      name: '仕事',     icon: '💼', color: '#8b5cf6' },
    { id: 'lifestyle', name: '生活',     icon: '🏠', color: '#f59e0b' },
    { id: 'mindset',   name: 'マインド', icon: '🧘', color: '#ec4899' },
    { id: 'creative',  name: 'クリエイティブ', icon: '🎨', color: '#f97316' },
    { id: 'social',    name: '社交',     icon: '🤝', color: '#06b6d4' },
    { id: 'other',     name: 'その他',   icon: '📌', color: '#64748b' },
];

export const DEFAULT_HABIT_CATEGORY_ID = 'other';

export function getHabitCategoryById(id: string): HabitCategory | undefined {
    return HABIT_CATEGORIES.find((category) => category.id === id);
}

export function getHabitCategoryByIdOrDefault(id: unknown): HabitCategory {
    const fallback = getHabitCategoryById(DEFAULT_HABIT_CATEGORY_ID) ?? HABIT_CATEGORIES[0];
    if (typeof id !== 'string') return fallback;
    return getHabitCategoryById(id) ?? fallback;
}

// ─── お休み日 ─────────────────────────────────────────────────

const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 指定日をお休み日にする。無効な日付なら変更なし。 */
export function markRestDay(
    restDays: readonly RestDay[],
    date: string,
    maxRestDays: number,
): RestDay[] {
    if (!YMD_PATTERN.test(date)) return [...restDays];
    const existing = restDays.find((restDay) => restDay.date === date);
    if (existing) {
        return restDays.map((restDay) => restDay.date === date ? { ...restDay, isRest: true } : restDay);
    }
    return [...restDays, { date, isRest: true }].slice(-maxRestDays);
}

export function isRestDayOn(restDays: readonly RestDay[], date: string): boolean {
    return restDays.some((restDay) => restDay.date === date && restDay.isRest);
}

/** 永続化由来のお休み日リストを正規化する（型検証・日付重複排除・上限cap）。 */
export function sanitizeRestDays(value: unknown, maxRestDays: number): RestDay[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const restDays: RestDay[] = [];
    for (let index = value.length - 1; index >= 0 && restDays.length < maxRestDays; index--) {
        const candidate: unknown = value[index];
        if (!isRecord(candidate) || typeof candidate.date !== 'string'
            || !YMD_PATTERN.test(candidate.date) || seen.has(candidate.date)) continue;
        seen.add(candidate.date);
        restDays.push({ date: candidate.date, isRest: candidate.isRest === true });
    }
    return restDays.reverse();
}

// ─── 連続記録・達成率 ─────────────────────────────────────────

function shiftYmd(date: string, days: number): string {
    const [year, month, day] = date.split('-').map(Number);
    const shifted = new Date(Date.UTC(year, month - 1, day + days));
    const y = shifted.getUTCFullYear();
    const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const d = String(shifted.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export interface HabitStatsInput {
    habit: Habit;
    records: readonly HabitDailyRecord[];
    restDays: readonly RestDay[];
    /** 今日 (YYYY-MM-DD, JST) */
    today: string;
}

/** ストリーク計算で遡る最大日数（Webのヒートマップ保持期間と同じ） */
export const HABIT_STREAK_LOOKBACK_DAYS = 180;

/**
 * 現在の連続達成日数。今日から遡り、お休み日はスキップ（途切れず・数えず）、
 * 今日がまだ未完了でも途切れ扱いにしない。作成日より前へは遡らない（Webと同一ルール）。
 */
export function getHabitStreak(input: HabitStatsInput): number {
    const { habit, records, restDays, today } = input;
    const createdDate = toYmdOrNull(habit.createdAt);
    let streak = 0;
    let cursor = today;

    for (let i = 0; i <= HABIT_STREAK_LOOKBACK_DAYS; i++) {
        if (createdDate !== null && cursor < createdDate) break;

        if (isRestDayOn(restDays, cursor)) {
            cursor = shiftYmd(cursor, -1);
            continue;
        }

        const completed = records.some(
            (record) => record.habitId === habit.id && record.date === cursor && record.completed,
        );
        if (completed) {
            streak++;
        } else if (cursor !== today) {
            break;
        }
        cursor = shiftYmd(cursor, -1);
    }
    return streak;
}

/**
 * 過去30日の達成率(%)。お休み日と作成前の日は分母に含めない。
 * 対象日が1日も無ければ null（Webと同一ルール）。
 */
export function getHabitCompletionRate(input: HabitStatsInput, windowDays = 30): number | null {
    const { habit, records, restDays, today } = input;
    const createdDate = toYmdOrNull(habit.createdAt);
    let total = 0;
    let completed = 0;

    for (let i = 0; i < windowDays; i++) {
        const date = shiftYmd(today, -i);
        if (createdDate !== null && date < createdDate) break;
        if (isRestDayOn(restDays, date)) continue;
        total++;
        if (records.some((record) => record.habitId === habit.id && record.date === date && record.completed)) {
            completed++;
        }
    }

    if (total === 0) return null;
    return Math.round((completed / total) * 100);
}
