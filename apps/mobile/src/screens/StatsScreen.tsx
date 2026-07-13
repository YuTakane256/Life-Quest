import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ThemePalette } from '@life-quest/core/designTokens';
import {
    generateDateRange,
    getHabitHeatmapLevel,
    getMonthLabels,
    getTaskHeatmapLevel,
    groupDatesByWeeks,
} from '@life-quest/core/stats';
import { getAchievementProgress, getUnlockedTitles, type AchievementProgress } from '@life-quest/core/achievements';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { useMobileHabitStore } from '../stores/useMobileHabitStore';
import { useMobileStatsStore } from '../stores/useMobileStatsStore';
import { useMobileTitleStore } from '../stores/useMobileTitleStore';
import { buildAchievementSnapshot } from '../utils/achievementSnapshot';
import { getTodayJst } from '../utils/date';
import { usePalette } from '../theme/usePalette';

type HeatmapMode = 'tasks' | 'habits';

/** ヒートマップの表示期間（12週） */
const HEATMAP_DAYS = 84;

// 濃淡スケールはWebのStatsPageと同一（level 0 は背景色）
function getHeatmapColors(palette: ThemePalette) {
    return {
        tasks: [palette.bg.secondary, 'rgba(99, 102, 241, 0.25)', 'rgba(99, 102, 241, 0.45)', 'rgba(99, 102, 241, 0.65)', 'rgba(99, 102, 241, 0.90)'],
        habits: [palette.bg.secondary, 'rgba(16, 185, 129, 0.25)', 'rgba(16, 185, 129, 0.45)', 'rgba(16, 185, 129, 0.65)', 'rgba(16, 185, 129, 0.90)'],
    };
}
const WEEKDAY_LABELS = ['', '月', '', '水', '', '金', ''];

