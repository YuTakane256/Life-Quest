import { useMemo, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addRecurrenceInterval, TASK_LIMITS, type Priority, type Recurrence, type Task } from '@life-quest/core/tasks';
import { useMobileTaskStore } from '../stores/useMobileTaskStore';
import { getTodayJst } from '../utils/date';
import { theme } from '../theme/colors';

type TaskFilter = 'open' | 'all' | 'done';
type DueChoice = 'none' | 'today' | 'tomorrow' | 'nextWeek';

// 優先度はXP報酬（低10 / 中20 / 高30）に対応する
const PRIORITY_OPTIONS: readonly { value: Priority; label: string; color: string }[] = [
    { value: 'low', label: '低', color: theme.priority.low },
    { value: 'medium', label: '中', color: theme.priority.medium },
    { value: 'high', label: '高', color: theme.priority.high },
];

const DUE_OPTIONS: readonly { value: DueChoice; label: string }[] = [
    { value: 'none', label: 'なし' },
    { value: 'today', label: '今日' },
    { value: 'tomorrow', label: '明日' },
    { value: 'nextWeek', label: '来週' },
];

const RECURRENCE_OPTIONS: readonly { value: Recurrence; label: string }[] = [
    { value: 'none', label: 'なし' },
    { value: 'daily', label: '毎日' },
    { value: 'weekly', label: '毎週' },
    { value: 'monthly', label: '毎月' },
];

const RECURRENCE_LABELS: Record<Recurrence, string> = {
    none: '', daily: '毎日', weekly: '毎週', monthly: '毎月',
};

function resolveDueDate(choice: DueChoice): string | null {
    const today = getTodayJst();
    if (choice === 'today') return today;
    if (choice === 'tomorrow') return addRecurrenceInterval(today, 'daily');
    if (choice === 'nextWeek') return addRecurrenceInterval(today, 'weekly');
    return null;
}

