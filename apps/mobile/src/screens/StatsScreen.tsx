import { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LAYOUT_TOKENS, type ThemePalette } from '@life-quest/core/designTokens';
import { PAGE_HEADING, TAB_SCREEN_EDGES } from '../theme/layout';
import {
    generateDateRange,
    getHabitHeatmapLevel,
    getMonthLabels,
    getTaskHeatmapLevel,
    groupDatesByWeeks,
    STATS_DISPLAY_DAYS,
    summarizeStats,
    getStatsDayValue,
    getWeeklyTaskXp,
    getStatsBestRecords,
    formatStatsStreakRange,
} from '@life-quest/core/stats';
import { getAchievementProgress, getUnlockedTitles, type AchievementProgress } from '@life-quest/core/achievements';
import { getProgressBarA11y } from '@life-quest/core/progressA11y';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { useMobileStatsStore } from '../stores/useMobileStatsStore';
import { useMobileTitleStore } from '../stores/useMobileTitleStore';
import { buildAchievementSnapshot } from '../utils/achievementSnapshot';
import { shiftDate } from '../utils/date';
import { useJstToday } from '../hooks/useJstToday';
import { usePalette } from '../theme/usePalette';

type HeatmapMode = 'tasks' | 'habits';

// 濃淡スケールはWebのStatsPageと同一（level 0 は背景色）
function getHeatmapColors(palette: ThemePalette) {
    return {
        tasks: [palette.bg.secondary, 'rgba(99, 102, 241, 0.25)', 'rgba(99, 102, 241, 0.45)', 'rgba(99, 102, 241, 0.65)', 'rgba(99, 102, 241, 0.90)'],
        habits: [palette.bg.secondary, 'rgba(16, 185, 129, 0.25)', 'rgba(16, 185, 129, 0.45)', 'rgba(16, 185, 129, 0.65)', 'rgba(16, 185, 129, 0.90)'],
    };
}
const WEEKDAY_LABELS = ['', '月', '', '水', '', '金', ''];

