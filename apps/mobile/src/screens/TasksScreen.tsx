import { useMemo, useRef, useState } from 'react';
import {
    Alert,
    FlatList,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    Share,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
    ArrowUpDown,
    CalendarClock,
    Check,
    CheckSquare,
    ChevronDown,
    ChevronRight,
    Copy,
    Download,
    Edit3,
    Flag,
    HelpCircle,
    ListPlus,
    Plus,
    Repeat,
    Search,
    Tag,
    Trash2,
    X,
} from 'lucide-react-native';
import { isValidYmd, shiftDate } from '@life-quest/core/dates';
import {
    TASK_LIMITS,
    captureCompletedTaskDeletion,
    tasksToCsv,
    type Priority,
    type Recurrence,
    type Task,
} from '@life-quest/core/tasks';
import { TaskBottomActions } from '../components/TaskBottomActions';
import {
    Chip,
    Choice,
    EmptyDaily,
    Field,
    FormActions,
    IconButton,
} from '../components/DailyScreenUI';
import { dailyStyles, ui } from '../theme/dailyScreenStyles';
import { useMobileTaskStore } from '../stores/useMobileTaskStore';
import { useTaskUndoToast } from '../hooks/useTaskUndoToast';
import { useTaskKeyboardVisibility } from '../hooks/useTaskKeyboardVisibility';
import { useInteractionScope } from '../hooks/useInteractionScope';
import { getTodayJst } from '../utils/date';
import { getTaskActionsBottomPadding, TASK_ACTION_LAYOUT, TAB_SCREEN_EDGES } from '../theme/layout';
import { usePalette } from '../theme/usePalette';
import {
    dueLabel,
    selectTasks,
    TASK_SORT_OPTIONS,
    type DueFilter,
    type TaskSort,
} from './dailyScreenModel';

const priorities = [
    ['low', '低'],
    ['medium', '中'],
    ['high', '高'],
] as const;
const recurrences = [
    ['none', 'なし'],
    ['daily', '毎日'],
    ['weekly', '毎週'],
    ['monthly', '毎月'],
] as const;

