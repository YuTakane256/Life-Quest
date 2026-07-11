import { useMemo, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ThemePalette } from '@life-quest/core/designTokens';
import {
    getHabitCategoryByIdOrDefault,
    getHabitCompletionRate,
    getHabitStreak,
    HABIT_CATEGORIES,
    isRestDayOn,
    type Habit,
} from '@life-quest/core/habits';
import { useMobileHabitStore } from '../stores/useMobileHabitStore';
import { getTodayJst } from '../utils/date';
import { usePalette } from '../theme/usePalette';

export default function HabitsScreen() {
    const habits = useMobileHabitStore((state) => state.habits);
    const records = useMobileHabitStore((state) => state.records);
    const restDays = useMobileHabitStore((state) => state.restDays);
    const ready = useMobileHabitStore((state) => state.hasHydrated);
    const addHabit = useMobileHabitStore((state) => state.addHabit);
    const toggleToday = useMobileHabitStore((state) => state.toggleToday);
    const deleteHabit = useMobileHabitStore((state) => state.deleteHabit);
    const markRestDay = useMobileHabitStore((state) => state.markRestDay);

    const { palette } = usePalette();
    const styles = useMemo(() => createStyles(palette), [palette]);

    const [draft, setDraft] = useState('');
    const [categoryId, setCategoryId] = useState<string>('other');
    const [expandedHabitId, setExpandedHabitId] = useState<string | null>(null);

    const today = getTodayJst();
    const todayIsRest = isRestDayOn(restDays, today);
    const completedIds = useMemo(
        () => new Set(records.filter((record) => record.date === today && record.completed).map((record) => record.habitId)),
        [records, today],
    );

    const handleAdd = () => {
        if (addHabit(draft, categoryId)) setDraft('');
    };

    const handleMarkRest = () => {
        Alert.alert(
            '今日をお休みにする',
            'お休み日は連続記録が途切れず、達成率の計算からも除外されます。よろしいですか？',
            [
                { text: 'キャンセル', style: 'cancel' },
                { text: 'お休みにする', onPress: () => markRestDay(today) },
            ],
        );
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <View style={styles.header}>
                    <View>
                        <Text style={styles.title}>習慣</Text>
                        <Text style={styles.summary}>{completedIds.size}/{habits.length} 今日達成</Text>
                    </View>
                    {todayIsRest ? (
                        <View style={styles.restBadge}>
                            <Text style={styles.restBadgeText}>今日はお休み</Text>
                        </View>
                    ) : (
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="今日をお休み日にする"
                            onPress={handleMarkRest}
                            style={({ pressed }) => [styles.restButton, pressed && styles.muted]}
                        >
                            <Text style={styles.restButtonText}>お休みにする</Text>
                        </Pressable>
                    )}
                </View>

                <View style={styles.composer}>
                    <TextInput
                        value={draft}
                        onChangeText={setDraft}
                        onSubmitEditing={handleAdd}
                        placeholder="続けたい習慣"
                        placeholderTextColor={palette.text.muted}
                        returnKeyType="done"
                        style={styles.input}
                        maxLength={200}
                    />
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="習慣を追加"
                        disabled={!draft.trim()}
                        onPress={handleAdd}
                        style={({ pressed }) => [styles.addButton, (!draft.trim() || pressed) && styles.muted]}
                    >
                        <Text style={styles.addSymbol}>＋</Text>
                    </Pressable>
                </View>

                <FlatList
                    horizontal
                    data={HABIT_CATEGORIES}
                    keyExtractor={(category) => category.id}
                    extraData={categoryId}
                    showsHorizontalScrollIndicator={false}
                    style={styles.categoryList}
                    contentContainerStyle={styles.categoryListContent}
                    renderItem={({ item }) => (
                        <Pressable
                            accessibilityRole="radio"
                            accessibilityState={{ selected: categoryId === item.id }}
                            accessibilityLabel={`カテゴリを${item.name}にする`}
                            onPress={() => setCategoryId(item.id)}
                            style={[styles.categoryChip, categoryId === item.id && { borderColor: item.color, backgroundColor: palette.bg.cardHover }]}
                        >
                            <Text style={styles.categoryChipText}>{item.icon} {item.name}</Text>
                        </Pressable>
                    )}
                />

                <FlatList
                    data={habits}
                    keyExtractor={(habit) => habit.id}
                    extraData={[completedIds, expandedHabitId, restDays]}
                    renderItem={({ item }) => (
                        <HabitRow
                            habit={item}
                            completed={completedIds.has(item.id)}
                            expanded={expandedHabitId === item.id}
                            today={today}
                            onToggle={() => toggleToday(item.id, today)}
                            onDelete={() => deleteHabit(item.id)}
                            onExpand={() => setExpandedHabitId((current) => current === item.id ? null : item.id)}
                            styles={styles}
                            palette={palette}
                        />
                    )}
                    contentContainerStyle={[styles.list, habits.length === 0 && styles.emptyList]}
                    keyboardShouldPersistTaps="handled"
                    ListEmptyComponent={ready ? (
                        <View style={styles.empty}>
                            <Text style={styles.emptyTitle}>習慣がありません</Text>
                            <Text style={styles.emptyBody}>上の入力欄から追加しましょう！</Text>
                        </View>
                    ) : null}
                />
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

function HabitRow({ habit, completed, expanded, today, onToggle, onDelete, onExpand, styles, palette }: {
    habit: Habit;
    completed: boolean;
    expanded: boolean;
    today: string;
    onToggle: () => void;
    onDelete: () => void;
    onExpand: () => void;
    styles: Styles;
    palette: ThemePalette;
}) {
    const records = useMobileHabitStore((state) => state.records);
    const restDays = useMobileHabitStore((state) => state.restDays);
    const category = getHabitCategoryByIdOrDefault(habit.categoryId);
    const streak = getHabitStreak({ habit, records, restDays, today });
    const rate = getHabitCompletionRate({ habit, records, restDays, today });

    const metaParts: string[] = [`${category.icon} ${category.name}`];
    if (streak > 0) metaParts.push(`🔥 ${streak}日連続`);
    if (rate !== null) metaParts.push(`30日 ${rate}%`);

    return (
        <View style={[styles.rowContainer, { borderLeftColor: category.color, borderLeftWidth: 3 }]}>
            <View style={styles.row}>
                <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: completed }}
                    accessibilityLabel={`${habit.name}を${completed ? '未達成' : '達成'}にする`}
                    onPress={onToggle}
                    style={[styles.check, completed && styles.checkDone]}
                >
                    <Text style={[styles.checkSymbol, completed && styles.checkSymbolDone]}>{completed ? '✓' : '○'}</Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    accessibilityLabel={`${habit.name}のメモを開閉する`}
                    onPress={onExpand}
                    style={styles.rowBody}
                >
                    <Text style={[styles.rowName, completed && styles.rowNameDone]}>{habit.name}</Text>
                    <Text numberOfLines={1} style={styles.rowMeta}>{metaParts.join(' ・ ')}</Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${habit.name}を削除`}
                    onPress={onDelete}
                    hitSlop={10}
                    style={styles.deleteButton}
                >
                    <Text style={styles.deleteSymbol}>×</Text>
                </Pressable>
            </View>
            {expanded && <MemoPanel habitId={habit.id} today={today} styles={styles} palette={palette} />}
        </View>
    );
}

function MemoPanel({ habitId, today, styles, palette }: { habitId: string; today: string; styles: Styles; palette: ThemePalette }) {
    const records = useMobileHabitStore((state) => state.records);
    const setHabitMemo = useMobileHabitStore((state) => state.setHabitMemo);
    const savedMemo = records.find((record) => record.habitId === habitId && record.date === today)?.memo ?? '';
    const [memoDraft, setMemoDraft] = useState(savedMemo);

    return (
        <View style={styles.memoPanel}>
            <TextInput
                value={memoDraft}
                onChangeText={setMemoDraft}
                onBlur={() => setHabitMemo(habitId, today, memoDraft)}
                onSubmitEditing={() => setHabitMemo(habitId, today, memoDraft)}
                placeholder="今日のメモ"
                placeholderTextColor={palette.text.muted}
                accessibilityLabel="今日のメモ"
                style={styles.memoInput}
                maxLength={500}
                multiline
            />
        </View>
    );
}

type Styles = ReturnType<typeof createStyles>;

function createStyles(palette: ThemePalette) {
    return StyleSheet.create({
    flex: { flex: 1 },
    safeArea: { flex: 1, backgroundColor: palette.bg.primary },
    header: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { color: palette.text.primary, fontSize: 28, fontWeight: '800' },
    summary: { color: palette.accent.gold, fontSize: 13, fontWeight: '700', marginTop: 3 },
    restButton: { height: 32, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg.card, borderWidth: 1, borderColor: palette.border.default },
    restButtonText: { color: palette.text.secondary, fontSize: 12, fontWeight: '700' },
    restBadge: { height: 32, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg.cardHover, borderWidth: 1, borderColor: palette.accent.sky },
    restBadgeText: { color: palette.accent.sky, fontSize: 12, fontWeight: '800' },
    composer: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginBottom: 10 },
    input: { flex: 1, height: 46, borderRadius: 8, paddingHorizontal: 14, color: palette.text.primary, backgroundColor: palette.bg.card, borderWidth: 1, borderColor: palette.border.default, fontSize: 15 },
    addButton: { width: 46, height: 46, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.accent.gold },
    addSymbol: { color: palette.bg.primary, fontSize: 25, fontWeight: '700' },
    muted: { opacity: 0.45 },
    categoryList: { flexGrow: 0, marginBottom: 12 },
    categoryListContent: { paddingHorizontal: 20, gap: 8 },
    categoryChip: { height: 32, paddingHorizontal: 12, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg.secondary, borderWidth: 1, borderColor: palette.border.default },
    categoryChipText: { color: palette.text.secondary, fontSize: 12, fontWeight: '700' },
    list: { paddingHorizontal: 20, paddingBottom: 28, gap: 8 },
    emptyList: { flexGrow: 1 },
    rowContainer: { borderRadius: 8, backgroundColor: palette.bg.card, borderWidth: 1, borderColor: palette.border.default },
    row: { minHeight: 66, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 11 },
    check: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg.cardHover },
    checkDone: { backgroundColor: palette.accent.gold },
    checkSymbol: { color: palette.text.secondary, fontSize: 19, fontWeight: '800' },
    checkSymbolDone: { color: palette.bg.primary },
    rowBody: { flex: 1 },
    rowName: { color: palette.text.primary, fontSize: 15, fontWeight: '600' },
    rowNameDone: { color: palette.accent.gold },
    rowMeta: { color: palette.text.muted, fontSize: 11, marginTop: 3 },
    deleteButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
    deleteSymbol: { color: palette.text.danger, fontSize: 23 },
    memoPanel: { borderTopWidth: 1, borderTopColor: palette.border.default, paddingHorizontal: 12, paddingVertical: 8 },
    memoInput: { minHeight: 60, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: palette.text.primary, backgroundColor: palette.bg.secondary, borderWidth: 1, borderColor: palette.border.default, fontSize: 13, textAlignVertical: 'top' },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 },
    emptyTitle: { color: palette.text.secondary, fontSize: 16, fontWeight: '700' },
    emptyBody: { color: palette.text.muted, fontSize: 13, marginTop: 7 },
    });
}
