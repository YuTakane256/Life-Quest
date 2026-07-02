import { HABIT_LIMITS, sanitizeHabitCollection, sanitizeHabitRecords, type Habit, type HabitDailyRecord, type RestDay } from './habits';
import {
    GAME_STATE_LIMITS,
    sanitizeGameStateSnapshot,
    sanitizeRewardLedger,
    type CharacterState,
    type RewardLedger,
} from './gameState';
import type { Equipment } from './equipment';
import type { ChestReward } from './rewards';
import { sanitizeTaskCollection, type Task } from './tasks';
import { clampString } from './validation';

export const SYNC_SNAPSHOT_VERSION = 1 as const;

export const SYNC_SNAPSHOT_LIMITS = {
    maxRestDays: 3_660,
    maxAllCompleteDates: 3_660,
    maxActiveTitleLength: 40,
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

export interface CanonicalDebuffState {
    active: boolean;
    expiresAt: string | null;
}

export interface CanonicalBattleProgress {
    battleUnlocked: boolean;
    currentStage: number;
    maxClearedStage: number;
}

export interface CanonicalGameSnapshot {
    schemaVersion: typeof SYNC_SNAPSHOT_VERSION;
    character: CharacterState;
    equipment: Equipment[];
    chestQueue: ChestReward[];
    gachaCount: number;
    rewardLedger: RewardLedger;
    activeTitle: string | null;
    debuff: CanonicalDebuffState;
    battleProgress: CanonicalBattleProgress;
}

export interface LegacyGameSnapshotSources {
    game: unknown;
    title?: unknown;
    tasks?: unknown;
    habits?: unknown;
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

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.min(max, Math.max(min, Math.floor(value)))
        : fallback;
}

function sanitizeActiveTitle(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const title = clampString(value.trim(), SYNC_SNAPSHOT_LIMITS.maxActiveTitleLength);
    return title || null;
}

function sanitizeDebuff(value: unknown): CanonicalDebuffState {
    if (!isRecord(value) || value.active !== true || typeof value.expiresAt !== 'string') {
        return { active: false, expiresAt: null };
    }
    const timestamp = new Date(value.expiresAt).getTime();
    if (!Number.isFinite(timestamp)) return { active: false, expiresAt: null };
    return { active: true, expiresAt: new Date(timestamp).toISOString() };
}

function sanitizeBattleProgress(value: unknown): CanonicalBattleProgress {
    if (!isRecord(value)) {
        return { battleUnlocked: false, currentStage: 1, maxClearedStage: 0 };
    }
    return {
        battleUnlocked: value.battleUnlocked === true,
        currentStage: boundedInteger(value.currentStage, 1, 1, Number.MAX_SAFE_INTEGER),
        maxClearedStage: boundedInteger(value.maxClearedStage, 0, 0, Number.MAX_SAFE_INTEGER),
    };
}

function mergeRecentStrings(values: readonly unknown[], limit: number): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (let index = values.length - 1; index >= 0 && merged.length < limit; index--) {
        const value = values[index];
        if (typeof value !== 'string' || value === '' || seen.has(value)) continue;
        seen.add(value);
        merged.push(value);
    }
    return merged.reverse();
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

export function sanitizeCanonicalGameSnapshot(value: unknown): CanonicalGameSnapshot {
    const record = readRecord(value);
    const game = sanitizeGameStateSnapshot(record);
    const rawBattleProgress = isRecord(record.battleProgress) ? record.battleProgress : record.battle;

    return {
        schemaVersion: SYNC_SNAPSHOT_VERSION,
        ...game,
        rewardLedger: {
            ...game.rewardLedger,
            habitBonusDates: sanitizeDateList(
                game.rewardLedger.habitBonusDates,
                GAME_STATE_LIMITS.maxHabitBonusDates,
            ),
        },
        activeTitle: sanitizeActiveTitle(record.activeTitle),
        debuff: sanitizeDebuff(record.debuff),
        battleProgress: sanitizeBattleProgress(rawBattleProgress),
    };
}

/**
 * Converts Web or Mobile game persistence into the canonical shape. Optional
 * task/habit sources add migration evidence so completed work is not rewarded
 * again after the first cross-platform import. Legacy Web data has no per-item
 * reward ledger, so migration conservatively treats completed work as claimed;
 * this favors preventing duplicate XP over reconstructing interrupted grants.
 */
export function convertLegacyGameSnapshot(
    sources: LegacyGameSnapshotSources,
): CanonicalGameSnapshot {
    const canonical = sanitizeCanonicalGameSnapshot(sources.game);
    const taskSnapshot = convertLegacyTaskSnapshot(sources.tasks);
    const habitSnapshot = convertLegacyHabitSnapshot(sources.habits);
    const titleRecord = readRecord(sources.title);
    const completedTaskIds = taskSnapshot.tasks
        .filter((task) => task.completed)
        .map((task) => task.id);
    const completedSubtaskIds = taskSnapshot.tasks.flatMap((task) =>
        task.subtasks.filter((subtask) => subtask.completed).map((subtask) => subtask.id)
    );

    return {
        ...canonical,
        activeTitle: sanitizeActiveTitle(titleRecord.activeTitle) ?? canonical.activeTitle,
        rewardLedger: sanitizeRewardLedger({
            rewardedTaskIds: mergeRecentStrings(
                [...canonical.rewardLedger.rewardedTaskIds, ...completedTaskIds],
                GAME_STATE_LIMITS.maxRewardedTaskIds,
            ),
            rewardedSubtaskIds: mergeRecentStrings(
                [...canonical.rewardLedger.rewardedSubtaskIds, ...completedSubtaskIds],
                GAME_STATE_LIMITS.maxRewardedSubtaskIds,
            ),
            habitBonusDates: sanitizeDateList(
                [...canonical.rewardLedger.habitBonusDates, ...habitSnapshot.allCompleteDates],
                GAME_STATE_LIMITS.maxHabitBonusDates,
            ),
        }),
    };
}