export default function StatsScreen() {
    const habitsCount = useMobileHabitStore((state) => state.habits.length);
    const taskXpLog = useMobileStatsStore((state) => state.taskXpLog);
    const habitLog = useMobileStatsStore((state) => state.habitLog);
    const totalXp = useMobileGameStore((state) => state.character.totalXp);
    const maxStage = useMobileGameStore((state) => state.battleProgress.maxClearedStage);
    const equipmentCount = useMobileGameStore((state) => state.equipment.length);
    const [mode, setMode] = useState<HeatmapMode>('tasks');
    const activeTitle = useMobileTitleStore((state) => state.activeTitle);
    const setActiveTitle = useMobileTitleStore((state) => state.setActiveTitle);

    const { palette } = usePalette();
    const styles = useMemo(() => createStyles(palette), [palette]);
    const heatmapColors = useMemo(() => getHeatmapColors(palette), [palette]);

    const today = getTodayJst();
    // Web StatsPage.tsx と同一: ヒートマップ・実績とも永続ログ（taskXpLog/habitLog）が単一の情報源
    const taskXpByDate = taskXpLog;
    const habitActivity = habitLog;

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
    const colors = mode === 'tasks' ? heatmapColors.tasks : heatmapColors.habits;

    // 実績・称号（Web StatsPage.tsx と同一のsnapshotセマンティクス。称号の選択UIは#514スコープ）
    const achievementProgress = useMemo(
        () => getAchievementProgress(buildAchievementSnapshot({ taskXpLog, habitLog, totalXp, maxStage, equipmentCount })),
        [taskXpLog, habitLog, totalXp, maxStage, equipmentCount],
    );
    const unlockedTitles = useMemo(() => getUnlockedTitles(achievementProgress), [achievementProgress]);
    const unlockedCount = achievementProgress.filter((achievement) => achievement.unlocked).length;
    const selectedTitle = activeTitle && unlockedTitles.includes(activeTitle) ? activeTitle : null;

    return (
        <SafeAreaView style={styles.safeArea}>
            <ScrollView contentContainerStyle={styles.scroll}>
                <View style={styles.content}>
                    <Text style={styles.title}>統計</Text>

                    {/* サマリー */}
                    <View style={styles.summaryRow}>
                        <SummaryCard label="今日のXP" value={`${taskXpByDate[today] ?? 0}`} styles={styles} />
                        <SummaryCard label="7日間XP" value={`${weekXp}`} styles={styles} />
                    </View>
                    <View style={styles.summaryRow}>
                        <SummaryCard label="今日の習慣" value={`${todayHabitCount}/${habitsCount}`} styles={styles} />
                        <SummaryCard label="30日全達成" value={`${allCompleteCount}日`} styles={styles} />
                    </View>

                    {/* 実績（Web StatsPage.tsxの情報順序: サマリー→実績→ヒートマップ） */}
                    <View style={styles.card}>
                        <View style={styles.cardHeader}>
                            <Text style={styles.sectionTitle}>🏅 実績</Text>
                            <Text style={styles.achievementCount}>{unlockedCount}/{achievementProgress.length}</Text>
                        </View>
                        <View style={styles.achievementList}>
                            {achievementProgress.map((achievement) => (
                                <AchievementRow key={achievement.id} achievement={achievement} styles={styles} />
                            ))}
                        </View>
                        {unlockedTitles.length > 0 && (
                            <View>
                                <Text style={styles.titlesText}>
                                    獲得称号: <Text style={styles.titlesValue}>{unlockedTitles.join(' / ')}</Text>
                                </Text>
                                <View style={styles.titleChipRow}>
                                    <Pressable
                                        accessibilityRole="radio"
                                        accessibilityState={{ selected: selectedTitle === null }}
                                        accessibilityLabel="称号なしを選択する"
                                        onPress={() => setActiveTitle(null)}
                                        style={[styles.titleChip, selectedTitle === null && styles.titleChipActive]}
                                    >
                                        <Text style={[styles.titleChipText, selectedTitle === null && styles.titleChipTextActive]}>
                                            称号なし
                                        </Text>
                                    </Pressable>
                                    {unlockedTitles.map((title) => (
                                        <Pressable
                                            key={title}
                                            accessibilityRole="radio"
                                            accessibilityState={{ selected: selectedTitle === title }}
                                            accessibilityLabel={`「${title}」を選択する`}
                                            onPress={() => setActiveTitle(title)}
                                            style={[styles.titleChip, selectedTitle === title && styles.titleChipGold]}
                                        >
                                            <Text style={[styles.titleChipText, selectedTitle === title && styles.titleChipTextGold]}>
                                                {title}
                                            </Text>
                                        </Pressable>
                                    ))}
                                </View>
                            </View>
                        )}
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

function SummaryCard({ label, value, styles }: { label: string; value: string; styles: Styles }) {
    return (
        <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>{label}</Text>
            <Text style={styles.summaryValue}>{value}</Text>
        </View>
    );
}

/** Web StatsPage.tsx の AchievementRow と同一の情報構造（アイコン・タイトル・説明・進捗バー）。 */
function AchievementRow({ achievement, styles }: { achievement: AchievementProgress; styles: Styles }) {
    const percent = Math.round(achievement.progress * 100);
    return (
        <View style={[styles.achievementRow, !achievement.unlocked && styles.achievementRowLocked]}>
            <View style={styles.achievementHeader}>
                <View style={styles.achievementLabel}>
                    <Text style={styles.achievementIcon} accessibilityElementsHidden>{achievement.icon}</Text>
                    <View style={styles.flex}>
                        <Text style={styles.achievementTitle} numberOfLines={1}>{achievement.title}</Text>
                        <Text style={styles.achievementDescription} numberOfLines={1}>{achievement.description}</Text>
                    </View>
                </View>
                <View style={[styles.achievementBadge, achievement.unlocked && styles.achievementBadgeUnlocked]}>
                    <Text style={[styles.achievementBadgeText, achievement.unlocked && styles.achievementBadgeTextUnlocked]}>
                        {achievement.unlocked ? achievement.rewardTitle : `${achievement.current}/${achievement.target}`}
                    </Text>
                </View>
            </View>
            <View style={styles.achievementTrack}>
                <View
                    style={[
                        styles.achievementFill,
                        { width: `${percent}%` },
                        achievement.unlocked && styles.achievementFillUnlocked,
                    ]}
                />
            </View>
        </View>
    );
}

type Styles = ReturnType<typeof createStyles>;

function createStyles(palette: ThemePalette) {
    return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.bg.primary },
    scroll: { paddingBottom: 32 },
    content: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 20, gap: 12 },
    title: { color: palette.text.primary, fontSize: 28, fontWeight: '800', paddingTop: 20 },
    summaryRow: { flexDirection: 'row', gap: 12 },
    summaryCard: { flex: 1, backgroundColor: palette.bg.card, borderColor: palette.border.default, borderWidth: 1, borderRadius: 10, paddingVertical: 14, alignItems: 'center', gap: 4 },
    summaryLabel: { color: palette.text.muted, fontSize: 11, fontWeight: '700' },
    summaryValue: { color: palette.text.primary, fontSize: 20, fontWeight: '800' },
    card: { backgroundColor: palette.bg.card, borderColor: palette.border.default, borderWidth: 1, borderRadius: 10, padding: 14, gap: 8 },
    cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sectionTitle: { color: palette.text.primary, fontSize: 15, fontWeight: '800' },
    modeSwitch: { flexDirection: 'row', backgroundColor: palette.bg.secondary, borderRadius: 8, padding: 2 },
    modeSegment: { height: 28, paddingHorizontal: 12, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
    modeSegmentActive: { backgroundColor: palette.bg.cardHover },
    modeText: { color: palette.text.muted, fontSize: 12, fontWeight: '700' },
    modeTextActive: { color: palette.text.primary },
    monthRow: { height: 16 },
    monthLabel: { position: 'absolute', color: palette.text.muted, fontSize: 10, fontWeight: '700' },
    heatmapRow: { flexDirection: 'row', gap: 4 },
    weekdayColumn: { justifyContent: 'space-between', paddingVertical: 1 },
    weekdayLabel: { color: palette.text.muted, fontSize: 9, height: 15, width: 16, textAlign: 'center' },
    grid: { flexDirection: 'row', gap: 3 },
    weekColumn: { gap: 3 },
    cell: { width: 12, height: 12, borderRadius: 3 },
    legendRow: { flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'flex-end' },
    legendText: { color: palette.text.muted, fontSize: 10 },
    note: { color: palette.text.muted, fontSize: 11, lineHeight: 16 },
    flex: { flex: 1 },
    achievementCount: { color: palette.accent.gold, fontSize: 12, fontWeight: '800' },
    achievementList: { gap: 8 },
    achievementRow: { backgroundColor: palette.bg.secondary, borderRadius: 8, padding: 10, gap: 6 },
    achievementRowLocked: { opacity: 0.78 },
    achievementHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
    achievementLabel: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, flex: 1 },
    achievementIcon: { fontSize: 16 },
    achievementTitle: { color: palette.text.primary, fontSize: 12, fontWeight: '700' },
    achievementDescription: { color: palette.text.muted, fontSize: 10 },
    achievementBadge: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 999, backgroundColor: palette.bg.card, borderColor: palette.border.default, borderWidth: 1 },
    achievementBadgeUnlocked: { backgroundColor: 'rgba(245, 158, 11, 0.18)' },
    achievementBadgeText: { color: palette.text.muted, fontSize: 10 },
    achievementBadgeTextUnlocked: { color: palette.accent.gold },
    achievementTrack: { height: 6, borderRadius: 3, backgroundColor: palette.bg.card, overflow: 'hidden' },
    achievementFill: { height: '100%', borderRadius: 3, backgroundColor: palette.accent.primary },
    achievementFillUnlocked: { backgroundColor: palette.accent.gold },
    titlesText: { color: palette.text.muted, fontSize: 11, lineHeight: 16 },
    titlesValue: { color: palette.accent.gold },
    titleChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
    titleChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: palette.bg.secondary, borderColor: palette.border.default, borderWidth: 1 },
    titleChipActive: { backgroundColor: palette.accent.primary },
    titleChipGold: { backgroundColor: 'rgba(245, 158, 11, 0.85)' },
    titleChipText: { color: palette.text.muted, fontSize: 10, fontWeight: '700' },
    titleChipTextActive: { color: 'white' },
    titleChipTextGold: { color: 'white' },
    });
}