export default function StatsScreen() {
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

    const today = useJstToday();
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [datePickerOpen, setDatePickerOpen] = useState(false);
    const [showWeeklyDetails, setShowWeeklyDetails] = useState(false);
    useFocusEffect(useCallback(() => () => setDatePickerOpen(false), []));
    // Web StatsPage.tsx と同一: ヒートマップ・実績とも永続ログ（taskXpLog/habitLog）が単一の情報源
    const taskXpByDate = taskXpLog;
    const habitActivity = habitLog;

    const dates = useMemo(() => generateDateRange(STATS_DISPLAY_DAYS, today), [today]);
    const weeks = useMemo(() => groupDatesByWeeks(dates), [dates]);
    const monthLabels = useMemo(() => getMonthLabels(weeks), [weeks]);

    const stats = useMemo(() => summarizeStats(dates, taskXpLog, habitLog, mode), [dates, taskXpLog, habitLog, mode]);
    const weeklyXp = useMemo(() => getWeeklyTaskXp(taskXpLog, today), [taskXpLog, today]);
    const bestRecords = useMemo(() => getStatsBestRecords(taskXpLog, habitLog), [taskXpLog, habitLog]);
    const detailDate = selectedDate && dates.includes(selectedDate) ? selectedDate : today;
    const selectDate = (date: string) => setSelectedDate(date === today ? null : date);

    const levelFor = (date: string): number => mode === 'tasks'
        ? getTaskHeatmapLevel(taskXpByDate[date] ?? 0)
        : getHabitHeatmapLevel(habitActivity[date]?.count ?? 0, habitActivity[date]?.allComplete ?? false);
    const colors = mode === 'tasks' ? heatmapColors.tasks : heatmapColors.habits;

    // 実績・称号は保存済みログと現在の成長状態から導出する。
    const achievementProgress = useMemo(
        () => getAchievementProgress(buildAchievementSnapshot({ taskXpLog, habitLog, totalXp, maxStage, equipmentCount })),
        [taskXpLog, habitLog, totalXp, maxStage, equipmentCount],
    );
    const unlockedTitles = useMemo(() => getUnlockedTitles(achievementProgress), [achievementProgress]);
    const unlockedCount = achievementProgress.filter((achievement) => achievement.unlocked).length;
    const selectedTitle = activeTitle && unlockedTitles.includes(activeTitle) ? activeTitle : null;
    const achievementsCard = (
                    <View testID="stats-achievements-card" style={styles.card}>
                        <View style={styles.cardHeader}>
                            <Text accessibilityRole="header" style={styles.sectionTitle}>🏅 実績</Text>
                            <Text style={styles.achievementCount}>{unlockedCount}/{achievementProgress.length} 達成</Text>
                        </View>
                        <View style={styles.achievementList}>
                            {achievementProgress.map((achievement) => (
                                <AchievementRow key={achievement.id} achievement={achievement} styles={styles} />
                            ))}
                        </View>
                            <View style={styles.titleSelection}>
                                <Text accessibilityRole="header" style={styles.sectionTitle}>表示する称号</Text>
                                <Text testID="stats-selected-title" accessibilityLiveRegion="polite" style={styles.selectedTitle}>表示中: {selectedTitle ?? '称号なし'}</Text>
                                <Text style={styles.titlesText}>{unlockedTitles.length > 0 ? '獲得した称号をキャラ画面に表示できます。' : '実績を達成すると称号を選べます。'}</Text>
                                {unlockedTitles.length > 0 &&
                                <View style={styles.titleChipRow}>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityState={{ selected: selectedTitle === null }}
                                        accessibilityLabel="称号なしを選択する"
                                        onPress={() => setActiveTitle(null)}
                                        style={[styles.titleChip, selectedTitle === null && styles.titleChipActive]}
                                    >
                                        <Text style={[styles.titleChipText, selectedTitle === null && styles.titleChipTextActive]}>
                                            {selectedTitle === null ? '✓ ' : ''}称号なし
                                        </Text>
                                    </Pressable>
                                    {unlockedTitles.map((title) => (
                                        <Pressable
                                            key={title}
                                            accessibilityRole="button"
                                            accessibilityState={{ selected: selectedTitle === title }}
                                            accessibilityLabel={`「${title}」を選択する`}
                                            onPress={() => setActiveTitle(title)}
                                            style={[styles.titleChip, selectedTitle === title && styles.titleChipActive]}
                                        >
                                            <Text style={[styles.titleChipText, selectedTitle === title && styles.titleChipTextActive]}>
                                                {selectedTitle === title ? '✓ ' : ''}{title}
                                            </Text>
                                        </Pressable>
                                    ))}
                                </View>}
                            </View>
                    </View>
    );

    return (
        <SafeAreaView edges={TAB_SCREEN_EDGES} style={styles.safeArea}>
            <ScrollView contentContainerStyle={styles.scroll}>
                <View style={styles.content}>
                    <Text accessibilityRole="header" style={styles.title}>統計</Text>
                    <Text style={styles.note}>日々の積み重ねと自己ベスト</Text>
                    <Text style={styles.note}>過去{STATS_DISPLAY_DAYS}日</Text>
                    <View style={styles.modeSwitch}>
                        {([['tasks', 'タスク'], ['habits', '習慣']] as const).map(([value, label]) => (
                            <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: mode === value }}
                                accessibilityLabel={`統計を${label}に切り替える`} onPress={() => setMode(value)}
                                style={[styles.modeSegment, mode === value && styles.modeSegmentActive]}>
                                <Text style={[styles.modeText, mode === value && styles.modeTextActive]}>{label}</Text>
                            </Pressable>
                        ))}
                    </View>
                    <View style={styles.summaryRow}>
                        <SummaryCard label={mode === 'tasks' ? '⚡ 合計XP' : '✅ 合計達成数'} value={stats.total.toLocaleString('ja-JP')} styles={styles} />
                        <SummaryCard label={mode === 'tasks' ? '📅 アクティブ日数' : '📅 全達成日数'} value={String(stats.activeDays)} styles={styles} />
                    </View>
                    <View style={styles.summaryRow}>
                        <SummaryCard label="🔥 現在の連続記録" value={String(stats.currentStreak)} styles={styles} />
                        <SummaryCard label="🏆 最長連続記録" value={String(stats.maxStreak)} styles={styles} />
                    </View>
                    {/* ヒートマップ */}
                    <View style={styles.card}>
                        <View style={styles.cardHeader}>
                            <Text accessibilityRole="header" style={styles.sectionTitle}>{mode === 'tasks' ? 'XP獲得ヒートマップ' : '習慣達成ヒートマップ'}</Text>
                        </View>
                        <Text style={styles.note}>{mode === 'tasks' ? '濃い日ほど獲得XPが多い日です' : '濃い日ほど多くの習慣を達成しています'}</Text>
                        <Text style={styles.note}>セルを選択して詳細</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator>
                        <View>
                        <View style={styles.monthRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                            {monthLabels.map(({ label, weekIndex }) => (
                                <Text
                                    key={`${label}-${weekIndex}`}
                                    allowFontScaling={false}
                                    style={[styles.monthLabel, { left: 20 + weekIndex * 15 }]}
                                >
                                    {label}
                                </Text>
                            ))}
                        </View>

                        <View style={styles.heatmapRow}>
                            <View style={styles.weekdayColumn} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                                {WEEKDAY_LABELS.map((label, index) => (
                                    <Text key={index} allowFontScaling={false} style={styles.weekdayLabel}>{label}</Text>
                                ))}
                            </View>
                                <View style={styles.grid}>
                                    {weeks.map((week, weekIndex) => (
                                        <View key={weekIndex} style={styles.weekColumn}>
                                            {week.map((date, dayIndex) => (
                                                <Pressable
                                                    key={`${weekIndex}-${dayIndex}`}
                                                    accessible={Boolean(date)}
                                                    accessibilityRole={date ? 'button' : undefined}
                                                    accessibilityLabel={date ? `${date}: ${getStatsDayValue(date, taskXpLog, habitLog, mode)}` : undefined}
                                                    accessibilityState={{ selected: detailDate === date, disabled: !date }}
                                                    disabled={!date}
                                                    onPress={() => selectDate(date)}
                                                    style={[
                                                        styles.cell,
                                                        { backgroundColor: date ? colors[levelFor(date)] : 'transparent', borderWidth: date === detailDate ? 1 : 0, borderColor: palette.text.primary },
                                                    ]}
                                                />
                                            ))}
                                        </View>
                                    ))}
                                </View>
                        </View>
                        </View>
                        </ScrollView>

                        <View style={styles.dateControls}>
                            <Pressable accessibilityRole="button" accessibilityLabel="統計の日付を選択" style={styles.dateButton} onPress={() => setDatePickerOpen(true)}>
                                <Text style={styles.dateButtonText}>日付を選択: {detailDate}</Text>
                            </Pressable>
                            <Pressable accessibilityRole="button" accessibilityLabel="前の日" accessibilityState={{ disabled: detailDate === dates[0] }} disabled={detailDate === dates[0]} style={[styles.dateButton, detailDate === dates[0] && styles.disabled]} onPress={() => selectDate(shiftDate(detailDate, -1))}><Text style={styles.dateButtonText}>前の日</Text></Pressable>
                            <Pressable accessibilityRole="button" accessibilityLabel="次の日" accessibilityState={{ disabled: detailDate === today }} disabled={detailDate === today} style={[styles.dateButton, detailDate === today && styles.disabled]} onPress={() => selectDate(shiftDate(detailDate, 1))}><Text style={styles.dateButtonText}>次の日</Text></Pressable>
                            <Pressable accessibilityRole="button" accessibilityLabel="今日" style={styles.dateButton} onPress={() => setSelectedDate(null)}><Text style={styles.dateButtonText}>今日</Text></Pressable>
                        </View>
                        <Text testID="stats-day-detail" accessibilityLiveRegion="polite" style={styles.dayDetail}>{detailDate}: {getStatsDayValue(detailDate, taskXpLog, habitLog, mode)}</Text>
                        <Text style={styles.note}>日本時間・今日を含む{STATS_DISPLAY_DAYS}日間。現在の連続記録は今日まで途切れず続いた日数です。記録のない日は0として表示します。</Text>

                        <View style={styles.legendRow}>
                            <Text style={styles.legendText}>少</Text>
                            {colors.map((color, index) => (
                                <View key={index} style={[styles.cell, { backgroundColor: color }]} />
                            ))}
                            <Text style={styles.legendText}>多</Text>
                        </View>
                    </View>

                    <View testID="stats-weekly-card" style={styles.card}>
                        <View style={styles.weeklyHeader}>
                            <Text accessibilityRole="header" style={styles.sectionTitle}>直近7日間のXP</Text>
                            <Text style={styles.weeklyTotal}>⚡ 合計 {weeklyXp.total.toLocaleString('ja-JP')} XP</Text>
                        </View>
                        <Text style={styles.note}>タスクXPのみ。今日を含む7日間（日本時間）。</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.weeklyChartContent}>
                            <View style={styles.weeklyBars}>
                                {weeklyXp.perDay.map(({ date, xp, weekday }) => (
                                    <View key={date} style={styles.weeklyColumn} accessible accessibilityRole="text" accessibilityLabel={`${date}（${weekday}）: ${xp.toLocaleString('ja-JP')} XP`}>
                                        <View style={styles.weeklyTrack}>
                                            <View style={[styles.weeklyBar, { height: `${weeklyXp.max > 0 ? xp / weeklyXp.max * 100 : 0}%`, backgroundColor: xp > 0 ? palette.accent.primary : palette.border.default }]} />
                                        </View>
                                        <Text allowFontScaling={false} style={styles.weeklyWeekday}>{weekday}</Text>
                                        <Text allowFontScaling={false} style={styles.weeklyValue}>{xp.toLocaleString('ja-JP')}</Text>
                                    </View>
                                ))}
                            </View>
                        </ScrollView>
                        <Pressable accessibilityRole="button" accessibilityLabel="7日間の内訳" accessibilityState={{ expanded: showWeeklyDetails }} style={styles.dateButton} onPress={() => setShowWeeklyDetails((value) => !value)}>
                            <Text style={styles.dateButtonText}>7日間の内訳</Text>
                        </Pressable>
                        {showWeeklyDetails && <View testID="weekly-xp-details" style={styles.weeklyDetails}>
                            {weeklyXp.perDay.map(({ date, xp, weekday }) => <View key={date} testID={`weekly-xp-${date}`} style={styles.weeklyDetailRow} accessible accessibilityLabel={`${date}（${weekday}）: ${xp.toLocaleString('ja-JP')} XP`}>
                                <Text style={styles.dateButtonText}>{date}（{weekday}）</Text><Text style={styles.dateButtonText}>{xp.toLocaleString('ja-JP')} XP</Text>
                            </View>)}
                        </View>}
                    </View>
                    <View testID="stats-best-card" style={styles.card}>
                        <Text accessibilityRole="header" style={styles.sectionTitle}>🏆 自己ベスト記録</Text>
                        <Text style={styles.note}>保存済みの全期間。同率の場合は最初の達成日を表示します。</Text>
                        <BestRecordRow icon="⚡" label="1日の最高XP" value={bestRecords.bestXp > 0 ? `${bestRecords.bestXp.toLocaleString('ja-JP')} XP` : '—'} detail={bestRecords.bestXpDate} styles={styles} />
                        <BestRecordRow icon="🔥" label="最長アクティブ連続" value={bestRecords.longestActive.count > 0 ? `${bestRecords.longestActive.count}日` : '—'} detail={formatStatsStreakRange(bestRecords.longestActive)} styles={styles} />
                        <BestRecordRow icon="🌟" label="最長 全習慣達成連続" value={bestRecords.longestPerfect.count > 0 ? `${bestRecords.longestPerfect.count}日` : '—'} detail={formatStatsStreakRange(bestRecords.longestPerfect)} styles={styles} />
                    </View>
                    {achievementsCard}
                    <Text style={styles.note}>
                        保存済みの達成ログを表示します。タスクや習慣を削除しても、過去の達成記録は残ります。
                    </Text>
                </View>
            </ScrollView>
            <Modal visible={datePickerOpen} animationType="none" onRequestClose={() => setDatePickerOpen(false)}>
                <SafeAreaView style={styles.safeArea}>
                    <View style={styles.pickerHeader}>
                        <Text accessibilityRole="header" style={styles.sectionTitle}>統計の日付を選択</Text>
                        <Pressable accessibilityRole="button" accessibilityLabel="日付選択を閉じる" style={styles.dateButton} onPress={() => setDatePickerOpen(false)}><Text style={styles.dateButtonText}>閉じる</Text></Pressable>
                    </View>
                    <ScrollView contentContainerStyle={styles.pickerList}>
                        {[...dates].reverse().map((date) => <Pressable key={date} accessibilityRole="radio" accessibilityLabel={`${date}を選択`} accessibilityState={{ selected: date === detailDate }}
                            style={[styles.dateButton, date === detailDate && styles.modeSegmentActive]} onPress={() => { selectDate(date); setDatePickerOpen(false); }}>
                            <Text style={[styles.dateButtonText, date === detailDate && styles.modeTextActive]}>{date}: {getStatsDayValue(date, taskXpLog, habitLog, mode)}</Text>
                        </Pressable>)}
                    </ScrollView>
                </SafeAreaView>
            </Modal>
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

