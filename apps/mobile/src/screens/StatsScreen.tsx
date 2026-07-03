import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
    buildHabitActivityByDate,
    buildTaskXpByDate,
    generateDateRange,
    getHabitHeatmapLevel,
    getMonthLabels,
    getTaskHeatmapLevel,
    groupDatesByWeeks,
} from '@life-quest/core/stats';
import { useMobileHabitStore } from '../stores/useMobileHabitStore';
import { useMobileTaskStore } from '../stores/useMobileTaskStore';
import { getTodayJst } from '../utils/date';
import { theme } from '../theme/colors';

type HeatmapMode = 'tasks' | 'habits';

/** ヒートマップの表示期間（12週） */
const HEATMAP_DAYS = 84;

// 濃淡スケールはWebのStatsPageと同一（level 0 は背景色）
const TASK_COLORS = [theme.bg.secondary, 'rgba(99, 102, 241, 0.25)', 'rgba(99, 102, 241, 0.45)', 'rgba(99, 102, 241, 0.65)', 'rgba(99, 102, 241, 0.90)'];
const HABIT_COLORS = [theme.bg.secondary, 'rgba(16, 185, 129, 0.25)', 'rgba(16, 185, 129, 0.45)', 'rgba(16, 185, 129, 0.65)', 'rgba(16, 185, 129, 0.90)'];
const WEEKDAY_LABELS = ['', '月', '', '水', '', '金', ''];

