import { useMemo, useRef, useState } from 'react';
import {
    Alert,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    SectionList,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
    ArrowUpDown,
    Check,
    ChevronRight,
    Filter,
    HeartPulse,
    HelpCircle,
    MessageSquare,
    Plus,
    Sparkles,
    Trash2,
} from 'lucide-react-native';
import {
    areAllHabitsComplete,
    captureHabitMemoEdit,
    buildHabitHeatmapData,
    getHabitCategoryByIdOrDefault,
    getHabitStreak,
    HABIT_CATEGORIES,
    HABIT_LIMITS,
    isRestDayOn,
    type Habit,
    type HabitHeatmapDay,
} from '@life-quest/core/habits';
import {
    Chip,
    Choice,
    Dialog,
    EmptyDaily,
    Field,
    FormActions,
    IconButton,
} from '../components/DailyScreenUI';
import { dailyStyles, ui } from '../theme/dailyScreenStyles';
import { useMobileHabitStore } from '../stores/useMobileHabitStore';
import { getTodayJst } from '../utils/date';
import { usePalette } from '../theme/usePalette';
import { useInteractionScope } from '../hooks/useInteractionScope';
import { TAB_SCREEN_EDGES } from '../theme/layout';
import { useRouter } from 'expo-router';
import {
    groupHabits,
    HABIT_SORT_OPTIONS,
    type HabitSort,
} from './dailyScreenModel';

type InputOwner = { isCurrent: () => boolean };
type MemoOwner = InputOwner & { habitId: string; date: string; accepts: ReturnType<typeof captureHabitMemoEdit> };

