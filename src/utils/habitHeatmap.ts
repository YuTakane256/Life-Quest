import type { Habit, HabitDailyRecord, RestDay } from '../types';
import { shiftDate, toIsoDatePart } from './dateUtils';

export type HabitHeatmapStatus = 'before-created' | 'completed' | 'rest' | 'missed' | 'pending';

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

export function buildHabitHeatmapData(
    habit: Habit,
    dailyRecords: HabitDailyRecord[],
    restDays: RestDay[],
    today: string,
    dayCount: number,
): HabitHeatmapData {
    const safeDayCount = Math.max(1, Math.floor(dayCount));
    const createdDate = toIsoDatePart(habit.createdAt);
    const recordsByDate = new Map(
        dailyRecords
            .filter((record) => record.habitId === habit.id)
            .map((record) => [record.date, record]),
    );
    const restDates = new Set(
        restDays.filter((restDay) => restDay.isRest).map((restDay) => restDay.date),
    );

    let completedCount = 0;
    let activeDayCount = 0;
    const days = Array.from({ length: safeDayCount }, (_, index): HabitHeatmapDay => {
        const date = shiftDate(today, index - safeDayCount + 1);
        const record = recordsByDate.get(date);
        let status: HabitHeatmapStatus;

        if (date < createdDate) {
            status = 'before-created';
        } else if (restDates.has(date)) {
            status = 'rest';
        } else if (record?.completed) {
            status = 'completed';
            completedCount += 1;
            activeDayCount += 1;
        } else {
            status = date === today ? 'pending' : 'missed';
            activeDayCount += 1;
        }

        return { date, status, memo: record?.memo ?? '' };
    });

    return {
        days,
        completedCount,
        activeDayCount,
        completionRate: activeDayCount === 0 ? null : Math.round((completedCount / activeDayCount) * 100),
    };
}