export default function TasksScreen() {
    const store = useMobileTaskStore();
    const { palette: p } = usePalette();
    const s = dailyStyles(p);
    const router = useRouter();
    const list = useRef<FlatList<Task>>(null);
    const pendingDelete = useRef<object | null>(null);
    const interactions = useInteractionScope(() => { pendingDelete.current = null; });
    const [query, setQuery] = useState('');
    const [due, setDue] = useState<DueFilter>('all');
    const [priority, setPriority] = useState<'all' | Priority>('all');
    const [tags, setTags] = useState<string[]>([]);
    const [sort, setSort] = useState<TaskSort>('dueDate');
    const [showForm, setShowForm] = useState(false);
    const [bottomActionsHeight, setBottomActionsHeight] = useState<number>(TASK_ACTION_LAYOUT.size);
    const inputVisibility = useTaskKeyboardVisibility(list, getTaskActionsBottomPadding(bottomActionsHeight));
    const [editing, setEditing] = useState<Task | null>(null);
    const [completedOpen, setCompletedOpen] = useState(false);
    const [expandOverrides, setExpandOverrides] = useState<
        Record<string, boolean>
    >({});
    const { toast, showUndo: undo } = useTaskUndoToast();
    const today = getTodayJst();
    const selected = useMemo(
        () => selectTasks(store.tasks, query, due, priority, tags, sort, today),
        [store.tasks, query, due, priority, tags, sort, today],
    );
    const open = selected.filter((task) => !task.completed);
    const done = selected.filter((task) => task.completed);
    const allTags = [
        ...new Set(store.tasks.flatMap((task) => task.tags)),
    ].sort();
    const pending = new Set(
        store.pendingCompletions.map((entry) => entry.taskId),
    );
    const deletable = store.tasks.filter(
        (task) => task.completed && !pending.has(task.id),
    ).length;
    const requestDeleteCompleted = () => {
        const isCurrent = interactions.capture();
        if (!isCurrent()) return;
        const current = useMobileTaskStore.getState();
        const approval = captureCompletedTaskDeletion(current.tasks, new Set(current.pendingCompletions.map((item) => item.taskId)));
        if (!approval.count) return;
        const token = {};
        pendingDelete.current = token;
        let used = false;
        const cancel = () => { used = true; if (pendingDelete.current === token) pendingDelete.current = null; };
        Alert.alert('完了タスクを削除しますか？', `完了済み${approval.count}件を削除します。この操作は取り消せません。`, [
            { text: 'キャンセル', style: 'cancel', onPress: cancel },
            { text: '削除する', style: 'destructive', onPress: () => {
                if (used || !isCurrent() || pendingDelete.current !== token) return;
                used = true;
                const latest = useMobileTaskStore.getState();
                const ids = approval.resolve(latest.tasks, new Set(latest.pendingCompletions.map((item) => item.taskId)));
                if (ids.length) store.deleteCompletedTasks(ids);
                cancel();
            } },
        ]);
    };
    const edit = (task: Task) => {
        setEditing(task);
        setShowForm(true);
        list.current?.scrollToOffset({ offset: 0, animated: true });
    };
    const toggle = (task: Task) => {
        if (task.subtasks.length > 0) {
            setExpandOverrides((current) => ({ ...current, [task.id]: true }));
            return;
        }
        store.toggleTask(task.id);
        if (!task.completed) {
            setCompletedOpen(true);
            undo(`「${task.name}」を完了しました`, () =>
                store.cancelPendingCompletion(task.id),
            );
        }
    };
    const duplicate = (task: Task) => {
        const id = store.duplicateTask(task.id);
        if (id)
            undo(`「${task.name}」を複製しました`, () => store.deleteTask(id));
        else
            Alert.alert(
                '複製できませんでした',
                'タスク数の上限に達している可能性があります。',
            );
    };
    const renderTask = (task: Task) => {
        const expanded = expandOverrides[task.id] ?? task.subtasks.length > 0;
        const overdue =
            !task.completed && task.dueDate !== null && task.dueDate < today;
        return (
            <View
                key={task.id}
                style={[
                    s.card,
                    {
                        marginBottom: 8,
                        backgroundColor: task.completed
                            ? p.bg.secondary
                            : p.bg.card,
                        borderColor: overdue ? p.text.danger : p.border.default,
                        opacity:
                            task.completed && !pending.has(task.id) ? 0.6 : 1,
                    },
                ]}
            >
                <View
                    style={[
                        ui.row,
                        { paddingHorizontal: 12, paddingVertical: 12 },
                    ]}
                >
                    <IconButton
                        icon={expanded ? ChevronDown : ChevronRight}
                        label={`タスク「${task.name}」を${expanded ? '折りたたむ' : '展開'}`}
                        onPress={() =>
                            setExpandOverrides((current) => ({
                                ...current,
                                [task.id]: !expanded,
                            }))
                        }
                    />
                    <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: task.completed }}
                        accessibilityLabel={`${task.name}を${task.completed ? '未完了' : '完了'}にする`}
                        onPress={() => toggle(task)}
                        hitSlop={5}
                        style={[
                            s.checkbox,
                            {
                                borderColor: task.completed
                                    ? p.accent.emerald
                                    : p.priority[task.priority],
                                backgroundColor: task.completed
                                    ? p.accent.emerald
                                    : 'transparent',
                            },
                        ]}
                    >
                        {task.completed && <Check size={12} color="#fff" />}
                    </Pressable>
                    <Pressable
                        onLongPress={() => edit(task)}
                        accessibilityLabel={task.name}
                        style={{ flex: 1 }}
                    >
                        <Text
                            style={[
                                s.name,
                                {
                                    color: overdue
                                        ? p.text.danger
                                        : p.text.primary,
                                    textDecorationLine: task.completed
                                        ? 'line-through'
                                        : 'none',
                                },
                            ]}
                        >
                            {task.name}
                        </Text>
                        <View style={[ui.wrap, { marginTop: 2 }]}>
                            {task.dueDate && (
                                <Text
                                    style={{
                                        fontSize: 11,
                                        color: overdue
                                            ? p.text.danger
                                            : p.text.muted,
                                    }}
                                >
                                    📅 {dueLabel(task.dueDate, today)}
                                </Text>
                            )}
                            <Text
                                style={[
                                    s.badge,
                                    {
                                        color: p.priority[task.priority],
                                        backgroundColor: `${p.priority[task.priority]}22`,
                                    },
                                ]}
                            >
                                {
                                    priorities.find(
                                        ([key]) => key === task.priority,
                                    )?.[1]
                                }
                            </Text>
                            {task.recurrence !== 'none' && (
                                <View style={ui.row}>
                                    <Repeat
                                        size={10}
                                        color={p.accent.primary}
                                    />
                                    <Text
                                        style={[
                                            s.badge,
                                            { color: p.accent.primary },
                                        ]}
                                    >
                                        {
                                            recurrences.find(
                                                ([key]) =>
                                                    key === task.recurrence,
                                            )?.[1]
                                        }
                                    </Text>
                                </View>
                            )}
                            {task.subtasks.length > 0 && (
                                <Text
                                    style={[
                                        s.badge,
                                        {
                                            color: p.accent.emerald,
                                            backgroundColor: p.bg.secondary,
                                        },
                                    ]}
                                >
                                    {
                                        task.subtasks.filter(
                                            (subtask) => subtask.completed,
                                        ).length
                                    }
                                    /{task.subtasks.length}
                                </Text>
                            )}
                            {task.tags.map((tag) => (
                                <Text
                                    key={tag}
                                    style={[
                                        s.badge,
                                        {
                                            color: p.text.muted,
                                            backgroundColor: p.bg.secondary,
                                            borderWidth: 1,
                                            borderColor: p.border.default,
                                        },
                                    ]}
                                >
                                    {tag}
                                </Text>
                            ))}
                        </View>
                    </Pressable>
                    <View style={{ flexDirection: 'row', gap: 1 }}>
                        <IconButton
                            icon={Copy}
                            label={`${task.name}を複製`}
                            onPress={() => duplicate(task)}
                        />
                        <IconButton
                            icon={Edit3}
                            label={`${task.name}を編集`}
                            onPress={() => edit(task)}
                        />
                        <IconButton
                            icon={Trash2}
                            label={`${task.name}を削除`}
                            color={p.text.danger}
                            onPress={() => store.deleteTask(task.id)}
                        />
                    </View>
                </View>
                {expanded && <Subtasks task={task} />}
            </View>
        );
    };
    return (
        <SafeAreaView edges={TAB_SCREEN_EDGES} style={s.safe}>
            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                {/* The inner flex viewport shrinks above the iOS keyboard padding. */}
                <View style={{ flex: 1 }} onLayout={inputVisibility.onLayout}>
                <FlatList
                    ref={list}
                    data={open}
                    keyExtractor={(task) => task.id}
                    renderItem={({ item }) => renderTask(item)}
                    contentContainerStyle={[s.page, { paddingBottom: getTaskActionsBottomPadding(bottomActionsHeight) }]}
                    keyboardShouldPersistTaps="handled"
                    onScroll={inputVisibility.onScroll}
                    scrollEventThrottle={16}
                    ListHeaderComponent={
                        <>
                            <View style={s.header}>
                                <View>
                                    <Text style={s.title}>タスク</Text>
                                    <Text style={s.summary}>
                                        {
                                            store.tasks.filter(
                                                (task) => !task.completed,
                                            ).length
                                        }
                                        件の未完了タスク
                                    </Text>
                                </View>
                                <View style={ui.row}>
                                    <IconButton
                                        round
                                        icon={Download}
                                        label="タスクをCSVで共有"
                                        color={p.accent.emerald}
                                        disabled={!store.tasks.length}
                                        onPress={() => {
                                            void Share.share({
                                                title: 'Life Quest タスク',
                                                message: tasksToCsv(
                                                    store.tasks,
                                                ),
                                            }).catch(() =>
                                                Alert.alert(
                                                    '共有できませんでした',
                                                    'もう一度お試しください。',
                                                ),
                                            );
                                        }}
                                    />
                                    <IconButton
                                        round
                                        icon={HelpCircle}
                                        label="使い方"
                                        color={p.accent.primary}
                                        onPress={() => router.push('/help')}
                                    />
                                </View>
                            </View>
                            {!store.hasHydrated && (
                                <Text style={s.summary}>読込中</Text>
                            )}
                            <View
                                style={[
                                    ui.row,
                                    {
                                        marginBottom: 12,
                                        backgroundColor: p.bg.secondary,
                                        borderRadius: 8,
                                        borderWidth: 1,
                                        borderColor: p.border.default,
                                        paddingHorizontal: 12,
                                    },
                                ]}
                            >
                                <Search size={15} color={p.text.muted} />
                                <Field
                                    accessibilityLabel="タスクを検索"
                                    placeholder="タスクを検索..."
                                    value={query}
                                    onChangeText={setQuery}
                                    style={{
                                        flex: 1,
                                        borderWidth: 0,
                                        paddingHorizontal: 0,
                                        paddingVertical: 8,
                                        minHeight: 36,
                                    }}
                                />
                                {query !== '' && (
                                    <IconButton
                                        icon={X}
                                        label="検索をクリア"
                                        onPress={() => setQuery('')}
                                    />
                                )}
                            </View>
                            <View style={[ui.row, { marginBottom: 12 }]}>
                                <CalendarClock size={14} color={p.text.muted} />
                                {(
                                    [
                                        ['all', 'すべて'],
                                        ['dueSoon', '今日まで'],
                                        ['overdue', '期限切れ'],
                                    ] as const
                                ).map(([key, label]) => (
                                    <Chip
                                        key={key}
                                        label={label}
                                        accessibilityLabel={`期限フィルター ${label}`}
                                        selected={due === key}
                                        onPress={() => setDue(key)}
                                    />
                                ))}
                            </View>
                            <View style={[ui.row, { marginBottom: 12 }]}>
                                <Flag size={14} color={p.text.muted} />
                                {(
                                    [
                                        ['all', 'すべて'],
                                        ...priorities.slice().reverse(),
                                    ] as const
                                ).map(([key, label]) => (
                                    <Chip
                                        key={key}
                                        label={label}
                                        accessibilityLabel={`優先度フィルター ${label}`}
                                        selected={priority === key}
                                        color={
                                            key === 'all'
                                                ? undefined
                                                : p.priority[key]
                                        }
                                        onPress={() => setPriority(key)}
                                    />
                                ))}
                            </View>
                            <View style={[ui.row, { marginBottom: 16 }]}>
                                <ArrowUpDown size={14} color={p.text.muted} />
                                <Choice
                                    label="並び替え"
                                    value={sort}
                                    options={TASK_SORT_OPTIONS}
                                    onChange={setSort}
                                />
                                {deletable > 0 && (
                                    <Pressable
                                        accessibilityRole="button"
                                        onPress={requestDeleteCompleted}
                                        style={[
                                            ui.row,
                                            {
                                                marginLeft: 'auto',
                                                borderWidth: 1,
                                                borderColor: p.border.default,
                                                borderRadius: 8,
                                                paddingHorizontal: 10,
                                                paddingVertical: 6,
                                                backgroundColor: p.bg.secondary,
                                            },
                                        ]}
                                    >
                                        <Trash2
                                            size={13}
                                            color={p.text.danger}
                                        />
                                        <Text
                                            style={{
                                                color: p.text.danger,
                                                fontSize: 12,
                                            }}
                                        >
                                            完了{deletable}件を削除
                                        </Text>
                                    </Pressable>
                                )}
                            </View>
                            {allTags.length > 0 && (
                                <View style={[ui.wrap, { marginBottom: 16 }]}>
                                    <Tag size={14} color={p.text.muted} />
                                    {allTags.map((tag) => (
                                        <Chip
                                            key={tag}
                                            label={tag}
                                            accessibilityLabel={`タグ絞り込み ${tag}`}
                                            selected={tags.includes(tag)}
                                            onPress={() =>
                                                setTags((current) =>
                                                    current.includes(tag)
                                                        ? current.filter(
                                                              (value) =>
                                                                  value !== tag,
                                                          )
                                                        : [...current, tag],
                                                )
                                            }
                                        />
                                    ))}
                                    {tags.length > 0 && (
                                        <IconButton
                                            icon={X}
                                            label="タグ絞り込みをクリア"
                                            onPress={() => setTags([])}
                                        />
                                    )}
                                </View>
                            )}
                            {showForm && (
                                <TaskComposer
                                    key={editing?.id ?? 'new'}
                                    task={editing}
                                    inputVisibility={inputVisibility}
                                    onClose={() => {
                                        setEditing(null);
                                        setShowForm(false);
                                        Keyboard.dismiss();
                                    }}
                                />
                            )}
                            {store.hasHydrated && selected.length === 0 && (
                                <EmptyDaily
                                    icon={CheckSquare}
                                    text={
                                        query.trim() ||
                                        tags.length ||
                                        due !== 'all' ||
                                        priority !== 'all'
                                            ? '該当するタスクがありません'
                                            : 'タスクがありません。\n+ボタンから追加しましょう！'
                                    }
                                />
                            )}
                        </>
                    }
                    ListFooterComponent={
                        done.length > 0 ? (
                            <View
                                style={[
                                    s.card,
                                    {
                                        backgroundColor: p.bg.secondary,
                                        marginTop: 8,
                                    },
                                ]}
                            >
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`完了タスク (${done.length})`}
                                    accessibilityState={{
                                        expanded: completedOpen,
                                    }}
                                    onPress={() =>
                                        setCompletedOpen((value) => !value)
                                    }
                                    style={[
                                        ui.row,
                                        {
                                            paddingHorizontal: 12,
                                            paddingVertical: 10,
                                        },
                                    ]}
                                >
                                    {completedOpen ? (
                                        <ChevronDown
                                            size={14}
                                            color={p.text.muted}
                                        />
                                    ) : (
                                        <ChevronRight
                                            size={14}
                                            color={p.text.muted}
                                        />
                                    )}
                                    <Text
                                        style={{
                                            fontSize: 12,
                                            color: p.text.muted,
                                            fontWeight: '500',
                                        }}
                                    >
                                        完了タスク ({done.length})
                                    </Text>
                                </Pressable>
                                {completedOpen && (
                                    <View style={{ paddingHorizontal: 8 }}>
                                        {done.map(renderTask)}
                                    </View>
                                )}
                            </View>
                        ) : null
                    }
                />
                <TaskBottomActions
                    formOpen={showForm}
                    toast={toast}
                    onHeightChange={setBottomActionsHeight}
                    onToggleForm={() => {
                        setEditing(null);
                        setShowForm((value) => !value);
                        list.current?.scrollToOffset({
                            offset: 0,
                            animated: true,
                        });
                    }}
                />
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

