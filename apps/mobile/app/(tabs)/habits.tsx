import { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Habit } from '@life-quest/core/habits';
import { useMobileHabitStore } from '../../src/stores/useMobileHabitStore';
import { theme } from '../../src/theme/colors';
import { getTodayJst } from '../../src/utils/date';

export default function HabitsScreen() {
    const habits = useMobileHabitStore((state) => state.habits);
    const records = useMobileHabitStore((state) => state.records);
    const ready = useMobileHabitStore((state) => state.hasHydrated);
    const addHabit = useMobileHabitStore((state) => state.addHabit);
    const toggleToday = useMobileHabitStore((state) => state.toggleToday);
    const deleteHabit = useMobileHabitStore((state) => state.deleteHabit);
    const [draft, setDraft] = useState('');
    const today = getTodayJst();
    const completedIds = useMemo(() => new Set(records.filter((record) => record.date === today && record.completed).map((record) => record.habitId)), [records, today]);
    const handleAdd = () => { if (ready && addHabit(draft)) setDraft(''); };

    return <SafeAreaView style={styles.safeArea}><View style={styles.header}><Text style={styles.title}>習慣</Text><Text style={styles.summary}>{completedIds.size}/{habits.length} 今日達成</Text></View><View style={styles.composer}><TextInput value={draft} onChangeText={setDraft} onSubmitEditing={handleAdd} placeholder="続けたい習慣" placeholderTextColor="#737d90" style={styles.input} maxLength={200} /><Pressable accessibilityLabel="習慣を追加" disabled={!ready || !draft.trim()} onPress={handleAdd} style={({ pressed }) => [styles.addButton, (!ready || !draft.trim() || pressed) && styles.muted]}><Text style={styles.addSymbol}>＋</Text></Pressable></View><FlatList data={habits} keyExtractor={(habit) => habit.id} renderItem={({ item }) => <HabitRow habit={item} completed={completedIds.has(item.id)} onToggle={() => toggleToday(item.id, today)} onDelete={() => deleteHabit(item.id)} />} contentContainerStyle={[styles.list, habits.length === 0 && styles.emptyList]} ListEmptyComponent={ready ? <View style={styles.empty}><Text style={styles.emptyTitle}>習慣はまだありません</Text><Text style={styles.emptyBody}>小さく続けたいことを追加しましょう。</Text></View> : null} /></SafeAreaView>;
}

function HabitRow({ habit, completed, onToggle, onDelete }: { habit: Habit; completed: boolean; onToggle: () => void; onDelete: () => void }) {
    return <View style={styles.row}><Pressable accessibilityRole="checkbox" accessibilityState={{ checked: completed }} accessibilityLabel={`${habit.name}を${completed ? '未達成' : '達成'}にする`} onPress={onToggle} style={[styles.check, completed && styles.checkDone]}><Text style={[styles.checkSymbol, completed && styles.checkSymbolDone]}>{completed ? '✓' : '○'}</Text></Pressable><View style={styles.rowBody}><Text style={[styles.rowName, completed && styles.rowNameDone]}>{habit.name}</Text><Text style={styles.rowMeta}>{completed ? '今日達成済み' : '今日の記録なし'}</Text></View><Pressable accessibilityLabel={`${habit.name}を削除`} onPress={onDelete} hitSlop={10} style={styles.deleteButton}><Text style={styles.deleteSymbol}>×</Text></Pressable></View>;
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: theme.bg.primary }, header: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }, title: { color: theme.text.primary, fontSize: 28, fontWeight: '800' }, summary: { color: theme.accent.gold, fontSize: 13, fontWeight: '700' }, composer: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginBottom: 14 }, input: { flex: 1, height: 46, borderRadius: 8, paddingHorizontal: 14, color: theme.text.primary, backgroundColor: theme.bg.card, borderWidth: 1, borderColor: theme.border.default, fontSize: 15 }, addButton: { width: 46, height: 46, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent.gold }, addSymbol: { color: theme.bg.primary, fontSize: 25, fontWeight: '700' }, muted: { opacity: 0.45 }, list: { paddingHorizontal: 20, paddingBottom: 28, gap: 8 }, emptyList: { flexGrow: 1 }, row: { minHeight: 66, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: theme.bg.card, borderWidth: 1, borderColor: theme.border.default }, check: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg.cardHover }, checkDone: { backgroundColor: theme.accent.gold }, checkSymbol: { color: theme.text.secondary, fontSize: 19, fontWeight: '800' }, checkSymbolDone: { color: theme.bg.primary }, rowBody: { flex: 1 }, rowName: { color: theme.text.primary, fontSize: 15, fontWeight: '600' }, rowNameDone: { color: theme.accent.gold }, rowMeta: { color: theme.text.muted, fontSize: 11, marginTop: 3 }, deleteButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }, deleteSymbol: { color: theme.text.danger, fontSize: 23 }, empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 }, emptyTitle: { color: theme.text.secondary, fontSize: 16, fontWeight: '700' }, emptyBody: { color: theme.text.muted, fontSize: 13, marginTop: 7 },
});