export default function StatsScreen() {
    const tasks = useMobileTaskStore((state) => state.tasks);
    const habits = useMobileHabitStore((state) => state.habits);
    const records = useMobileHabitStore((state) => state.records);
    const [mode, setMode] = useState<HeatmapMode>('tasks');

    const today = getTodayJst();
    const taskXpByDate = useMemo(() => buildTaskXpByDate(tasks), [tasks]);
    const habitActivity = useMemo(() => buildHabitActivityByDate(habits, records), [habits, records]);

    const dates = useMemo(() => generateDateRange(HEATMAP_DAYS, today), [today]);
    const weeks = useMemo(() => groupDatesByWeeks(dates), [dates]);
    const monthLabels = useMemo(() => getMonthLabels(weeks), [weeks]);

    const last7Days = useMemo(() => generateDateRange(7, today), [today]);
    const weekXp = last7Days.reduce((sum, date) => sum + (taskXpByDate[date] ?? 0), 0);
    const last30Days = useMemo(() => generateDateRange(30, today), [today]);
    const allCompleteCount = last30Days.filter((date) => habitActivity[date]?.allComplete).length;
    const todayHabitCount = habitActivity[today]?.count ?? 0;

    const levelFor = (date: string): number => mode === 'tasks'
        ? getTaskHeatmapLevel(taskXpByDate[date] ?? 0)
        : getHabitHeatmapLevel(habitActivity[date]?.count ?? 0, habitActivity[date]?.allComplete ?? false);
    const colors = mode === 'tasks' ? TASK_COLORS : HABIT_COLORS;

    return (
        <SafeAreaView style={styles.safeArea}>
            <ScrollView contentContainerStyle={styles.scroll}>
                <View style={styles.content}>
                    <Text style={styles.title}>統計</Text>

                    {/* サマリー */}
                    <View style={styles.summaryRow}>
                        <SummaryCard label="今日のXP" value={`${taskXpByDate[today] ?? 0}`} />
                        <SummaryCard label="7日間XP" value={`${weekXp}`} />
                    </View>
                    <View style={styles.summaryRow}>
                        <SummaryCard label="今日の習慣" value={`${todayHabitCount}/${habits.length}`} />
                        <SummaryCard label="30日全達成" value={`${allCompleteCount}日`} />
                    </View>

                    {/* ヒートマップ */}
                    <View style={styles.card}>
                        <View style={styles.cardHeader}>
                            <Text style={styles.sectionTitle}>アクティビティ（12週）</Text>
                            <View style={styles.modeSwitch}>
                                {([['tasks', 'タスク'], ['habits', '習慣']] as const).map(([value, label]) => (
                                    <Pressable
                                        key={value}
                                        accessibilityRole="radio"
                                        accessibilityState={{ selected: mode === value }}
                                        accessibilityLabel={`ヒートマップを${label}に切り替える`}
                                        onPress={() => setMode(value)}
                                        style={[styles.modeSegment, mode === value && styles.modeSegmentActive]}
                                    >
                                        <Text style={[styles.modeText, mode === value && styles.modeTextActive]}>{label}</Text>
                                    </Pressable>
                                ))}
                            </View>
                        </View>

                        <View style={styles.monthRow}>
                            {monthLabels.map(({ label, weekIndex }) => (
                                <Text
                                    key={`${label}-${weekIndex}`}
                                    style={[styles.monthLabel, { left: 20 + weekIndex * 15 }]}
                                >
                                    {label}
                                </Text>
                            ))}
                        </View>

                        <View style={styles.heatmapRow}>
                            <View style={styles.weekdayColumn}>
                                {WEEKDAY_LABELS.map((label, index) => (
                                    <Text key={index} style={styles.weekdayLabel}>{label}</Text>
                                ))}
                            </View>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                <View style={styles.grid}>
                                    {weeks.map((week, weekIndex) => (
                                        <View key={weekIndex} style={styles.weekColumn}>
                                            {week.map((date, dayIndex) => (
                                                <View
                                                    key={`${weekIndex}-${dayIndex}`}
                                                    accessibilityLabel={date ? `${date} レベル${levelFor(date)}` : undefined}
                                                    style={[
                                                        styles.cell,
                                                        { backgroundColor: date ? colors[levelFor(date)] : 'transparent' },
                                                    ]}
                                                />
                                            ))}
                                        </View>
                                    ))}
                                </View>
                            </ScrollView>
                        </View>

                        <View style={styles.legendRow}>
                            <Text style={styles.legendText}>少</Text>
                            {colors.map((color, index) => (
                                <View key={index} style={[styles.cell, { backgroundColor: color }]} />
                            ))}
                            <Text style={styles.legendText}>多</Text>
                        </View>
                    </View>

                    <Text style={styles.note}>
                        タスクXPは完了したタスク・サブタスクから算出しています。削除したタスクは集計に含まれません。
                    </Text>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
    return (
        <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>{label}</Text>
            <Text style={styles.summaryValue}>{value}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: theme.bg.primary },
    scroll: { paddingBottom: 32 },
    content: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 20, gap: 12 },
    title: { color: theme.text.primary, fontSize: 28, fontWeight: '800', paddingTop: 20 },
    summaryRow: { flexDirection: 'row', gap: 12 },
    summaryCard: { flex: 1, backgroundColor: theme.bg.card, borderColor: theme.border.default, borderWidth: 1, borderRadius: 10, paddingVertical: 14, alignItems: 'center', gap: 4 },
    summaryLabel: { color: theme.text.muted, fontSize: 11, fontWeight: '700' },
    summaryValue: { color: theme.text.primary, fontSize: 20, fontWeight: '800' },
    card: { backgroundColor: theme.bg.card, borderColor: theme.border.default, borderWidth: 1, borderRadius: 10, padding: 14, gap: 8 },
    cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sectionTitle: { color: theme.text.primary, fontSize: 15, fontWeight: '800' },
    modeSwitch: { flexDirection: 'row', backgroundColor: theme.bg.secondary, borderRadius: 8, padding: 2 },
    modeSegment: { height: 28, paddingHorizontal: 12, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
    modeSegmentActive: { backgroundColor: theme.bg.cardHover },
    modeText: { color: theme.text.muted, fontSize: 12, fontWeight: '700' },
    modeTextActive: { color: theme.text.primary },
    monthRow: { height: 16 },
    monthLabel: { position: 'absolute', color: theme.text.muted, fontSize: 10, fontWeight: '700' },
    heatmapRow: { flexDirection: 'row', gap: 4 },
    weekdayColumn: { justifyContent: 'space-between', paddingVertical: 1 },
    weekdayLabel: { color: theme.text.muted, fontSize: 9, height: 15, width: 16, textAlign: 'center' },
    grid: { flexDirection: 'row', gap: 3 },
    weekColumn: { gap: 3 },
    cell: { width: 12, height: 12, borderRadius: 3 },
    legendRow: { flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'flex-end' },
    legendText: { color: theme.text.muted, fontSize: 10 },
    note: { color: theme.text.muted, fontSize: 11, lineHeight: 16 },
});