function TaskComposer({
    task,
    onClose,
    inputVisibility,
}: {
    task: Task | null;
    onClose: () => void;
    inputVisibility: Pick<ReturnType<typeof useTaskKeyboardVisibility>, 'onInputFocus' | 'onInputBlur'>;
}) {
    const { palette: p } = usePalette();
    const s = dailyStyles(p);
    const hydrated = useMobileTaskStore((state) => state.hasHydrated);
    const [name, setName] = useState(task?.name ?? '');
    const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
    const [priority, setPriority] = useState<Priority>(
        task?.priority ?? 'medium',
    );
    const [recurrence, setRecurrence] = useState<Recurrence>(
        task?.recurrence ?? 'none',
    );
    const [tags, setTags] = useState(task?.tags ?? []);
    const [tagDraft, setTagDraft] = useState('');
    const [subtasks, setSubtasks] = useState<{ id?: string; name: string }[]>(
        task?.subtasks ?? [],
    );
    const [subDraft, setSubDraft] = useState('');
    const [error, setError] = useState('');
    const addTag = () => {
        const value = tagDraft.trim();
        if (value && !tags.includes(value) && tags.length < TASK_LIMITS.maxTags)
            setTags((current) => [...current, value]);
        setTagDraft('');
    };
    const addSub = () => {
        if (subDraft.trim() && subtasks.length < TASK_LIMITS.maxSubtasks) {
            setSubtasks((current) => [...current, { name: subDraft.trim() }]);
            setSubDraft('');
        }
    };
    const save = () => {
        if (!name.trim()) {
            setError('タスク名を入力してください。');
            return;
        }
        if (dueDate && !isValidYmd(dueDate)) {
            setError('期限をYYYY-MM-DD形式の実在する日付で入力してください。');
            return;
        }
        const store = useMobileTaskStore.getState();
        let id = task?.id;
        if (task) {
            if (!store.tasks.some((current) => current.id === task.id)) {
                setError('このタスクは削除されています。');
                return;
            }
            if (
                !store.saveTaskEdits(
                    task.id,
                    { name, dueDate: dueDate || null, priority, recurrence, tags, subtasks },
                    task.subtasks.map((subtask) => subtask.id),
                )
            ) {
                setError(
                    '更新できませんでした。読み込み・同期状態やサブタスク数を確認してください。',
                );
                return;
            }
        } else {
            const before = new Set(store.tasks.map((current) => current.id));
            if (
                !store.addTask(name, priority, {
                    dueDate: dueDate || null,
                    recurrence,
                    tags,
                })
            ) {
                setError(
                    '追加できませんでした。読み込み状態やタスク数の上限を確認してください。',
                );
                return;
            }
            id = useMobileTaskStore
                .getState()
                .tasks.find((current) => !before.has(current.id))?.id;
        }
        if (id && !task)
            subtasks
                .filter((subtask) => !subtask.id)
                .forEach((subtask) => store.addSubtask(id!, subtask.name));
        onClose();
    };
    return (
        <View style={[s.form, { marginBottom: 24 }]}>
            <Field
                accessibilityLabel="タスク名"
                onFocus={inputVisibility.onInputFocus}
                onBlur={inputVisibility.onInputBlur}
                placeholder="タスク名を入力..."
                value={name}
                onChangeText={setName}
                maxLength={TASK_LIMITS.maxNameLength}
            />
            <View style={ui.row}>
                <View style={{ flex: 1, gap: 4 }}>
                    <Text style={s.label}>📅 期限</Text>
                    <Field
                        accessibilityLabel="期限 YYYY-MM-DD"
                        onFocus={inputVisibility.onInputFocus}
                        onBlur={inputVisibility.onInputBlur}
                        placeholder="YYYY-MM-DD"
                        value={dueDate}
                        onChangeText={setDueDate}
                        maxLength={10}
                        keyboardType="numbers-and-punctuation"
                    />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                    <Text style={s.label}>⚑ 重要度</Text>
                    <Choice
                        label="重要度"
                        value={priority}
                        options={priorities}
                        onChange={setPriority}
                    />
                </View>
            </View>
            <View style={ui.wrap}>
                {(
                    [
                        ['なし', ''],
                        ['今日', getTodayJst()],
                        ['明日', shiftDate(getTodayJst(), 1)],
                    ] as const
                ).map(([label, value]) => (
                    <Chip
                        key={label}
                        label={label}
                        accessibilityLabel={`期限を${label}にする`}
                        selected={dueDate === value}
                        onPress={() => setDueDate(value)}
                    />
                ))}
            </View>
            <Text style={s.label}>繰り返し</Text>
            <Choice
                label="繰り返し"
                value={recurrence}
                options={recurrences}
                onChange={setRecurrence}
            />
            <Text style={s.label}>タグ</Text>
            <View style={ui.wrap}>
                {tags.map((tag) => (
                    <Chip
                        key={tag}
                        label={`${tag} ×`}
                        selected
                        onPress={() =>
                            setTags((current) =>
                                current.filter((value) => value !== tag),
                            )
                        }
                    />
                ))}
            </View>
            <View style={ui.row}>
                <Field
                    accessibilityLabel="タグを入力"
                    onFocus={inputVisibility.onInputFocus}
                    onBlur={inputVisibility.onInputBlur}
                    placeholder="タグを入力"
                    value={tagDraft}
                    onChangeText={setTagDraft}
                    onSubmitEditing={addTag}
                    maxLength={TASK_LIMITS.maxTagLength}
                    style={{ flex: 1 }}
                />
                <IconButton
                    icon={Plus}
                    label="タグを追加する"
                    onPress={addTag}
                />
            </View>
            <Text style={s.label}>サブタスク</Text>
            {subtasks.map((subtask, index) => (
                <View key={subtask.id ?? index} style={ui.row}>
                    <Text style={[s.name, { flex: 1 }]}>{subtask.name}</Text>
                    <IconButton
                        icon={X}
                        label={`サブタスク${subtask.name}をフォームから削除`}
                        onPress={() =>
                            setSubtasks((current) =>
                                current.filter((_, i) => i !== index),
                            )
                        }
                    />
                </View>
            ))}
            <View style={ui.row}>
                <Field
                    accessibilityLabel="サブタスクを入力"
                    onFocus={inputVisibility.onInputFocus}
                    onBlur={inputVisibility.onInputBlur}
                    placeholder="サブタスクを入力"
                    value={subDraft}
                    onChangeText={setSubDraft}
                    onSubmitEditing={addSub}
                    maxLength={TASK_LIMITS.maxSubtaskNameLength}
                    style={{ flex: 1 }}
                />
                <IconButton
                    icon={ListPlus}
                    label="フォームにサブタスクを追加"
                    onPress={addSub}
                />
            </View>
            {error !== '' && (
                <Text accessibilityRole="alert" style={s.error}>
                    {error}
                </Text>
            )}
            <FormActions
                label={task ? '更新' : '追加'}
                onSave={save}
                onCancel={onClose}
                disabled={!hydrated}
            />
        </View>
    );
}

