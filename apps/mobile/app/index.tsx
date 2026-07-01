import { useMemo, useState } from 'react';
import {
    FlatList,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Task } from '@life-quest/core/tasks';
import { useMobileTaskStore } from '../src/stores/useMobileTaskStore';

type TaskFilter = 'open' | 'all' | 'done';

export default function TasksScreen() {
    const tasks = useMobileTaskStore((state) => state.tasks);
    const hasHydrated = useMobileTaskStore((state) => state.hasHydrated);
    const addTask = useMobileTaskStore((state) => state.addTask);
    const toggleTask = useMobileTaskStore((state) => state.toggleTask);
    const deleteTask = useMobileTaskStore((state) => state.deleteTask);
    const [draft, setDraft] = useState('');
    const [filter, setFilter] = useState<TaskFilter>('open');

    const visibleTasks = useMemo(() => tasks.filter((task) => {
        if (filter === 'open') return !task.completed;
        if (filter === 'done') return task.completed;
        return true;
    }), [filter, tasks]);
    const openCount = tasks.filter((task) => !task.completed).length;

    const handleAdd = () => {
        if (addTask(draft)) setDraft('');
    };

    return (
        <SafeAreaView style={styles.safeArea} edges={['bottom']}>
            <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <View style={styles.header}>
                    <View>
                        <Text style={styles.title}>タスク</Text>
                        <Text style={styles.summary}>{openCount}件の未完了タスク</Text>
                    </View>
                    <View style={styles.syncBadge}>
                        <View style={[styles.syncDot, hasHydrated && styles.syncDotReady]} />
                        <Text style={styles.syncText}>{hasHydrated ? '保存済み' : '読込中'}</Text>
                    </View>
                </View>

                <View style={styles.composer}>
                    <TextInput
                        value={draft}
                        onChangeText={setDraft}
                        onSubmitEditing={handleAdd}
                        placeholder="新しいタスク"
                        placeholderTextColor="#737d90"
                        returnKeyType="done"
                        style={styles.input}
                        maxLength={200}
                    />
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="タスクを追加"
                        disabled={!draft.trim()}
                        onPress={handleAdd}
                        style={({ pressed }) => [styles.addButton, (!draft.trim() || pressed) && styles.buttonMuted]}
                    >
                        <Text style={styles.addSymbol}>＋</Text>
                    </Pressable>
                </View>

                <View style={styles.segmented}>
                    {([['open', '未完了'], ['all', 'すべて'], ['done', '完了']] as const).map(([value, label]) => (
                        <Pressable key={value} onPress={() => setFilter(value)} style={[styles.segment, filter === value && styles.segmentActive]}>
                            <Text style={[styles.segmentText, filter === value && styles.segmentTextActive]}>{label}</Text>
                        </Pressable>
                    ))}
                </View>

                <FlatList
                    data={visibleTasks}
                    keyExtractor={(task) => task.id}
                    renderItem={({ item }) => <TaskRow task={item} onToggle={toggleTask} onDelete={deleteTask} />}
                    contentContainerStyle={[styles.list, visibleTasks.length === 0 && styles.emptyList]}
                    keyboardShouldPersistTaps="handled"
                    ListEmptyComponent={hasHydrated ? (
                        <View style={styles.empty}>
                            <Text style={styles.emptyTitle}>{filter === 'done' ? '完了したタスクはありません' : 'タスクはありません'}</Text>
                            <Text style={styles.emptyBody}>上の入力欄から今日の一歩を追加できます。</Text>
                        </View>
                    ) : null}
                />
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

function TaskRow({ task, onToggle, onDelete }: { task: Task; onToggle: (id: string) => void; onDelete: (id: string) => void }) {
    return (
        <View style={styles.taskRow}>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: task.completed }} accessibilityLabel={`${task.name}を${task.completed ? '未完了' : '完了'}にする`} onPress={() => onToggle(task.id)} style={[styles.checkbox, task.completed && styles.checkboxDone]}>
                {task.completed && <Text style={styles.checkmark}>✓</Text>}
            </Pressable>
            <Text numberOfLines={2} style={[styles.taskName, task.completed && styles.taskNameDone]}>{task.name}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`${task.name}を削除`} onPress={() => onDelete(task.id)} hitSlop={10} style={({ pressed }) => [styles.deleteButton, pressed && styles.buttonMuted]}>
                <Text style={styles.deleteSymbol}>×</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    safeArea: { flex: 1, backgroundColor: '#0e1017' },
    header: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { color: '#f6f7fb', fontSize: 28, fontWeight: '800' },
    summary: { color: '#929bad', fontSize: 13, marginTop: 3 },
    syncBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, height: 30, borderRadius: 8, backgroundColor: '#1a1e28', borderWidth: 1, borderColor: '#303746' },
    syncDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#737d90' },
    syncDotReady: { backgroundColor: '#33c18d' },
    syncText: { color: '#aeb6c6', fontSize: 11, fontWeight: '700' },
    composer: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginBottom: 14 },
    input: { flex: 1, height: 46, borderRadius: 8, paddingHorizontal: 14, color: '#f6f7fb', backgroundColor: '#1a1e28', borderWidth: 1, borderColor: '#343b49', fontSize: 15 },
    addButton: { width: 46, height: 46, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#28b987' },
    addSymbol: { color: '#07150f', fontSize: 25, fontWeight: '700', lineHeight: 28 },
    buttonMuted: { opacity: 0.45 },
    segmented: { marginHorizontal: 20, marginBottom: 12, padding: 3, borderRadius: 8, flexDirection: 'row', backgroundColor: '#181b24' },
    segment: { flex: 1, height: 34, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
    segmentActive: { backgroundColor: '#303746' },
    segmentText: { color: '#7e8799', fontSize: 12, fontWeight: '700' },
    segmentTextActive: { color: '#f6f7fb' },
    list: { paddingHorizontal: 20, paddingBottom: 28, gap: 8 },
    emptyList: { flexGrow: 1 },
    taskRow: { minHeight: 58, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 11, backgroundColor: '#1a1e28', borderWidth: 1, borderColor: '#303746' },
    checkbox: { width: 23, height: 23, borderRadius: 6, borderWidth: 2, borderColor: '#6d778a', alignItems: 'center', justifyContent: 'center' },
    checkboxDone: { backgroundColor: '#28b987', borderColor: '#28b987' },
    checkmark: { color: '#07150f', fontSize: 14, fontWeight: '900' },
    taskName: { flex: 1, color: '#e5e8ef', fontSize: 15, lineHeight: 21 },
    taskNameDone: { color: '#747d8e', textDecorationLine: 'line-through' },
    deleteButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
    deleteSymbol: { color: '#e07178', fontSize: 23, lineHeight: 25 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 },
    emptyTitle: { color: '#c7cdd8', fontSize: 16, fontWeight: '700' },
    emptyBody: { color: '#737d90', fontSize: 13, marginTop: 7 },
});
