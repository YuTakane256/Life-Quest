import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addRecurrenceInterval, TASK_LIMITS, TASK_UNDO_DURATION_MS, type Priority, type Recurrence, type Task } from '@life-quest/core/tasks';
import { UndoToast } from '../components/UndoToast';
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
    const pendingCompletions = useMobileTaskStore((state) => state.pendingCompletions);
    const addTask = useMobileTaskStore((state) => state.addTask);
    const toggleTask = useMobileTaskStore((state) => state.toggleTask);
    const deleteTask = useMobileTaskStore((state) => state.deleteTask);
    const duplicateTask = useMobileTaskStore((state) => state.duplicateTask);
    const deleteCompletedTasks = useMobileTaskStore((state) => state.deleteCompletedTasks);
    const cancelPendingCompletion = useMobileTaskStore((state) => state.cancelPendingCompletion);

    const [draft, setDraft] = useState('');
    const [priority, setPriority] = useState<Priority>('medium');
    const [filter, setFilter] = useState<TaskFilter>('open');
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [dueChoice, setDueChoice] = useState<DueChoice>('none');
    const [recurrence, setRecurrence] = useState<Recurrence>('none');
    const [tagDraft, setTagDraft] = useState('');
    const [tags, setTags] = useState<readonly string[]>([]);
    const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
    const [actionTask, setActionTask] = useState<Task | null>(null);
    const [editTask, setEditTask] = useState<Task | null>(null);
    const [toast, setToast] = useState<{ message: string; onUndo: () => void } | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 取消トーストはUndo猶予と同じ時間で自動消滅する
    const showUndoToast = (message: string, onUndo: () => void) => {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast({ message, onUndo });
        toastTimer.current = setTimeout(() => setToast(null), TASK_UNDO_DURATION_MS);
    };
    useEffect(() => () => {
        if (toastTimer.current) clearTimeout(toastTimer.current);
    }, []);

    const visibleTasks = useMemo(
        () => tasks.filter((task) => filter === 'all' || (filter === 'done' ? task.completed : !task.completed)),
        [filter, tasks],
    );
    const openCount = tasks.filter((task) => !task.completed).length;
    const pendingIds = useMemo(() => new Set(pendingCompletions.map((pending) => pending.taskId)), [pendingCompletions]);
    // Undo待機中は削除対象から除外する（Webと同一計算）
    const deletableDoneCount = tasks.filter((task) => task.completed && !pendingIds.has(task.id)).length;

    const handleToggle = (task: Task) => {
        toggleTask(task.id);
        if (!task.completed) {
            showUndoToast(`「${task.name}」を完了しました`, () => {
                cancelPendingCompletion(task.id);
                setToast(null);
            });
        }
    };

    const handleDuplicate = (task: Task) => {
        const newId = duplicateTask(task.id);
        setActionTask(null);
        if (!newId) return;
        showUndoToast(`「${task.name}」を複製しました`, () => {
            deleteTask(newId);
            setToast(null);
        });
    };

    const handleBulkDelete = () => {
        Alert.alert(
            '完了タスクを削除しますか？',
            `完了済みのタスク${deletableDoneCount}件を削除します。この操作は取り消せません。`,
            [
                { text: 'キャンセル', style: 'cancel' },
                { text: '削除', style: 'destructive', onPress: () => { deleteCompletedTasks(); } },
            ],
        );
    };

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

                {filter === 'done' && deletableDoneCount > 0 && (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`完了済みのタスク${deletableDoneCount}件をまとめて削除する`}
                        onPress={handleBulkDelete}
                        style={({ pressed }) => [styles.bulkDeleteButton, pressed && styles.muted]}
                    >
                        <Text style={styles.bulkDeleteText}>完了済みをまとめて削除（{deletableDoneCount}件）</Text>
                    </Pressable>
                )}

                <FlatList
                    data={visibleTasks}
                    keyExtractor={(task) => task.id}
                    extraData={expandedTaskId}
                    renderItem={({ item }) => (
                        <TaskRow
                            task={item}
                            expanded={expandedTaskId === item.id}
                            onToggle={() => handleToggle(item)}
                            onDelete={deleteTask}
                            onExpand={() => setExpandedTaskId((current) => current === item.id ? null : item.id)}
                            onLongPress={() => setActionTask(item)}
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

                {toast && <UndoToast message={toast.message} onAction={toast.onUndo} />}
            </KeyboardAvoidingView>

            {/* 長押しアクションメニュー（編集/複製/削除） */}
            <Modal visible={actionTask !== null} transparent animationType="fade" onRequestClose={() => setActionTask(null)}>
                <Pressable style={styles.modalBackdrop} onPress={() => setActionTask(null)}>
                    <View style={styles.actionSheet}>
                        <Text style={styles.actionSheetTitle} numberOfLines={1}>{actionTask?.name}</Text>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="タスクを編集する"
                            onPress={() => { setEditTask(actionTask); setActionTask(null); }}
                            style={({ pressed }) => [styles.actionItem, pressed && styles.muted]}
                        >
                            <Text style={styles.actionItemText}>編集</Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="タスクを複製する"
                            onPress={() => actionTask && handleDuplicate(actionTask)}
                            style={({ pressed }) => [styles.actionItem, pressed && styles.muted]}
                        >
                            <Text style={styles.actionItemText}>複製</Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="タスクを削除する"
                            onPress={() => { if (actionTask) deleteTask(actionTask.id); setActionTask(null); }}
                            style={({ pressed }) => [styles.actionItem, pressed && styles.muted]}
                        >
                            <Text style={[styles.actionItemText, styles.actionItemDanger]}>削除</Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="メニューを閉じる"
                            onPress={() => setActionTask(null)}
                            style={({ pressed }) => [styles.actionItem, pressed && styles.muted]}
                        >
                            <Text style={styles.actionItemCancel}>キャンセル</Text>
                        </Pressable>
                    </View>
                </Pressable>
            </Modal>

            {editTask && (
                <TaskEditModal
                    task={editTask}
                    onClose={() => setEditTask(null)}
                />
            )}
        </SafeAreaView>
    );
}