function Subtasks({ task }: { task: Task }) {
    const store = useMobileTaskStore();
    const { palette: p } = usePalette();
    const s = dailyStyles(p);
    const [draft, setDraft] = useState('');
    const add = () => {
        if (store.addSubtask(task.id, draft)) setDraft('');
    };
    return (
        <View
            style={{
                paddingLeft: 48,
                paddingRight: 16,
                paddingBottom: 16,
                gap: 8,
            }}
        >
            {task.subtasks.map((subtask) => (
                <View
                    key={subtask.id}
                    style={[
                        ui.row,
                        {
                            backgroundColor: p.bg.secondary,
                            borderWidth: 1,
                            borderColor: p.border.default,
                            borderRadius: 8,
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                        },
                    ]}
                >
                    <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: subtask.completed }}
                        accessibilityLabel={`サブタスク${subtask.name}を${subtask.completed ? '未完了' : '完了'}にする`}
                        onPress={() =>
                            store.toggleSubtaskComplete(task.id, subtask.id)
                        }
                        style={[
                            s.checkbox,
                            {
                                width: 16,
                                height: 16,
                                borderColor: subtask.completed
                                    ? p.accent.emerald
                                    : p.text.muted,
                                backgroundColor: subtask.completed
                                    ? p.accent.emerald
                                    : 'transparent',
                            },
                        ]}
                    >
                        {subtask.completed && <Check size={10} color="#fff" />}
                    </Pressable>
                    <Text
                        style={[
                            s.name,
                            {
                                flex: 1,
                                color: p.text.secondary,
                                textDecorationLine: subtask.completed
                                    ? 'line-through'
                                    : 'none',
                            },
                        ]}
                    >
                        {subtask.name}
                    </Text>
                    <IconButton
                        icon={X}
                        label={`サブタスク${subtask.name}を削除`}
                        color={p.text.danger}
                        onPress={() => store.deleteSubtask(task.id, subtask.id)}
                    />
                </View>
            ))}
            <View style={ui.row}>
                <Field
                    accessibilityLabel="サブタスクを追加"
                    placeholder="サブタスクを追加..."
                    value={draft}
                    onChangeText={setDraft}
                    onSubmitEditing={add}
                    maxLength={TASK_LIMITS.maxSubtaskNameLength}
                    style={{ flex: 1, minHeight: 36, paddingVertical: 8 }}
                />
                <IconButton
                    icon={ListPlus}
                    label={`${task.name}にサブタスクを追加`}
                    color={p.accent.primary}
                    onPress={add}
                />
            </View>
        </View>
    );
}
