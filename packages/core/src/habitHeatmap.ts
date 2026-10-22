import type { Habit, HabitDailyRecord, RestDay } from './habits.ts';
import { shiftDate } from './dates.ts';

export type HabitHeatmapStatus =
    'before-created' | 'completed' | 'rest' | 'missed' | 'pending';
export interface HabitHeatmapDay {
    date: string;
    status: HabitHeatmapStatus;
    memo: string;
}
export interface HabitHeatmapData {
    days: HabitHeatmapDay[];
    completedCount: number;
    activeDayCount: number;
    completionRate: number | null;
}

/** Read-only adjacent dates; an expired/unselected date starts navigation from today. */
export function getHabitHistoryNavigation(days: readonly HabitHeatmapDay[], selectedDate: string | null) {
    const selectedIndex = days.findIndex((day) => day.date === selectedDate);
    const index = selectedIndex < 0 ? days.length - 1 : selectedIndex;
    return {
        selectedDay: selectedIndex < 0 ? null : days[selectedIndex],
        previousDate: days[index - 1]?.date ?? null,
        nextDate: days[index + 1]?.date ?? null,
    };
}

/** Read-only presentation model shared by the Web and native history views. */
export function buildHabitHeatmapData(
    habit: Habit,
    records: readonly HabitDailyRecord[],
    restDays: readonly RestDay[],
    today: string,
    dayCount: number,
): HabitHeatmapData {
    const safeDayCount = Math.max(1, Math.floor(dayCount));
    const createdDate = habit.createdAt.split('T')[0];
    const recordsByDate = new Map(
        records
            .filter((record) => record.habitId === habit.id)
            .map((record) => [record.date, record]),
    );
    const restDates = new Set(
        restDays.filter((day) => day.isRest).map((day) => day.date),
    );
    let completedCount = 0;
    let activeDayCount = 0;
    const days = Array.from(
        { length: safeDayCount },
        (_, index): HabitHeatmapDay => {
            const date = shiftDate(today, index - safeDayCount + 1);
            const record = recordsByDate.get(date);
            let status: HabitHeatmapStatus;
            if (date < createdDate) status = 'before-created';
            else if (restDates.has(date)) status = 'rest';
            else if (record?.completed) {
                status = 'completed';
                completedCount += 1;
                activeDayCount += 1;
            } else {
                status = date === today ? 'pending' : 'missed';
                activeDayCount += 1;
            }
            return { date, status, memo: record?.memo ?? '' };
        },
    );
    return {
        days,
        completedCount,
        activeDayCount,
        completionRate:
            activeDayCount === 0
                ? null
                : Math.round((completedCount / activeDayCount) * 100),
    };
}