function TaskRow({ task, expanded, onToggle, onDelete, onExpand, onLongPress }: {
    task: Task;
    expanded: boolean;
    onToggle: (id: string) => void;
    onDelete: (id: string) => void;
    onExpand: () => void;
    onLongPress: () => void;
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
                    accessibilityLabel={`${task.name}のサブタスクを開閉する。長押しで編集メニュー`}
                    onPress={onExpand}
                    onLongPress={onLongPress}
                    delayLongPress={350}
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

type EditDueChoice = 'keep' | DueChoice;

/** タスク編集モーダル（#512）。名前・期限・優先度・繰り返し・タグをWebの編集フォームと同じ項目で更新する。 */
function TaskEditModal({ task, onClose }: { task: Task; onClose: () => void }) {
    const updateTask = useMobileTaskStore((state) => state.updateTask);
    const [name, setName] = useState(task.name);
    const [priority, setPriority] = useState<Priority>(task.priority);
    const [dueChoice, setDueChoice] = useState<EditDueChoice>('keep');
    const [tags, setTags] = useState<readonly string[]>(task.tags);
    const [tagDraft, setTagDraft] = useState('');

    const dueOptions: readonly { value: EditDueChoice; label: string }[] = [
        { value: 'keep', label: task.dueDate ? `現在 ${task.dueDate.slice(5).replace('-', '/')}` : '現在 なし' },
        ...DUE_OPTIONS,
    ];

    const handleAddTag = () => {
        const tag = tagDraft.trim();
        if (!tag || tags.includes(tag) || tags.length >= TASK_LIMITS.maxTags) return;
        setTags((current) => [...current, tag]);
        setTagDraft('');
    };

    const handleSave = () => {
        const trimmed = name.trim();
        if (!trimmed) return;
        updateTask(task.id, {
            name: trimmed.slice(0, TASK_LIMITS.maxNameLength),
            priority,
            dueDate: dueChoice === 'keep' ? task.dueDate : resolveDueDate(dueChoice),
            tags: [...tags],
        });
        onClose();
    };

    return (
        <Modal visible transparent animationType="slide" onRequestClose={onClose}>
            <View style={styles.modalBackdrop}>
                <View style={styles.editSheet}>
                    <Text style={styles.editTitle}>タスクを編集</Text>
                    <TextInput
                        value={name}
                        onChangeText={setName}
                        accessibilityLabel="タスク名"
                        placeholder="タスク名"
                        placeholderTextColor={theme.text.muted}
                        style={styles.input}
                        maxLength={TASK_LIMITS.maxNameLength}
                    />
                    <View style={styles.detailRow}>
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
                    </View>
                    <View style={styles.detailRow}>
                        <Text style={styles.rowCaption}>期限</Text>
                        {dueOptions.map((option) => (
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
                        <Text style={styles.rowCaption}>タグ</Text>
                        <TextInput
                            value={tagDraft}
                            onChangeText={setTagDraft}
                            onSubmitEditing={handleAddTag}
                            placeholder="タグを追加"
                            placeholderTextColor={theme.text.muted}
                            returnKeyType="done"
                            style={styles.tagInput}
                            maxLength={TASK_LIMITS.maxTagLength}
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
                    <View style={styles.editActions}>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="編集をキャンセルする"
                            onPress={onClose}
                            style={({ pressed }) => [styles.editCancel, pressed && styles.muted]}
                        >
                            <Text style={styles.editCancelText}>キャンセル</Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="編集を保存する"
                            disabled={!name.trim()}
                            onPress={handleSave}
                            style={({ pressed }) => [styles.editSave, (!name.trim() || pressed) && styles.muted]}
                        >
                            <Text style={styles.editSaveText}>保存</Text>
                        </Pressable>
                    </View>
                </View>
            </View>
        </Modal>
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
    bulkDeleteButton: { marginHorizontal: 20, marginBottom: 8, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg.card, borderWidth: 1, borderColor: theme.text.danger },
    bulkDeleteText: { color: theme.text.danger, fontSize: 13, fontWeight: '700' },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.55)', justifyContent: 'flex-end' },
    actionSheet: { backgroundColor: theme.bg.card, borderTopLeftRadius: 14, borderTopRightRadius: 14, paddingVertical: 10, paddingHorizontal: 14, paddingBottom: 28, gap: 2 },
    actionSheetTitle: { color: theme.text.muted, fontSize: 12, fontWeight: '700', paddingVertical: 8, textAlign: 'center' },
    actionItem: { height: 46, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg.secondary, marginTop: 6 },
    actionItemText: { color: theme.text.primary, fontSize: 15, fontWeight: '700' },
    actionItemDanger: { color: theme.text.danger },
    actionItemCancel: { color: theme.text.muted, fontSize: 14, fontWeight: '700' },
    editSheet: { backgroundColor: theme.bg.card, borderTopLeftRadius: 14, borderTopRightRadius: 14, padding: 16, paddingBottom: 30, gap: 10 },
    editTitle: { color: theme.text.primary, fontSize: 16, fontWeight: '800' },
    editActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
    editCancel: { flex: 1, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg.secondary, borderWidth: 1, borderColor: theme.border.default },
    editCancelText: { color: theme.text.secondary, fontSize: 14, fontWeight: '700' },
    editSave: { flex: 1, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent.primary },
    editSaveText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
    emptyBody: { color: theme.text.muted, fontSize: 13, marginTop: 7 },
});
