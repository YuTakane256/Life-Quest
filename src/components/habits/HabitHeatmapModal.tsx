import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Flame, X } from 'lucide-react';
import type { Habit, HabitDailyRecord, RestDay } from '../../types';
import { HABIT_HISTORY_RETENTION_DAYS } from '../../stores/useHabitStore';
import { buildHabitHeatmapData, type HabitHeatmapDay, type HabitHeatmapStatus } from '../../utils/habitHeatmap';
import { getTodayJST } from '../../utils/dateUtils';
import { useModalEscape } from '../../hooks/useModalEscape';

const STATUS_LABELS: Record<HabitHeatmapStatus, string> = {
    'before-created': '作成前',
    completed: '達成',
    rest: 'お休み',
    missed: '未達成',
    pending: '未記録',
};

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

function getStatusStyle(status: HabitHeatmapStatus, color: string) {
    if (status === 'completed') return { backgroundColor: color, borderColor: color };
    if (status === 'rest') return { backgroundColor: 'var(--color-accent-sky)', borderColor: 'var(--color-accent-sky)', opacity: 0.55 };
    if (status === 'pending') return { backgroundColor: 'var(--color-bg-secondary)', borderColor: color };
    if (status === 'before-created') return { backgroundColor: 'transparent', borderColor: 'var(--color-border-default)', opacity: 0.35 };
    return { backgroundColor: 'var(--color-bg-secondary)', borderColor: 'var(--color-border-default)' };
}

function formatDate(date: string): string {
    return new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' })
        .format(new Date(`${date}T00:00:00+09:00`));
}

export function HabitHeatmapModal({
    habit,
    dailyRecords,
    restDays,
    color,
    streak,
    onClose,
}: {
    habit: Habit;
    dailyRecords: HabitDailyRecord[];
    restDays: RestDay[];
    color: string;
    streak: number;
    onClose: () => void;
}) {
    const [selectedDay, setSelectedDay] = useState<HabitHeatmapDay | null>(null);
    const heatmapScrollRef = useRef<HTMLDivElement>(null);
    useModalEscape(true, onClose);

    const heatmap = useMemo(
        () => buildHabitHeatmapData(habit, dailyRecords, restDays, getTodayJST(), HABIT_HISTORY_RETENTION_DAYS),
        [dailyRecords, habit, restDays],
    );
    const firstWeekday = new Date(`${heatmap.days[0].date}T00:00:00+09:00`).getDay();
    const paddedDays: Array<HabitHeatmapDay | null> = [
        ...Array<HabitHeatmapDay | null>(firstWeekday).fill(null),
        ...heatmap.days,
    ];

    useEffect(() => {
        const container = heatmapScrollRef.current;
        if (container) container.scrollLeft = container.scrollWidth;
    }, []);

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 px-4 py-6"
            onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="habit-heatmap-title"
                className="w-full max-w-2xl rounded-xl p-5 animate-scale-in"
                style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
            >
                <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                            <CalendarDays size={18} style={{ color }} />
                            <h2 id="habit-heatmap-title" className="text-lg font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{habit.name}</h2>
                        </div>
                        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>過去{HABIT_HISTORY_RETENTION_DAYS}日の達成履歴</p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="履歴を閉じる" className="p-2 rounded-lg flex-shrink-0" style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg-secondary)' }}>
                        <X size={18} />
                    </button>
                </div>

                <div className="grid grid-cols-3 gap-px mb-5 overflow-hidden rounded-lg" style={{ backgroundColor: 'var(--color-border-default)', border: '1px solid var(--color-border-default)' }}>
                    <div className="px-3 py-2.5" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                        <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>達成</div>
                        <div className="text-lg font-bold" style={{ color }}>{heatmap.completedCount}<span className="text-xs ml-0.5">日</span></div>
                    </div>
                    <div className="px-3 py-2.5" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                        <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>達成率</div>
                        <div className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>{heatmap.completionRate ?? 0}<span className="text-xs ml-0.5">%</span></div>
                    </div>
                    <div className="px-3 py-2.5" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                        <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>現在</div>
                        <div className="text-lg font-bold flex items-center gap-1" style={{ color: 'var(--color-accent-gold)' }}><Flame size={15} />{streak}<span className="text-xs">日</span></div>
                    </div>
                </div>

                <div ref={heatmapScrollRef} className="overflow-x-auto pb-2">
                    <div className="flex gap-1 min-w-max">
                        <div className="grid grid-rows-7 gap-1 mr-1">
                            {WEEKDAY_LABELS.map((label) => <span key={label} className="w-4 h-4 text-[9px] flex items-center" style={{ color: 'var(--color-text-muted)' }}>{label}</span>)}
                        </div>
                        <div className="grid grid-rows-7 grid-flow-col gap-1">
                            {paddedDays.map((day, index) => day ? (
                                <button
                                    key={day.date}
                                    type="button"
                                    aria-label={`${formatDate(day.date)}: ${STATUS_LABELS[day.status]}`}
                                    title={`${day.date} ${STATUS_LABELS[day.status]}`}
                                    onClick={() => setSelectedDay(day)}
                                    className="w-4 h-4 rounded-[3px] border transition-transform hover:scale-125"
                                    style={getStatusStyle(day.status, color)}
                                />
                            ) : <span key={`pad-${index}`} className="w-4 h-4" />)}
                        </div>
                    </div>
                </div>

                <div className="min-h-[44px] mt-3 px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>
                    {selectedDay ? (
                        <><strong style={{ color: 'var(--color-text-primary)' }}>{formatDate(selectedDay.date)}</strong><span className="ml-2">{STATUS_LABELS[selectedDay.status]}</span>{selectedDay.memo && <div className="mt-1" style={{ color: 'var(--color-text-muted)' }}>{selectedDay.memo}</div>}</>
                    ) : '日付を押すと記録の詳細を確認できます'
                    }
                </div>

                <div className="flex items-center justify-end gap-3 mt-3 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                    <span className="flex items-center gap-1"><i className="w-3 h-3 rounded-[3px]" style={{ backgroundColor: color }} />達成</span>
                    <span className="flex items-center gap-1"><i className="w-3 h-3 rounded-[3px]" style={{ backgroundColor: 'var(--color-accent-sky)', opacity: 0.55 }} />お休み</span>
                    <span className="flex items-center gap-1"><i className="w-3 h-3 rounded-[3px]" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)' }} />未達成</span>
                </div>
            </div>
        </div>
    );
}