export default function TasksScreen() {
    const tasks = useMobileTaskStore((state) => state.tasks);
    const hasHydrated = useMobileTaskStore((state) => state.hasHydrated);
    const addTask = useMobileTaskStore((state) => state.addTask);
    const toggleTask = useMobileTaskStore((state) => state.toggleTask);
    const deleteTask = useMobileTaskStore((state) => state.deleteTask);

    const [draft, setDraft] = useState('');
    const [priority, setPriority] = useState<Priority>('medium');
    const [filter, setFilter] = useState<TaskFilter>('open');
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [dueChoice, setDueChoice] = useState<DueChoice>('none');
    const [recurrence, setRecurrence] = useState<Recurrence>('none');
    const [tagDraft, setTagDraft] = useState('');
    const [tags, setTags] = useState<readonly string[]>([]);
    const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

    const visibleTasks = useMemo(
        () => tasks.filter((task) => filter === 'all' || (filter === 'done' ? task.completed : !task.completed)),
        [filter, tasks],
    );
    const openCount = tasks.filter((task) => !task.completed).length;

    const handleAdd = () => {
        if (!hasHydrated) return;
        const added = addTask(draft, priority, {
            dueDate: resolveDueDate(dueChoice),
            tags: [...tags],
            recurrence,
        });
        if (!added) return;
        setDraft('');
        setDueChoice('none');
        setRecurrence('none');
        setTags([]);
        setTagDraft('');
    };

    const handleAddTag = () => {
        const tag = tagDraft.trim();
        if (!tag || tags.includes(tag) || tags.length >= TASK_LIMITS.maxTags) return;
        setTags((current) => [...current, tag]);
        setTagDraft('');
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
                <View style={styles.header}>
                    <View>
                        <Text style={styles.title}>タスク</Text>
                        <Text style={styles.summary}>{openCount}件の未完了タスク</Text>
                    </View>
                    <StorageBadge ready={hasHydrated} />
                </View>

                <View style={styles.composer}>
                    <TextInput
                        value={draft}
                        onChangeText={setDraft}
                        onSubmitEditing={handleAdd}
                        placeholder="新しいタスク"
                        placeholderTextColor={theme.text.muted}
                        returnKeyType="done"
                        style={styles.input}
                        maxLength={200}
                    />
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="タスクを追加"
                        disabled={!hasHydrated || !draft.trim()}
                        onPress={handleAdd}
                        style={({ pressed }) => [styles.addButton, (!hasHydrated || !draft.trim() || pressed) && styles.muted]}
                    >
                        <Text style={styles.addSymbol}>＋</Text>
                    </Pressable>
                </View>

                <View style={styles.chipRow}>
                    <Text style={styles.rowCaption}>優先度</Text>
                    {PRIORITY_OPTIONS.map((option) => (
                        <Pressable
                            key={option.value}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: priority === option.value }}
                            accessibilityLabel={`優先度を${option.label}にする`}
                            onPress={() => setPriority(option.value)}
                            style={[styles.chip, priority === option.value && styles.chipActive]}
                        >
                            <Text style={[styles.chipText, priority === option.value && { color: option.color }]}>{option.label}</Text>
                        </Pressable>
                    ))}
                    <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded: detailsOpen }}
                        accessibilityLabel="期限・繰り返し・タグの詳細設定を開閉する"
                        onPress={() => setDetailsOpen((open) => !open)}
                        style={[styles.chip, detailsOpen && styles.chipActive]}
                    >
                        <Text style={styles.chipText}>{detailsOpen ? '詳細 ▲' : '詳細 ▼'}</Text>
                    </Pressable>
                </View>

                {detailsOpen && (
                    <View style={styles.detailsPanel}>
                        <View style={styles.detailRow}>
                            <Text style={styles.rowCaption}>期限</Text>
                            {DUE_OPTIONS.map((option) => (
                                <Pressable
                                    key={option.value}
                                    accessibilityRole="radio"
                                    accessibilityState={{ selected: dueChoice === option.value }}
                                    accessibilityLabel={`期限を${option.label}にする`}
                                    onPress={() => setDueChoice(option.value)}
                                    style={[styles.chip, dueChoice === option.value && styles.chipActive]}
                                >
                                    <Text style={[styles.chipText, dueChoice === option.value && styles.chipTextActive]}>{option.label}</Text>
                                </Pressable>
                            ))}
                        </View>
                        <View style={styles.detailRow}>
                            <Text style={styles.rowCaption}>繰り返し</Text>
                            {RECURRENCE_OPTIONS.map((option) => (
                                <Pressable
                                    key={option.value}
                                    accessibilityRole="radio"
                                    accessibilityState={{ selected: recurrence === option.value }}
                                    accessibilityLabel={`繰り返しを${option.label}にする`}
                                    onPress={() => setRecurrence(option.value)}
                                    style={[styles.chip, recurrence === option.value && styles.chipActive]}
                                >
                                    <Text style={[styles.chipText, recurrence === option.value && styles.chipTextActive]}>{option.label}</Text>
                                </Pressable>
                            ))}
                        </View>
                        <View style={styles.detailRow}>
                            <Text style={styles.rowCaption}>タグ</Text>
                            <TextInput
                                value={tagDraft}
                                onChangeText={setTagDraft}
                                onSubmitEditing={handleAddTag}
                                placeholder="タグを追加"
                                placeholderTextColor={theme.text.muted}
                                returnKeyType="done"
                                style={styles.tagInput}
                                maxLength={50}
                            />
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="タグを追加する"
                                disabled={!tagDraft.trim()}
                                onPress={handleAddTag}
                                style={[styles.chip, !tagDraft.trim() && styles.muted]}
                            >
                                <Text style={styles.chipText}>追加</Text>
                            </Pressable>
                        </View>
                        {tags.length > 0 && (
                            <View style={styles.detailRow}>
                                {tags.map((tag) => (
                                    <Pressable
                                        key={tag}
                                        accessibilityRole="button"
                                        accessibilityLabel={`タグ${tag}を外す`}
                                        onPress={() => setTags((current) => current.filter((candidate) => candidate !== tag))}
                                        style={[styles.chip, styles.chipActive]}
                                    >
                                        <Text style={styles.chipTextActive}>#{tag} ×</Text>
                                    </Pressable>
                                ))}
                            </View>
                        )}
                    </View>
                )}

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
                    extraData={expandedTaskId}
                    renderItem={({ item }) => (
                        <TaskRow
                            task={item}
                            expanded={expandedTaskId === item.id}
                            onToggle={toggleTask}
                            onDelete={deleteTask}
                            onExpand={() => setExpandedTaskId((current) => current === item.id ? null : item.id)}
                        />
                    )}
                    contentContainerStyle={[styles.list, visibleTasks.length === 0 && styles.emptyList]}
                    keyboardShouldPersistTaps="handled"
                    ListEmptyComponent={hasHydrated ? (
                        <EmptyState
                            title={filter === 'done' ? '完了したタスクはありません' : 'タスクがありません'}
                            body="上の入力欄から追加しましょう！"
                        />
                    ) : null}
                />
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

