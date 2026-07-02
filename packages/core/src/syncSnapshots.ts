import { HABIT_LIMITS, sanitizeHabitCollection, sanitizeHabitRecords, type Habit, type HabitDailyRecord, type RestDay } from './habits';
import { sanitizeTaskCollection, type Task } from './tasks';

export const SYNC_SNAPSHOT_VERSION = 1 as const;

export const SYNC_SNAPSHOT_LIMITS = {
    maxRestDays: 3_660,
    maxAllCompleteDates: 3_660,
} as const;

export interface CanonicalTaskSnapshot {
    schemaVersion: typeof SYNC_SNAPSHOT_VERSION;
    tasks: Task[];
}

export interface CanonicalHabitSnapshot {
    schemaVersion: typeof SYNC_SNAPSHOT_VERSION;
    habits: Habit[];
    dailyRecords: HabitDailyRecord[];
    restDays: RestDay[];
    /** Dates on which completing every active habit made the daily reward eligible. */
    allCompleteDates: string[];
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrapPersistedState(value: unknown): unknown {
    if (!isRecord(value) || !isRecord(value.state)) return value;
    return value.state;
}

function isValidYmd(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

function sanitizeDateList(value: unknown, limit: number): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const dates: string[] = [];
    for (let index = value.length - 1; index >= 0 && dates.length < limit; index--) {
        const candidate = value[index];
        if (!isValidYmd(candidate) || seen.has(candidate)) continue;
        seen.add(candidate);
        dates.push(candidate);
    }
    return dates.reverse();
}

function sanitizeRestDays(value: unknown): RestDay[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const restDays: RestDay[] = [];
    for (
        let index = value.length - 1;
        index >= 0 && restDays.length < SYNC_SNAPSHOT_LIMITS.maxRestDays;
        index--
    ) {
        const candidate = value[index];
        if (!isRecord(candidate) || !isValidYmd(candidate.date) || seen.has(candidate.date)) continue;
        seen.add(candidate.date);
        restDays.push({
            date: candidate.date,
            isRest: candidate.isRest === true,
        });
    }
    return restDays.reverse();
}

function readRecord(value: unknown): UnknownRecord {
    const state = unwrapPersistedState(value);
    return isRecord(state) ? state : {};
}

export function sanitizeCanonicalTaskSnapshot(value: unknown): CanonicalTaskSnapshot {
    const record = readRecord(value);
    return {
        schemaVersion: SYNC_SNAPSHOT_VERSION,
        tasks: sanitizeTaskCollection(record.tasks),
    };
}

/** Converts either the Web or Mobile Zustand persist envelope into the canonical task shape. */
export function convertLegacyTaskSnapshot(value: unknown): CanonicalTaskSnapshot {
    return sanitizeCanonicalTaskSnapshot(value);
}

export function sanitizeCanonicalHabitSnapshot(value: unknown): CanonicalHabitSnapshot {
    const record = readRecord(value);
    const habits = sanitizeHabitCollection(record.habits);
    const habitIds = new Set(habits.map((habit) => habit.id));
    const rawRecords = Array.isArray(record.dailyRecords) ? record.dailyRecords : record.records;
    const validDateRecords = Array.isArray(rawRecords)
        ? rawRecords.filter((candidate) => isRecord(candidate) && isValidYmd(candidate.date))
        : rawRecords;
    const rawAllCompleteDates = Array.isArray(record.allCompleteDates)
        ? record.allCompleteDates
        : Array.isArray(record.allCompleteRewardDates)
            ? record.allCompleteRewardDates
            : record.rewardEligibleDates;

    return {
        schemaVersion: SYNC_SNAPSHOT_VERSION,
        habits,
        dailyRecords: sanitizeHabitRecords(validDateRecords, habitIds)
            .slice(-HABIT_LIMITS.maxRecords),
        restDays: sanitizeRestDays(record.restDays),
        allCompleteDates: sanitizeDateList(
            rawAllCompleteDates,
            SYNC_SNAPSHOT_LIMITS.maxAllCompleteDates,
        ),
    };
}

/** Converts either the Web or Mobile Zustand persist envelope into the canonical habit shape. */
export function convertLegacyHabitSnapshot(value: unknown): CanonicalHabitSnapshot {
    return sanitizeCanonicalHabitSnapshot(value);
}