function BestRecordRow({ icon, label, value, detail, styles }: { icon: string; label: string; value: string; detail: string; styles: Styles }) {
    return <View style={styles.bestRow}>
        <View style={styles.bestLabel}><Text accessibilityElementsHidden>{icon}</Text><Text style={[styles.dateButtonText, styles.bestLabelText]}>{label}</Text></View>
        <View style={styles.bestValueGroup}><Text style={styles.bestValue}>{value}</Text>{detail ? <Text style={styles.note}>{detail}</Text> : null}</View>
    </View>;
}

/** Web StatsPage.tsx の AchievementRow と同一の情報構造（アイコン・タイトル・説明・進捗バー）。 */
function AchievementRow({ achievement, styles }: { achievement: AchievementProgress; styles: Styles }) {
    const percent = Math.round(achievement.progress * 100);
    const a11y = getProgressBarA11y(
        achievement.current,
        achievement.target,
        () => `${achievement.unlocked ? '達成' : '未達成'}・${achievement.current.toLocaleString('ja-JP')} / ${achievement.target.toLocaleString('ja-JP')}・獲得称号: ${achievement.rewardTitle}`,
    );
    return (
        <View testID={`achievement-${achievement.id}`} style={styles.achievementRow}>
            <View style={styles.achievementHeader}>
                <View style={styles.achievementLabel}>
                    <Text style={styles.achievementIcon} accessibilityElementsHidden>{achievement.icon}</Text>
                    <View style={styles.flex}>
                        <Text accessibilityRole="header" style={styles.achievementTitle}>{achievement.title}</Text>
                        <Text style={styles.achievementDescription}>{achievement.description}</Text>
                    </View>
                </View>
                <View style={[styles.achievementBadge, achievement.unlocked && styles.achievementBadgeUnlocked]} accessibilityElementsHidden>
                    <Text style={styles.achievementBadgeText}>
                        {achievement.unlocked ? '達成' : '未達成'} · {achievement.current.toLocaleString('ja-JP')}/{achievement.target.toLocaleString('ja-JP')}
                    </Text>
                </View>
            </View>
            <Text style={styles.achievementReward}>獲得称号: {achievement.rewardTitle}</Text>
            <View
                style={styles.achievementTrack}
                accessibilityRole={a11y.max > 0 ? 'progressbar' : undefined}
                accessibilityLabel={achievement.title}
                accessibilityValue={a11y.max > 0 ? { min: 0, max: a11y.max, now: a11y.current, text: a11y.text } : undefined}
            >
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
    content: { width: '100%', maxWidth: LAYOUT_TOKENS.page.maxWidth, alignSelf: 'center', paddingHorizontal: LAYOUT_TOKENS.page.horizontal, gap: 12 },
    title: { color: palette.text.primary, ...PAGE_HEADING, paddingTop: LAYOUT_TOKENS.page.top },
    summaryRow: { flexDirection: 'row', gap: 12 },
    summaryCard: { flex: 1, minWidth: 0, backgroundColor: palette.bg.card, borderColor: palette.border.default, borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
    summaryLabel: { color: palette.text.muted, fontSize: 11, fontWeight: '700' },
    summaryValue: { color: palette.text.primary, fontSize: 20, fontWeight: '800' },
    card: { backgroundColor: palette.bg.card, borderColor: palette.border.default, borderWidth: 1, borderRadius: LAYOUT_TOKENS.card.radius, padding: LAYOUT_TOKENS.card.padding, gap: 8 },
    cardHeader: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' },
    sectionTitle: { color: palette.text.primary, fontSize: 15, fontWeight: '800' },
    modeSwitch: { flexDirection: 'row', backgroundColor: palette.bg.secondary, borderRadius: 8, padding: 2 },
    modeSegment: { minHeight: 44, flex: 1, padding: 10, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    modeSegmentActive: { backgroundColor: palette.accent.primary },
    modeText: { color: palette.text.muted, fontSize: 12, fontWeight: '700' },
    modeTextActive: { color: 'white' },
    dateControls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    dateButton: { minHeight: 44, maxWidth: '100%', padding: 10, borderRadius: 8, justifyContent: 'center', backgroundColor: palette.bg.secondary },
    dateButtonText: { color: palette.text.primary, fontSize: 12 },
    disabled: { opacity: 0.4 },
    dayDetail: { color: palette.text.primary, fontSize: 12, padding: 10, borderRadius: 8, backgroundColor: palette.bg.secondary },
    pickerHeader: { padding: 16, gap: 12 },
    pickerList: { padding: 16, gap: 8 },
    weeklyHeader: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
    weeklyTotal: { color: palette.accent.primary, fontSize: 14, fontWeight: '700', maxWidth: '100%', flexShrink: 1 },
    weeklyChartContent: { flexGrow: 1 },
    weeklyBars: { flex: 1, minWidth: 260, flexDirection: 'row', gap: 6 },
    weeklyColumn: { flex: 1, minWidth: 0, alignItems: 'center', gap: 3 },
    weeklyTrack: { height: 72, width: '100%', justifyContent: 'flex-end' },
    weeklyBar: { minHeight: 3, width: '100%', borderTopLeftRadius: 4, borderTopRightRadius: 4 },
    weeklyWeekday: { color: palette.text.muted, fontSize: 10 },
    weeklyValue: { color: palette.text.muted, fontSize: 9, maxWidth: '100%' },
    weeklyDetails: { gap: 8 },
    weeklyDetailRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
    bestRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: palette.bg.secondary, padding: 12, borderRadius: 8 },
    bestLabel: { flexDirection: 'row', flexShrink: 1, alignItems: 'center', gap: 8 },
    bestLabelText: { flexShrink: 1 },
    bestValueGroup: { alignItems: 'flex-end', maxWidth: '100%' },
    bestValue: { color: palette.accent.gold, fontSize: 14, fontWeight: '700' },
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
    achievementCount: { color: palette.text.secondary, fontSize: 12, fontWeight: '800' },
    achievementList: { gap: 8 },
    achievementRow: { backgroundColor: palette.bg.secondary, borderRadius: 8, padding: 10, gap: 6 },
    achievementHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
    achievementLabel: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, flexGrow: 1, flexShrink: 1, flexBasis: 160, minWidth: 0 },
    achievementIcon: { fontSize: 16 },
    achievementTitle: { color: palette.text.primary, fontSize: 12, fontWeight: '700' },
    achievementDescription: { color: palette.text.secondary, fontSize: 12, marginTop: 4 },
    achievementReward: { color: palette.text.secondary, fontSize: 12 },
    achievementBadge: { maxWidth: '100%', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: palette.bg.card, borderColor: palette.border.default, borderWidth: 1 },
    achievementBadgeUnlocked: { backgroundColor: 'rgba(245, 158, 11, 0.18)' },
    achievementBadgeText: { color: palette.text.primary, fontSize: 12 },
    achievementTrack: { height: 6, borderRadius: 3, backgroundColor: palette.bg.card, overflow: 'hidden' },
    achievementFill: { height: '100%', borderRadius: 3, backgroundColor: palette.accent.primary },
    achievementFillUnlocked: { backgroundColor: palette.accent.gold },
    titleSelection: { marginTop: 8, gap: 8 },
    selectedTitle: { color: palette.text.primary, fontSize: 12 },
    titlesText: { color: palette.text.secondary, fontSize: 12 },
    titleChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
    titleChip: { minHeight: 44, minWidth: 44, maxWidth: '100%', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: palette.bg.secondary, borderColor: palette.border.default, borderWidth: 1 },
    titleChipActive: { backgroundColor: palette.accent.primary },
    titleChipText: { color: palette.text.secondary, fontSize: 12, fontWeight: '700', flexShrink: 1 },
    titleChipTextActive: { color: 'white' },
    });
}