function TaskRow({ task, expanded, onToggle, onDelete, onExpand }: {
    task: Task;
    expanded: boolean;
    onToggle: (id: string) => void;
    onDelete: (id: string) => void;
    onExpand: () => void;
}) {
    const today = getTodayJst();
    const overdue = task.dueDate !== null && task.dueDate < today && !task.completed;
    const doneSubtasks = task.subtasks.filter((subtask) => subtask.completed).length;
    const metaParts: string[] = [];
    if (task.dueDate) metaParts.push(`期限 ${task.dueDate.slice(5).replace('-', '/')}`);
    if (task.recurrence !== 'none') metaParts.push(RECURRENCE_LABELS[task.recurrence]);
    if (task.subtasks.length > 0) metaParts.push(`サブ ${doneSubtasks}/${task.subtasks.length}`);
    if (task.tags.length > 0) metaParts.push(task.tags.map((tag) => `#${tag}`).join(' '));

    return (
        <View style={styles.rowContainer}>
            <View style={styles.row}>
                <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: task.completed }}
                    accessibilityLabel={`${task.name}を${task.completed ? '未完了' : '完了'}にする`}
                    onPress={() => onToggle(task.id)}
                    style={[styles.checkbox, task.completed && styles.checkboxDone]}
                >
                    {task.completed && <Text style={styles.checkmark}>✓</Text>}
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    accessibilityLabel={`${task.name}のサブタスクを開閉する`}
                    onPress={onExpand}
                    style={styles.rowBody}
                >
                    <Text numberOfLines={2} style={[styles.rowName, task.completed && styles.rowNameDone]}>{task.name}</Text>
                    {metaParts.length > 0 && (
                        <Text numberOfLines={1} style={[styles.rowMeta, overdue && styles.rowMetaOverdue]}>
                            {metaParts.join(' ・ ')}
                        </Text>
                    )}
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${task.name}を削除`}
                    onPress={() => onDelete(task.id)}
                    hitSlop={10}
                    style={({ pressed }) => [styles.deleteButton, pressed && styles.muted]}
                >
                    <Text style={styles.deleteSymbol}>×</Text>
                </Pressable>
            </View>
            {expanded && <SubtaskPanel task={task} />}
        </View>
    );
}

function SubtaskPanel({ task }: { task: Task }) {
    const addSubtask = useMobileTaskStore((state) => state.addSubtask);
    const deleteSubtask = useMobileTaskStore((state) => state.deleteSubtask);
    const toggleSubtaskComplete = useMobileTaskStore((state) => state.toggleSubtaskComplete);
    const [subtaskDraft, setSubtaskDraft] = useState('');

    const handleAdd = () => {
        if (addSubtask(task.id, subtaskDraft)) setSubtaskDraft('');
    };

    return (
        <View style={styles.subtaskPanel}>
            {task.subtasks.map((subtask) => (
                <View key={subtask.id} style={styles.subtaskRow}>
                    <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: subtask.completed }}
                        accessibilityLabel={`サブタスク${subtask.name}を${subtask.completed ? '未完了' : '完了'}にする`}
                        onPress={() => toggleSubtaskComplete(task.id, subtask.id)}
                        style={[styles.subtaskCheckbox, subtask.completed && styles.checkboxDone]}
                    >
                        {subtask.completed && <Text style={styles.subtaskCheckmark}>✓</Text>}
                    </Pressable>
                    <Text numberOfLines={1} style={[styles.subtaskName, subtask.completed && styles.rowNameDone]}>{subtask.name}</Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`サブタスク${subtask.name}を削除`}
                        onPress={() => deleteSubtask(task.id, subtask.id)}
                        hitSlop={8}
                        style={({ pressed }) => [styles.deleteButton, pressed && styles.muted]}
                    >
                        <Text style={styles.deleteSymbol}>×</Text>
                    </Pressable>
                </View>
            ))}
            <View style={styles.subtaskComposer}>
                <TextInput
                    value={subtaskDraft}
                    onChangeText={setSubtaskDraft}
                    onSubmitEditing={handleAdd}
                    placeholder="サブタスクを追加"
                    placeholderTextColor={theme.text.muted}
                    returnKeyType="done"
                    style={styles.subtaskInput}
                    maxLength={200}
                />
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="サブタスクを追加する"
                    disabled={!subtaskDraft.trim()}
                    onPress={handleAdd}
                    style={[styles.chip, !subtaskDraft.trim() && styles.muted]}
                >
                    <Text style={styles.chipText}>追加</Text>
                </Pressable>
            </View>
        </View>
    );
}

function StorageBadge({ ready }: { ready: boolean }) {
    return (
        <View style={styles.badge}>
            <View style={[styles.dot, ready && styles.dotReady]} />
            <Text style={styles.badgeText}>{ready ? '保存済み' : '読込中'}</Text>
        </View>
    );
}

function EmptyState({ title, body }: { title: string; body: string }) {
    return (
        <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{title}</Text>
            <Text style={styles.emptyBody}>{body}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    safeArea: { flex: 1, backgroundColor: theme.bg.primary },
    header: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { color: theme.text.primary, fontSize: 28, fontWeight: '800' },
    summary: { color: theme.text.secondary, fontSize: 13, marginTop: 3 },
    badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, height: 30, borderRadius: 8, backgroundColor: theme.bg.card, borderWidth: 1, borderColor: theme.border.default },
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.text.muted },
    dotReady: { backgroundColor: theme.accent.emerald },
    badgeText: { color: theme.text.secondary, fontSize: 11, fontWeight: '700' },
    composer: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginBottom: 10 },
    input: { flex: 1, height: 46, borderRadius: 8, paddingHorizontal: 14, color: theme.text.primary, backgroundColor: theme.bg.card, borderWidth: 1, borderColor: theme.border.default, fontSize: 15 },
    addButton: { width: 46, height: 46, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent.emerald },
    addSymbol: { color: theme.bg.primary, fontSize: 25, fontWeight: '700', lineHeight: 28 },
    muted: { opacity: 0.45 },
    chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, marginBottom: 10, flexWrap: 'wrap' },
    rowCaption: { color: theme.text.muted, fontSize: 12, fontWeight: '700', marginRight: 2 },
    chip: { height: 30, paddingHorizontal: 14, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg.secondary, borderWidth: 1, borderColor: theme.border.default },
    chipActive: { backgroundColor: theme.bg.cardHover, borderColor: theme.border.active },
    chipText: { color: theme.text.muted, fontSize: 12, fontWeight: '800' },
    chipTextActive: { color: theme.text.primary, fontSize: 12, fontWeight: '800' },
    detailsPanel: { marginHorizontal: 20, marginBottom: 10, padding: 12, gap: 10, borderRadius: 8, backgroundColor: theme.bg.card, borderWidth: 1, borderColor: theme.border.default },
    detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    tagInput: { flex: 1, height: 34, borderRadius: 8, paddingHorizontal: 10, color: theme.text.primary, backgroundColor: theme.bg.secondary, borderWidth: 1, borderColor: theme.border.default, fontSize: 13 },
    segmented: { marginHorizontal: 20, marginBottom: 12, padding: 3, borderRadius: 8, flexDirection: 'row', backgroundColor: theme.bg.secondary },
    segment: { flex: 1, height: 34, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
    segmentActive: { backgroundColor: theme.bg.cardHover },
    segmentText: { color: theme.text.muted, fontSize: 12, fontWeight: '700' },
    segmentTextActive: { color: theme.text.primary },
    list: { paddingHorizontal: 20, paddingBottom: 28, gap: 8 },
    emptyList: { flexGrow: 1 },
    rowContainer: { borderRadius: 8, backgroundColor: theme.bg.card, borderWidth: 1, borderColor: theme.border.default },
    row: { minHeight: 58, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 11 },
    checkbox: { width: 23, height: 23, borderRadius: 6, borderWidth: 2, borderColor: theme.text.muted, alignItems: 'center', justifyContent: 'center' },
    checkboxDone: { backgroundColor: theme.accent.emerald, borderColor: theme.accent.emerald },
    checkmark: { color: theme.bg.primary, fontSize: 14, fontWeight: '900' },
    rowBody: { flex: 1 },
    rowName: { color: theme.text.primary, fontSize: 15, lineHeight: 21 },
    rowNameDone: { color: theme.text.muted, textDecorationLine: 'line-through' },
    rowMeta: { color: theme.text.muted, fontSize: 11, marginTop: 3 },
    rowMetaOverdue: { color: theme.text.danger },
    deleteButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
    deleteSymbol: { color: theme.text.danger, fontSize: 23, lineHeight: 25 },
    subtaskPanel: { borderTopWidth: 1, borderTopColor: theme.border.default, paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
    subtaskRow: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 36 },
    subtaskCheckbox: { width: 19, height: 19, borderRadius: 5, borderWidth: 2, borderColor: theme.text.muted, alignItems: 'center', justifyContent: 'center' },
    subtaskCheckmark: { color: theme.bg.primary, fontSize: 11, fontWeight: '900' },
    subtaskName: { flex: 1, color: theme.text.primary, fontSize: 13 },
    subtaskComposer: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
    subtaskInput: { flex: 1, height: 34, borderRadius: 8, paddingHorizontal: 10, color: theme.text.primary, backgroundColor: theme.bg.secondary, borderWidth: 1, borderColor: theme.border.default, fontSize: 13 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 },
    emptyTitle: { color: theme.text.secondary, fontSize: 16, fontWeight: '700' },
    emptyBody: { color: theme.text.muted, fontSize: 13, marginTop: 7 },
});
