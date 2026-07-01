import { useState, useMemo, useCallback } from 'react';
import { Plus, Trash2, HeartPulse, MessageSquare, Sparkles, Filter, ArrowUpDown, ChevronRight } from 'lucide-react';
import { useHabitStore } from '../stores/useHabitStore';
import { useHabitSortStore, type HabitSortMode } from '../stores/useHabitSortStore';
import { getTodayJST } from '../utils/dateUtils';
import { HABIT_CATEGORIES, getCategoryById, DEFAULT_CATEGORY_ID } from '../config/habitCategories';
import type { Habit } from '../types';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useModalEscape } from '../hooks/useModalEscape';
import { HabitHeatmapModal } from '../components/habits/HabitHeatmapModal';

const HABIT_SORT_OPTIONS: { value: HabitSortMode; label: string }[] = [
    { value: 'createdAt', label: '作成順' },
    { value: 'name', label: '名前順' },
    { value: 'streak', label: 'ストリーク順' },
    { value: 'completionRate', label: '達成率順' },
];

export function HabitsPage() {
    const { habits, dailyRecords, restDays, addHabit, deleteHabit, toggleHabitCompletion, setHabitMemo, setRestDay, isRestDay, areAllHabitsComplete, getHabitStreak, getHabitCompletionRate } = useHabitStore();
    const { sortMode, setSortMode } = useHabitSortStore();
    const [showForm, setShowForm] = useState(false);
    const [name, setName] = useState('');
    const [selectedCategoryId, setSelectedCategoryId] = useState(DEFAULT_CATEGORY_ID);
    const [memoTarget, setMemoTarget] = useState<string | null>(null);
    const [memoText, setMemoText] = useState('');
    const [showRestConfirm, setShowRestConfirm] = useState(false);
    const [filterCategoryId, setFilterCategoryId] = useState<string | null>(null);
    const [historyHabitId, setHistoryHabitId] = useState<string | null>(null);

    const today = getTodayJST();
    const isRest = isRestDay(today);
    const allComplete = areAllHabitsComplete(today);
    const getRecordForHabit = (habitId: string) => dailyRecords.find((r) => r.habitId === habitId && r.date === today);

    // カテゴリ別に習慣をグルーピング（カテゴリ内は選択した並び順でソート）。
    // streak / rate は習慣ごとに 30 日分の走査が走るので、ソートと描画で再利用できるよう
    // 1 度だけ計算してマップにキャッシュする。
    const { groups: groupedHabits, statsMap } = useMemo(() => {
        const statsMap = new Map<string, { streak: number; rate: number | null }>();
        habits.forEach((h) => {
            statsMap.set(h.id, {
                streak: getHabitStreak(h.id),
                rate: getHabitCompletionRate(h.id),
            });
        });

        const groups: { categoryId: string; habits: Habit[] }[] = [];
        const categoryOrder = HABIT_CATEGORIES.map((c) => c.id);

        // フィルタリング
        const filteredHabits = filterCategoryId
            ? habits.filter((h) => (h.categoryId || DEFAULT_CATEGORY_ID) === filterCategoryId)
            : habits;

        const sortHabits = (a: Habit, b: Habit): number => {
            if (sortMode === 'name') return a.name.localeCompare(b.name);
            if (sortMode === 'streak') {
                return (statsMap.get(b.id)?.streak ?? 0) - (statsMap.get(a.id)?.streak ?? 0);
            }
            if (sortMode === 'completionRate') {
                // null（対象日なし）は最後に
                const rateA = statsMap.get(a.id)?.rate ?? -1;
                const rateB = statsMap.get(b.id)?.rate ?? -1;
                return rateB - rateA;
            }
            // createdAt: 古い順（既定）
            return a.createdAt.localeCompare(b.createdAt);
        };

        for (const catId of categoryOrder) {
            const habitsInCategory = filteredHabits
                .filter((h) => (h.categoryId || DEFAULT_CATEGORY_ID) === catId)
                .sort(sortHabits);
            if (habitsInCategory.length > 0) {
                groups.push({ categoryId: catId, habits: habitsInCategory });
            }
        }
        return { groups, statsMap };
        // dailyRecords も並び順（ストリーク/達成率）に影響するため依存に含める
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [habits, filterCategoryId, sortMode, dailyRecords, getHabitStreak, getHabitCompletionRate]);

    // 使用中のカテゴリID一覧（フィルタータブ用）
    const usedCategoryIds = useMemo(() => {
        const ids = new Set(habits.map((h) => h.categoryId || DEFAULT_CATEGORY_ID));
        return HABIT_CATEGORIES.filter((c) => ids.has(c.id));
    }, [habits]);

    const handleAddHabit = (e: React.FormEvent) => {
        e.preventDefault(); if (!name.trim()) return;
        addHabit(name.trim(), selectedCategoryId); setName(''); setSelectedCategoryId(DEFAULT_CATEGORY_ID); setShowForm(false);
    };

    const handleToggle = (habitId: string) => {
        const record = getRecordForHabit(habitId);
        const isCompleting = !record?.completed;
        toggleHabitCompletion(habitId, today);
        if (isCompleting) { setMemoTarget(habitId); setMemoText(record?.memo || ''); }
    };

    const handleSaveMemo = useCallback(() => { if (memoTarget) { setHabitMemo(memoTarget, today, memoText); setMemoTarget(null); setMemoText(''); } }, [memoTarget, memoText, today, setHabitMemo]);
    const handleRestDay = () => { setRestDay(today); setShowRestConfirm(false); };
    const closeMemo = useCallback(() => { setMemoTarget(null); setMemoText(''); }, []);
    useModalEscape(!!memoTarget, closeMemo);
    const completedCount = habits.filter((h) => getRecordForHabit(h.id)?.completed).length;

    return (
        <div className="app-page max-w-lg mx-auto px-4 pt-6">
            {/* ヘッダー */}
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>習慣</h1>
                    <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>本日: {completedCount}/{habits.length} 達成{isRest && <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-accent-sky)', color: 'white' }}>🩹 お休み中</span>}</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => setShowRestConfirm(true)} disabled={isRest} aria-label="今日をお休みにする" className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-105 disabled:opacity-40" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', color: 'var(--color-accent-sky)' }} title="お休み"><HeartPulse size={18} /></button>
                    <button onClick={() => { setShowForm(!showForm); setName(''); setSelectedCategoryId(DEFAULT_CATEGORY_ID); }} aria-label={showForm ? '習慣追加フォームを閉じる' : '新しい習慣を追加'} className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-105" style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}><Plus size={20} /></button>
                </div>
            </div>

            {/* プログレスバー */}
            {habits.length > 0 && <div className="mb-4"><div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}><div className="h-full rounded-full transition-all duration-500" style={{ width: `${habits.length > 0 ? (completedCount / habits.length) * 100 : 0}%`, backgroundColor: allComplete ? 'var(--color-accent-gold)' : 'var(--color-accent-emerald)' }} /></div>{allComplete && <div className="flex items-center gap-1 mt-2 animate-fade-in"><Sparkles size={14} style={{ color: 'var(--color-accent-gold)' }} /><span className="text-xs font-medium" style={{ color: 'var(--color-accent-gold)' }}>全習慣達成！ボーナスXPを獲得！</span></div>}</div>}

            {/* カテゴリフィルターバー */}
            {usedCategoryIds.length > 1 && (
                <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
                    <Filter size={14} className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
                    <button
                        onClick={() => setFilterCategoryId(null)}
                        className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200"
                        style={{
                            backgroundColor: filterCategoryId === null ? 'var(--color-accent-primary)' : 'var(--color-bg-card)',
                            color: filterCategoryId === null ? 'white' : 'var(--color-text-secondary)',
                            border: `1px solid ${filterCategoryId === null ? 'var(--color-accent-primary)' : 'var(--color-border-default)'}`,
                        }}
                    >
                        すべて
                    </button>
                    {usedCategoryIds.map((cat) => (
                        <button
                            key={cat.id}
                            onClick={() => setFilterCategoryId(filterCategoryId === cat.id ? null : cat.id)}
                            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200"
                            style={{
                                backgroundColor: filterCategoryId === cat.id ? cat.color + '22' : 'var(--color-bg-card)',
                                color: filterCategoryId === cat.id ? cat.color : 'var(--color-text-secondary)',
                                border: `1px solid ${filterCategoryId === cat.id ? cat.color : 'var(--color-border-default)'}`,
                            }}
                        >
                            <span>{cat.icon}</span>
                            {cat.name}
                        </button>
                    ))}
                </div>
            )}

            {/* 習慣追加フォーム */}
            {showForm && (
                <form onSubmit={handleAddHabit} className="mb-4 p-4 rounded-xl animate-fade-in" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="新しい習慣を入力..." autoFocus className="w-full px-3 py-2.5 rounded-lg text-sm outline-none mb-3" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }} />

                    {/* カテゴリ選択 */}
                    <div className="mb-3">
                        <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-text-muted)' }}>カテゴリ</p>
                        <div className="flex flex-wrap gap-1.5">
                            {HABIT_CATEGORIES.map((cat) => {
                                const isSelected = selectedCategoryId === cat.id;
                                return (
                                    <button
                                        key={cat.id}
                                        type="button"
                                        onClick={() => setSelectedCategoryId(cat.id)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 hover:scale-105"
                                        style={{
                                            backgroundColor: isSelected ? cat.color + '22' : 'var(--color-bg-secondary)',
                                            color: isSelected ? cat.color : 'var(--color-text-muted)',
                                            border: `1.5px solid ${isSelected ? cat.color : 'transparent'}`,
                                            boxShadow: isSelected ? `0 0 8px ${cat.color}33` : 'none',
                                        }}
                                    >
                                        <span className="text-sm">{cat.icon}</span>
                                        {cat.name}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex gap-2"><button type="submit" className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors hover:opacity-90" style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>追加</button><button type="button" onClick={() => setShowForm(false)} className="px-4 py-2.5 rounded-lg text-sm transition-colors hover:opacity-70" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}>キャンセル</button></div>
                </form>
            )}

            {/* 並び替え */}
            {habits.length > 0 && (
                <div className="flex items-center gap-2 mb-3">
                    <ArrowUpDown size={14} className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
                    <select
                        value={sortMode}
                        onChange={(e) => setSortMode(e.target.value as HabitSortMode)}
                        aria-label="習慣の並び替え"
                        className="px-3 py-1.5 rounded-lg text-xs outline-none"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-default)' }}
                    >
                        {HABIT_SORT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </div>
            )}

            {/* 習慣一覧（カテゴリ別グルーピング） */}
            <div className="flex flex-col gap-4">
                {habits.length === 0 && <div className="text-center py-16 opacity-60"><div className="flex justify-center mb-4"><div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg-card)' }}><Sparkles size={28} style={{ color: 'var(--color-text-muted)' }} /></div></div><p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>習慣がありません。<br />+ボタンから追加しましょう！</p></div>}

                {habits.length > 0 && groupedHabits.length === 0 && filterCategoryId && (
                    <div className="text-center py-12 opacity-60">
                        <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>このカテゴリには習慣がありません</p>
                    </div>
                )}

                {groupedHabits.map(({ categoryId, habits: categoryHabits }) => {
                    const category = getCategoryById(categoryId);
                    if (!category) return null;

                    const categoryCompletedCount = categoryHabits.filter(
                        (h) => getRecordForHabit(h.id)?.completed
                    ).length;

                    return (
                        <div key={categoryId} className="animate-fade-in">
                            {/* カテゴリヘッダー */}
                            <div className="flex items-center gap-2 mb-2 px-1">
                                <div
                                    className="w-6 h-6 rounded-lg flex items-center justify-center text-sm"
                                    style={{ backgroundColor: category.color + '22' }}
                                >
                                    {category.icon}
                                </div>
                                <span className="text-xs font-semibold tracking-wide" style={{ color: category.color }}>
                                    {category.name}
                                </span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: category.color + '18', color: category.color }}>
                                    {categoryCompletedCount}/{categoryHabits.length}
                                </span>
                                <div className="flex-1 h-px" style={{ backgroundColor: category.color + '25' }} />
                            </div>

                            {/* カテゴリ内の習慣リスト */}
                            <div className="flex flex-col gap-2">
                                {categoryHabits.map((habit) => {
                                    const record = getRecordForHabit(habit.id);
                                    const isCompleted = record?.completed ?? false;
                                    const stats = statsMap.get(habit.id);
                                    const streak = stats?.streak ?? 0;
                                    const completionRate = stats?.rate ?? null;

                                    return (
                                        <div
                                            key={habit.id}
                                            className="group flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200"
                                            style={{
                                                backgroundColor: isCompleted ? 'var(--color-bg-secondary)' : 'var(--color-bg-card)',
                                                border: `1px solid var(--color-border-default)`,
                                                borderLeft: `3px solid ${category.color}${isCompleted ? '55' : ''}`,
                                                opacity: isCompleted ? 0.7 : 1,
                                            }}
                                        >
                                            <button
                                                onClick={() => handleToggle(habit.id)}
                                                className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200"
                                                style={{
                                                    borderColor: isCompleted ? category.color : 'var(--color-accent-secondary)',
                                                    backgroundColor: isCompleted ? category.color : 'transparent',
                                                }}
                                            >
                                                {isCompleted && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" /></svg>}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setHistoryHabitId(habit.id)}
                                                className="flex-1 min-w-0 text-left rounded-lg focus:outline-none focus-visible:ring-2"
                                                style={{ '--tw-ring-color': category.color } as React.CSSProperties}
                                                aria-label={`「${habit.name}」の達成履歴を表示`}
                                            >
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    <p className={`text-sm font-medium ${isCompleted ? 'line-through' : ''}`} style={{ color: 'var(--color-text-primary)' }}>{habit.name}</p>
                                                    {streak > 0 && (
                                                        <span
                                                            className="text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
                                                            style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-accent-gold)', border: '1px solid var(--color-border-default)' }}
                                                        >
                                                            🔥 {streak}日連続
                                                        </span>
                                                    )}
                                                    {completionRate !== null && (
                                                        <span
                                                            className="text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
                                                            title="過去30日の達成率"
                                                            style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-accent-emerald)', border: '1px solid var(--color-border-default)' }}
                                                        >
                                                            📊 {completionRate}%
                                                        </span>
                                                    )}
                                                </div>
                                                {record?.memo && <p className="text-[11px] mt-0.5 flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}><MessageSquare size={10} />{record.memo}</p>}
                                            </button>
                                            <div className="flex items-center gap-1">
                                                <ChevronRight size={16} style={{ color: 'var(--color-text-muted)' }} aria-hidden="true" />
                                                <button onClick={() => deleteHabit(habit.id)} aria-label={`「${habit.name}」を削除`} className="p-1.5 rounded-lg transition-colors hover:opacity-70" style={{ color: 'var(--color-text-danger)' }}><Trash2 size={14} /></button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* メモモーダル */}
            {memoTarget && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4" onClick={(e) => { if (e.target === e.currentTarget) handleSaveMemo(); }}>
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="memo-modal-title"
                        className="w-full max-w-sm rounded-2xl p-5 animate-fade-in"
                        style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
                    >
                        <h3 id="memo-modal-title" className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>📝 一言メモ（任意）</h3>
                        <input type="text" value={memoText} onChange={(e) => setMemoText(e.target.value)} placeholder="今日の一言..." autoFocus className="w-full px-3 py-2.5 rounded-lg text-sm outline-none mb-4" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }} onKeyDown={(e) => { if (e.key === 'Enter') handleSaveMemo(); }} />
                        <div className="flex gap-2"><button onClick={handleSaveMemo} className="flex-1 py-2.5 rounded-lg text-sm font-medium" style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>保存</button><button onClick={closeMemo} className="px-4 py-2.5 rounded-lg text-sm" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}>スキップ</button></div>
                    </div>
                </div>
            )}

            {/* お休み確認モーダル */}
            <ConfirmDialog
                open={showRestConfirm}
                title="🩹 お休みにしますか？"
                message={<>本当に今日はお休みにしますか？<br />未達成デバフは免除されます。</>}
                confirmLabel="お休みにする"
                confirmColor="var(--color-accent-sky)"
                onConfirm={handleRestDay}
                onClose={() => setShowRestConfirm(false)}
            />

            {historyHabitId && (() => {
                const habit = habits.find((candidate) => candidate.id === historyHabitId);
                if (!habit) return null;
                const category = getCategoryById(habit.categoryId || DEFAULT_CATEGORY_ID);
                return (
                    <HabitHeatmapModal
                        habit={habit}
                        dailyRecords={dailyRecords}
                        restDays={restDays}
                        color={category?.color || 'var(--color-accent-emerald)'}
                        streak={statsMap.get(habit.id)?.streak ?? 0}
                        onClose={() => setHistoryHabitId(null)}
                    />
                );
            })()}
        </div>
    );
}