export default function HabitsScreen() {
    const router = useRouter();
    const store = useMobileHabitStore();
    const { palette: p } = usePalette();
    const s = dailyStyles(p);
    const [formOwner, setFormOwner] = useState<InputOwner | null>(null);
    const formRef = useRef<InputOwner | null>(null);
    const showForm = formOwner !== null;
    const [name, setName] = useState('');
    const [category, setCategory] = useState('other');
    const [error, setError] = useState('');
    const [filter, setFilter] = useState<string | null>(null);
    const [sort, setSort] = useState<HabitSort>('createdAt');
    const [memoOwner, setMemoOwner] = useState<MemoOwner | null>(null);
    const memoRef = useRef<MemoOwner | null>(null);
    const memoHabit = memoOwner?.habitId ?? null;
    const [memo, setMemo] = useState('');
    const [memoError, setMemoError] = useState('');
    const restRef = useRef<object | null>(null);
    const [historyId, setHistoryId] = useState<string | null>(null);
    const closeForm = () => { formRef.current = null; setFormOwner(null); setName(''); setCategory('other'); setError(''); Keyboard.dismiss(); };
    const closeMemo = () => { memoRef.current = null; setMemoOwner(null); setMemo(''); setMemoError(''); Keyboard.dismiss(); };
    const interactions = useInteractionScope(() => { closeForm(); closeMemo(); restRef.current = null; setHistoryId(null); });
    const isScreenCurrent = () => interactions.capture()();
    const ownsForm = () => formOwner !== null && formRef.current === formOwner && formOwner.isCurrent();
    const ownsMemo = () => memoOwner !== null && memoRef.current === memoOwner && memoOwner.isCurrent();
    const toggleForm = () => {
        if (!isScreenCurrent()) return;
        if (showForm) { closeForm(); return; }
        const owner = { isCurrent: interactions.capture() };
        formRef.current = owner; setFormOwner(owner); setName(''); setCategory('other'); setError('');
    };
    const requestRest = () => {
        if (!isScreenCurrent()) return;
        const isCurrent = interactions.capture();
        const date = getTodayJst();
        const owner = {}; restRef.current = owner;
        const cancel = () => { if (restRef.current === owner) restRef.current = null; };
        Alert.alert('🩹 お休みにしますか？', '本当に今日はお休みにしますか？\n未達成デバフは免除されます。', [
            { text: 'キャンセル', style: 'cancel', onPress: cancel },
            { text: 'お休みにする', onPress: () => {
                if (!isCurrent() || restRef.current !== owner) return;
                restRef.current = null;
                const current = useMobileHabitStore.getState();
                if (getTodayJst() === date && !isRestDayOn(current.restDays, date)) current.markRestDay(date);
            } },
        ], { onDismiss: cancel });
    };
    const today = getTodayJst();
    const rest = isRestDayOn(store.restDays, today);
    const completed = new Set(
        store.records
            .filter((record) => record.date === today && record.completed)
            .map((record) => record.habitId),
    );
    const count = store.habits.filter((habit) =>
        completed.has(habit.id),
    ).length;
    const allComplete = areAllHabitsComplete(
        store.habits,
        store.records,
        today,
    );
    const used = HABIT_CATEGORIES.filter((cat) =>
        store.habits.some(
            (habit) =>
                getHabitCategoryByIdOrDefault(habit.categoryId).id === cat.id,
        ),
    );
    const groups = useMemo(
        () =>
            groupHabits(
                store.habits,
                store.records,
                store.restDays,
                filter,
                sort,
                today,
            ).map((group) => ({
                category: group.category,
                data: group.habits,
            })),
        [store.habits, store.records, store.restDays, filter, sort, today],
    );
    const add = () => {
        if (!ownsForm()) return;
        if (!name.trim()) {
            setError('習慣名を入力してください。');
            return;
        }
        if (!useMobileHabitStore.getState().addHabit(name, category)) {
            setError(
                '追加できませんでした。読み込み状態や習慣数の上限を確認してください。',
            );
            return;
        }
        closeForm();
    };
    const toggle = (habit: Habit) => {
        if (!isScreenCurrent()) return;
        const date = getTodayJst();
        const before = useMobileHabitStore.getState().records.find(
            (record) => record.habitId === habit.id && record.date === date,
        );
        store.toggleToday(habit.id, date);
        if (!before?.completed) {
            const current = useMobileHabitStore.getState();
            const target = current.habits.find((item) => item.id === habit.id);
            const entry = current.records.find((item) => item.habitId === habit.id && item.date === date);
            if (!target || !entry?.completed) return;
            const owner = { isCurrent: interactions.capture(), habitId: habit.id, date, accepts: captureHabitMemoEdit(target, entry) };
            memoRef.current = owner; setMemoOwner(owner); setMemo(entry.memo); setMemoError('');
        }
    };
    const saveMemo = () => {
        if (!ownsMemo() || !memoOwner) return;
        if (getTodayJst() !== memoOwner.date) { setMemoError('日付が変わりました。入力内容を確認し、閉じてから操作し直してください。'); return; }
        const current = useMobileHabitStore.getState();
        if (!memoOwner.accepts(current.habits.find((item) => item.id === memoOwner.habitId),
            current.records.find((item) => item.habitId === memoOwner.habitId && item.date === memoOwner.date))) {
            setMemoError('この習慣または達成記録は変更されています。入力内容を確認し、閉じてから操作し直してください。'); return;
        }
        memoRef.current = null;
        current.setHabitMemo(memoOwner.habitId, memoOwner.date, memo); closeMemo();
    };
    const history = store.habits.find((habit) => habit.id === historyId);
    return (
        <SafeAreaView edges={TAB_SCREEN_EDGES} style={s.safe}>
            <KeyboardAvoidingView
                style={{ flex: 1 }}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <SectionList
                    sections={groups}
                    keyExtractor={(item) => item.habit.id}
                    stickySectionHeadersEnabled={false}
                    contentContainerStyle={s.page}
                    keyboardShouldPersistTaps="handled"
                    ListHeaderComponent={
                        <>
                            <View style={s.header}>
                                <View>
                                    <Text style={s.title}>習慣</Text>
                                    <Text style={s.summary}>
                                        本日: {count}/{store.habits.length} 達成
                                        {rest ? ' 🩹 お休み中' : ''}
                                    </Text>
                                </View>
                                <View style={ui.row}>
                                    <IconButton
                                        round
                                        icon={HeartPulse}
                                        color={p.accent.sky}
                                        label="今日をお休みにする"
                                        disabled={rest || !store.hasHydrated}
                                        onPress={requestRest}
                                    />
                                    <IconButton
                                        round
                                        filled
                                        icon={Plus}
                                        label={
                                            showForm
                                                ? '習慣追加フォームを閉じる'
                                                : '新しい習慣を追加'
                                        }
                                        onPress={toggleForm}
                                    />
                                </View>
                            </View>
                            {!store.hasHydrated && (
                                <Text style={s.summary}>読込中</Text>
                            )}
                            {store.habits.length > 0 && (
                                <View style={{ marginBottom: 16 }}>
                                    <View
                                        accessibilityRole="progressbar"
                                        accessibilityLabel={`本日 ${count} / ${store.habits.length} 達成`}
                                        accessibilityValue={{
                                            min: 0,
                                            max: store.habits.length,
                                            now: count,
                                        }}
                                        style={{
                                            height: 8,
                                            borderRadius: 4,
                                            overflow: 'hidden',
                                            backgroundColor: p.bg.secondary,
                                        }}
                                    >
                                        <View
                                            style={{
                                                height: 8,
                                                width: `${(count / store.habits.length) * 100}%`,
                                                backgroundColor: allComplete
                                                    ? p.accent.gold
                                                    : p.accent.emerald,
                                                borderRadius: 4,
                                            }}
                                        />
                                    </View>
                                    {allComplete && (
                                        <Text
                                            style={{
                                                fontSize: 12,
                                                color: p.accent.gold,
                                                marginTop: 8,
                                            }}
                                        >
                                            ✨ 全習慣達成！ボーナスXPを獲得！
                                        </Text>
                                    )}
                                </View>
                            )}
                            {used.length > 1 && (
                                <View style={[ui.wrap, { marginBottom: 16 }]}>
                                    <Filter size={14} color={p.text.muted} />
                                    <Chip
                                        label="すべて"
                                        selected={filter === null}
                                        onPress={() => setFilter(null)}
                                    />
                                    {used.map((cat) => (
                                        <Chip
                                            key={cat.id}
                                            label={`${cat.icon} ${cat.name}`}
                                            selected={filter === cat.id}
                                            color={cat.color}
                                            onPress={() =>
                                                setFilter((current) =>
                                                    current === cat.id
                                                        ? null
                                                        : cat.id,
                                                )
                                            }
                                        />
                                    ))}
                                </View>
                            )}
                            {showForm && (
                                <View style={s.form}>
                                    <Field
                                        accessibilityLabel="習慣名"
                                        placeholder="新しい習慣を入力..."
                                        value={name}
                                        onChangeText={(value) => { if (ownsForm()) setName(value); }}
                                        maxLength={HABIT_LIMITS.maxNameLength}
                                    />
                                    <Text style={s.label}>カテゴリ</Text>
                                    <View style={ui.wrap}>
                                        {HABIT_CATEGORIES.map((cat) => (
                                            <Chip
                                                key={cat.id}
                                                label={`${cat.icon} ${cat.name}`}
                                                accessibilityLabel={`カテゴリを${cat.name}にする`}
                                                selected={category === cat.id}
                                                color={cat.color}
                                                onPress={() => { if (ownsForm()) setCategory(cat.id); }}
                                            />
                                        ))}
                                    </View>
                                    {error !== '' && (
                                        <Text
                                            accessibilityRole="alert"
                                            style={s.error}
                                        >
                                            {error}
                                        </Text>
                                    )}
                                    <FormActions
                                        onSave={add}
                                        onCancel={() => {
                                            if (ownsForm()) closeForm();
                                        }}
                                        disabled={!store.hasHydrated}
                                    />
                                </View>
                            )}
                            {store.habits.length > 0 && (
                                <View style={[ui.row, { marginBottom: 12 }]}>
                                    <ArrowUpDown
                                        size={14}
                                        color={p.text.muted}
                                    />
                                    <Choice
                                        label="習慣の並び替え"
                                        value={sort}
                                        options={HABIT_SORT_OPTIONS}
                                        onChange={setSort}
                                    />
                                </View>
                            )}
                            {store.hasHydrated && store.habits.length === 0 && (
                                <EmptyDaily
                                    icon={Sparkles}
                                    text={
                                        '習慣がありません。\n+ボタンから追加しましょう！'
                                    }
                                />
                            )}
                            {store.habits.length > 0 && groups.length === 0 && (
                                <EmptyDaily
                                    icon={Filter}
                                    text="このカテゴリに習慣がありません"
                                />
                            )}
                        </>
                    }
                    renderSectionHeader={({ section }) => (
                        <View
                            style={[
                                ui.row,
                                { marginBottom: 8, paddingHorizontal: 4 },
                            ]}
                        >
                            <Text
                                style={{
                                    fontSize: 14,
                                    padding: 3,
                                    borderRadius: 8,
                                    backgroundColor: `${section.category.color}22`,
                                }}
                            >
                                {section.category.icon}
                            </Text>
                            <Text
                                style={{
                                    color: section.category.color,
                                    fontSize: 12,
                                    fontWeight: '600',
                                }}
                            >
                                {section.category.name}
                            </Text>
                            <Text
                                style={[
                                    s.badge,
                                    {
                                        color: section.category.color,
                                        backgroundColor: `${section.category.color}18`,
                                        borderRadius: 20,
                                    },
                                ]}
                            >
                                {
                                    section.data.filter((item) =>
                                        completed.has(item.habit.id),
                                    ).length
                                }
                                /{section.data.length}
                            </Text>
                            <View
                                style={{
                                    flex: 1,
                                    height: 1,
                                    backgroundColor: `${section.category.color}25`,
                                }}
                            />
                        </View>
                    )}
                    renderSectionFooter={() => <View style={{ height: 8 }} />}
                    renderItem={({ item, section }) => {
                        const done = completed.has(item.habit.id);
                        const record = store.records.find(
                            (entry) =>
                                entry.habitId === item.habit.id &&
                                entry.date === today,
                        );
                        return (
                            <View
                                style={[
                                    s.card,
                                    ui.row,
                                    {
                                        gap: 12,
                                        paddingHorizontal: 16,
                                        paddingVertical: 12,
                                        marginBottom: 8,
                                        borderLeftWidth: 3,
                                        borderLeftColor: done
                                            ? `${section.category.color}55`
                                            : section.category.color,
                                        backgroundColor: done
                                            ? p.bg.secondary
                                            : p.bg.card,
                                        opacity: done ? 0.7 : 1,
                                    },
                                ]}
                            >
                                <Pressable
                                    accessibilityRole="checkbox"
                                    accessibilityState={{ checked: done }}
                                    accessibilityLabel={`${item.habit.name}を${done ? '未達成' : '達成'}にする`}
                                    onPress={() => toggle(item.habit)}
                                    hitSlop={6}
                                    style={[
                                        s.checkbox,
                                        {
                                            borderRadius: 10,
                                            borderColor: done
                                                ? section.category.color
                                                : p.accent.secondary,
                                            backgroundColor: done
                                                ? section.category.color
                                                : 'transparent',
                                        },
                                    ]}
                                >
                                    {done && <Check size={12} color="#fff" />}
                                </Pressable>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`「${item.habit.name}」の達成履歴を表示`}
                                    onPress={() => { if (isScreenCurrent()) setHistoryId(item.habit.id); }}
                                    style={{ flex: 1 }}
                                >
                                    <View style={ui.wrap}>
                                        <Text
                                            style={[
                                                s.name,
                                                {
                                                    textDecorationLine: done
                                                        ? 'line-through'
                                                        : 'none',
                                                },
                                            ]}
                                        >
                                            {item.habit.name}
                                        </Text>
                                        {item.streak > 0 && (
                                            <Text
                                                style={[
                                                    s.badge,
                                                    {
                                                        color: p.accent.gold,
                                                        backgroundColor:
                                                            p.bg.secondary,
                                                        borderColor:
                                                            p.border.default,
                                                        borderWidth: 1,
                                                        borderRadius: 20,
                                                    },
                                                ]}
                                            >
                                                🔥 {item.streak}日連続
                                            </Text>
                                        )}
                                        {item.rate !== null && (
                                            <Text
                                                style={[
                                                    s.badge,
                                                    {
                                                        color: p.accent.emerald,
                                                        backgroundColor:
                                                            p.bg.secondary,
                                                        borderColor:
                                                            p.border.default,
                                                        borderWidth: 1,
                                                        borderRadius: 20,
                                                    },
                                                ]}
                                            >
                                                📊 {item.rate}%
                                            </Text>
                                        )}
                                    </View>
                                    {record?.memo && (
                                        <View
                                            style={[ui.row, { marginTop: 2 }]}
                                        >
                                            <MessageSquare
                                                size={10}
                                                color={p.text.muted}
                                            />
                                            <Text
                                                style={{
                                                    fontSize: 11,
                                                    color: p.text.muted,
                                                    flex: 1,
                                                }}
                                            >
                                                {record.memo}
                                            </Text>
                                        </View>
                                    )}
                                </Pressable>
                                <View style={ui.row}>
                                    <ChevronRight
                                        size={16}
                                        color={p.text.muted}
                                    />
                                    <IconButton
                                        icon={Trash2}
                                        label={`「${item.habit.name}」を削除`}
                                        color={p.text.danger}
                                        onPress={() =>
                                            store.deleteHabit(item.habit.id)
                                        }
                                    />
                                </View>
                            </View>
                        );
                    }}
                />
                <View style={{ position: 'absolute', right: 16, bottom: 12 }}>
                    <IconButton
                        round
                        icon={HelpCircle}
                        label="使い方"
                        color={p.accent.primary}
                        onPress={() => router.push('/help')}
                    />
                </View>
                {memoHabit && (
                    <Dialog
                        title="📝 一言メモ（任意）"
                        onClose={() => { if (ownsMemo()) closeMemo(); }}
                    >
                        <Field
                            accessibilityLabel="今日の一言"
                            placeholder="今日の一言..."
                            value={memo}
                            onChangeText={(value) => { if (ownsMemo()) setMemo(value); }}
                            maxLength={HABIT_LIMITS.maxMemoLength}
                            onSubmitEditing={saveMemo}
                        />
                        {memoError !== '' && <Text accessibilityRole="alert" style={s.error}>{memoError}</Text>}
                        <View style={ui.row}>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="習慣メモを保存"
                                onPress={saveMemo}
                                style={[
                                    ui.primary,
                                    { backgroundColor: p.accent.primary },
                                ]}
                            >
                                <Text style={ui.primaryText}>保存</Text>
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="習慣メモをスキップ"
                                onPress={() => {
                                    if (ownsMemo()) closeMemo();
                                }}
                                style={[
                                    ui.cancel,
                                    { backgroundColor: p.bg.secondary },
                                ]}
                            >
                                <Text style={{ color: p.text.muted }}>
                                    スキップ
                                </Text>
                            </Pressable>
                        </View>
                    </Dialog>
                )}
                {history && (
                    <HabitHistory
                        habit={history}
                        onClose={() => setHistoryId(null)}
                    />
                )}
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

function HabitHistory({
    habit,
    onClose,
}: {
    habit: Habit;
    onClose: () => void;
}) {
    const store = useMobileHabitStore();
    const { palette: p } = usePalette();
    const category = getHabitCategoryByIdOrDefault(habit.categoryId);
    const [selected, setSelected] = useState<HabitHeatmapDay | null>(null);
    const historyScroll = useRef<ScrollView>(null);
    const data = useMemo(
        () =>
            buildHabitHeatmapData(
                habit,
                store.records,
                store.restDays,
                getTodayJst(),
                180,
            ),
        [habit, store.records, store.restDays],
    );
    const labels = {
        completed: '達成',
        rest: 'お休み',
        missed: '未達成',
        pending: '未記録',
        'before-created': '作成前',
    };
    const padding = new Date(`${data.days[0].date}T00:00:00Z`).getUTCDay();
    const days = [...Array<null>(padding).fill(null), ...data.days];
    return (
        <Dialog title={habit.name} onClose={onClose}>
            <Text style={{ color: p.text.muted, fontSize: 12 }}>
                過去180日の達成履歴
            </Text>
            <View style={ui.row}>
                {[
                    ['達成', `${data.completedCount}日`],
                    ['達成率', `${data.completionRate ?? 0}%`],
                    [
                        '現在',
                        `${getHabitStreak({ habit, records: store.records, restDays: store.restDays, today: getTodayJst() })}日`,
                    ],
                ].map(([label, value]) => (
                    <View
                        key={label}
                        style={{
                            flex: 1,
                            backgroundColor: p.bg.secondary,
                            padding: 12,
                            borderRadius: 8,
                        }}
                    >
                        <Text style={{ color: p.text.muted, fontSize: 10 }}>
                            {label}
                        </Text>
                        <Text
                            style={{
                                color: category.color,
                                fontSize: 18,
                                fontWeight: '700',
                            }}
                        >
                            {value}
                        </Text>
                    </View>
                ))}
            </View>
            <ScrollView
                ref={historyScroll}
                onContentSizeChange={() =>
                    historyScroll.current?.scrollToEnd({ animated: false })
                }
                horizontal
                showsHorizontalScrollIndicator
                contentContainerStyle={{ gap: 4 }}
            >
                <View style={{ gap: 4 }}>
                    {['日', '月', '火', '水', '木', '金', '土'].map((label) => (
                        <Text
                            key={label}
                            style={{
                                fontSize: 9,
                                height: 16,
                                width: 16,
                                color: p.text.muted,
                            }}
                        >
                            {label}
                        </Text>
                    ))}
                </View>
                {Array.from(
                    { length: Math.ceil(days.length / 7) },
                    (_, week) => (
                        <View key={week} style={{ gap: 4 }}>
                            {days
                                .slice(week * 7, week * 7 + 7)
                                .map((day, index) =>
                                    day ? (
                                        <Pressable
                                            key={day.date}
                                            accessibilityRole="button"
                                            accessibilityLabel={`${day.date}: ${labels[day.status]}`}
                                            onPress={() => setSelected(day)}
                                            style={{
                                                width: 16,
                                                height: 16,
                                                borderRadius: 3,
                                                borderWidth: 1,
                                                borderColor:
                                                    day.status === 'completed'
                                                        ? category.color
                                                        : p.border.default,
                                                backgroundColor:
                                                    day.status === 'completed'
                                                        ? category.color
                                                        : day.status === 'rest'
                                                          ? p.accent.sky
                                                          : p.bg.secondary,
                                                opacity:
                                                    day.status ===
                                                    'before-created'
                                                        ? 0.35
                                                        : 1,
                                            }}
                                        />
                                    ) : (
                                        <View
                                            key={index}
                                            style={{ width: 16, height: 16 }}
                                        />
                                    ),
                                )}
                        </View>
                    ),
                )}
            </ScrollView>
            <Text
                style={{
                    color: p.text.secondary,
                    backgroundColor: p.bg.secondary,
                    padding: 12,
                    borderRadius: 8,
                    minHeight: 44,
                }}
            >
                {selected
                    ? `${selected.date} ${labels[selected.status]}${selected.memo ? `\n${selected.memo}` : ''}`
                    : '日付を押すと記録の詳細を確認できます'}
            </Text>
        </Dialog>
    );
}
