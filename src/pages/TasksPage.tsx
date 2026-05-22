import { useState, useMemo } from 'react';
import { Plus, Trash2, Edit3, Calendar, Flag, X, Tag, ChevronDown, ChevronRight, ListPlus, Repeat, ArrowUpDown, Search } from 'lucide-react';
import { useTaskStore } from '../stores/useTaskStore';
import { useTaskSortStore, type TaskSortMode } from '../stores/useTaskSortStore';
import { useSnackbar } from '../components/ui/SnackbarProvider';
import { isOverdue, generateId, formatRelativeDate } from '../utils/dateUtils';
import type { Priority, Recurrence, Task, Subtask } from '../types';

const PRIORITY_LABELS: Record<Priority, string> = { low: '低', medium: '中', high: '高' };
const PRIORITY_COLORS: Record<Priority, string> = { low: 'var(--color-priority-low)', medium: 'var(--color-priority-medium)', high: 'var(--color-priority-high)' };
const RECURRENCE_LABELS: Record<Recurrence, string> = { none: 'なし', daily: '毎日', weekly: '毎週', monthly: '毎月' };
// 優先度の並び順（高い順）
const PRIORITY_SORT_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

export function TasksPage() {
    const { tasks, addTask, updateTask, deleteTask, toggleComplete, addSubtask, deleteSubtask, toggleSubtaskComplete, cancelPendingCompletion, pendingCompletions } = useTaskStore();
    const { sortMode, setSortMode } = useTaskSortStore();
    const { showUndo } = useSnackbar();
    const [showForm, setShowForm] = useState(false);
    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [name, setName] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [priority, setPriority] = useState<Priority>('medium');
    const [recurrence, setRecurrence] = useState<Recurrence>('none');
    const [tagInput, setTagInput] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [expandOverrides, setExpandOverrides] = useState<Record<string, boolean>>({});
    const [subtaskInputs, setSubtaskInputs] = useState<Record<string, string>>({});
    const [formSubtasks, setFormSubtasks] = useState<Subtask[]>([]);
    const [formSubtaskInput, setFormSubtaskInput] = useState('');

    // 全タスクからユニークなタグを抽出
    const allTags = useMemo(() => {
        const tagSet = new Set<string>();
        tasks.forEach((t) => (t.tags || []).forEach((tag) => tagSet.add(tag)));
        return Array.from(tagSet).sort();
    }, [tasks]);

    // フィルタリング（タグ絞り込み + 名前検索）
    const filteredTasks = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        return tasks.filter((t) => {
            const matchesTags =
                selectedTags.length === 0 ||
                selectedTags.every((tag) => (t.tags || []).includes(tag));
            const matchesSearch = query === '' || t.name.toLowerCase().includes(query);
            return matchesTags && matchesSearch;
        });
    }, [tasks, selectedTags, searchQuery]);

    const sortedTasks = useMemo(() => {
        const compareByMode = (a: Task, b: Task): number => {
            if (sortMode === 'priority') {
                return PRIORITY_SORT_ORDER[a.priority] - PRIORITY_SORT_ORDER[b.priority];
            }
            if (sortMode === 'createdAt') {
                // 作成日が新しい順
                return b.createdAt.localeCompare(a.createdAt);
            }
            // dueDate: 期限が近い順。期限なしは末尾
            if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
            if (a.dueDate) return -1;
            if (b.dueDate) return 1;
            return 0;
        };
        return [...filteredTasks].sort((a, b) => {
            // 完了タスクは常に末尾にまとめる
            if (a.completed !== b.completed) return a.completed ? 1 : -1;
            return compareByMode(a, b);
        });
    }, [filteredTasks, sortMode]);

    const resetForm = () => {
        setName(''); setDueDate(''); setPriority('medium'); setRecurrence('none');
        setTags([]); setTagInput('');
        setFormSubtasks([]); setFormSubtaskInput('');
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        if (editingTask) {
            updateTask(editingTask.id, { name: name.trim(), dueDate: dueDate || null, priority, recurrence, tags, subtasks: formSubtasks });
            setEditingTask(null);
        } else {
            addTask(name.trim(), dueDate || null, priority, recurrence, tags, formSubtasks);
        }
        resetForm();
        setShowForm(false);
    };

    const handleEdit = (task: Task) => {
        setEditingTask(task);
        setName(task.name);
        setDueDate(task.dueDate || '');
        setPriority(task.priority);
        setRecurrence(task.recurrence || 'none');
        setTags(task.tags || []);
        setTagInput('');
        setFormSubtasks(task.subtasks || []);
        setFormSubtaskInput('');
        setShowForm(true);
    };

    const handleToggleComplete = (task: Task) => {
        if ((task.subtasks || []).length > 0) {
            setExpandOverrides((prev) => ({ ...prev, [task.id]: true }));
            return;
        }
        if (!task.completed) {
            toggleComplete(task.id);
            showUndo(`「${task.name}」を完了しました`, () => cancelPendingCompletion(task.id));
        } else {
            toggleComplete(task.id);
        }
    };

    const isPending = (taskId: string) => pendingCompletions.some((p) => p.taskId === taskId);

    /** サブタスクの有無を踏まえた既定の展開状態 */
    const isTaskExpanded = (task: Task) =>
        expandOverrides[task.id] ?? ((task.subtasks || []).length > 0);

    const toggleExpanded = (task: Task) => {
        const current = isTaskExpanded(task);
        setExpandOverrides((prev) => ({ ...prev, [task.id]: !current }));
    };

    const handleAddSubtask = (taskId: string, e: React.FormEvent) => {
        e.preventDefault();
        const value = subtaskInputs[taskId]?.trim();
        if (!value) return;
        addSubtask(taskId, value);
        setSubtaskInputs((prev) => ({ ...prev, [taskId]: '' }));
        setExpandOverrides((prev) => ({ ...prev, [taskId]: true }));
    };

    const handleAddFormSubtask = () => {
        const trimmed = formSubtaskInput.trim();
        if (!trimmed) return;
        const newSubtask: Subtask = {
            id: generateId(),
            name: trimmed,
            completed: false,
            completedAt: null,
            createdAt: new Date().toISOString(),
        };
        setFormSubtasks((prev) => [...prev, newSubtask]);
        setFormSubtaskInput('');
    };

    const handleFormSubtaskKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddFormSubtask();
        }
    };

    const handleRemoveFormSubtask = (id: string) => {
        setFormSubtasks((prev) => prev.filter((s) => s.id !== id));
    };

    const handleAddTag = () => {
        const trimmed = tagInput.trim();
        if (trimmed && !tags.includes(trimmed)) {
            setTags([...tags, trimmed]);
        }
        setTagInput('');
    };

    const handleTagKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleAddTag();
        } else if (e.key === ',' || e.key === ' ') {
            e.preventDefault();
            handleAddTag();
        }
    };

    const handleRemoveTag = (tag: string) => {
        setTags(tags.filter((t) => t !== tag));
    };

    const toggleTagFilter = (tag: string) => {
        setSelectedTags((prev) =>
            prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
        );
    };

    return (
        <div className="max-w-lg mx-auto px-4 pt-6">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>タスク</h1>
                    <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>{tasks.filter((t) => !t.completed).length}件の未完了タスク</p>
                </div>
                <button onClick={() => { setEditingTask(null); resetForm(); setShowForm(!showForm); }}
                    className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-105"
                    style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>
                    <Plus size={20} />
                </button>
            </div>

            {/* 検索 */}
            <div className="relative mb-3">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-muted)' }} />
                <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="タスクを検索..."
                    className="w-full pl-9 pr-9 py-2 rounded-lg text-sm outline-none"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}
                />
                {searchQuery && (
                    <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded transition-colors hover:opacity-70"
                        style={{ color: 'var(--color-text-muted)' }}
                        aria-label="検索をクリア"
                    >
                        <X size={14} />
                    </button>
                )}
            </div>

            {/* 並び替え */}
            <div className="flex items-center gap-2 mb-4">
                <ArrowUpDown size={14} className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
                <select
                    value={sortMode}
                    onChange={(e) => setSortMode(e.target.value as TaskSortMode)}
                    aria-label="並び替え"
                    className="px-3 py-1.5 rounded-lg text-xs outline-none"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-default)' }}
                >
                    <option value="dueDate">期限順</option>
                    <option value="priority">優先度順</option>
                    <option value="createdAt">作成日順</option>
                </select>
            </div>

            {/* タグフィルター */}
            {allTags.length > 0 && (
                <div className="mb-4 -mx-4 px-4" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                    <div className="flex gap-2 pb-1" style={{ minWidth: 'max-content' }}>
                        <Tag size={14} className="flex-shrink-0 mt-1" style={{ color: 'var(--color-text-muted)' }} />
                        {allTags.map((tag) => {
                            const isActive = selectedTags.includes(tag);
                            return (
                                <button
                                    key={tag}
                                    onClick={() => toggleTagFilter(tag)}
                                    className="px-3 py-1 rounded-full text-xs font-medium transition-all duration-200 flex-shrink-0"
                                    style={{
                                        backgroundColor: isActive ? 'var(--color-accent-primary)' : 'var(--color-bg-secondary)',
                                        color: isActive ? 'white' : 'var(--color-text-secondary)',
                                        border: `1px solid ${isActive ? 'var(--color-accent-primary)' : 'var(--color-border-default)'}`,
                                    }}
                                >
                                    {tag}
                                </button>
                            );
                        })}
                        {selectedTags.length > 0 && (
                            <button
                                onClick={() => setSelectedTags([])}
                                className="px-2 py-1 rounded-full text-xs transition-colors flex-shrink-0"
                                style={{ color: 'var(--color-text-muted)' }}
                            >
                                クリア
                            </button>
                        )}
                    </div>
                </div>
            )}

            {showForm && (
                <form onSubmit={handleSubmit} className="mb-6 p-4 rounded-xl animate-fade-in" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="タスク名を入力..." autoFocus
                        className="w-full px-3 py-2.5 rounded-lg text-sm outline-none mb-3"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }} />
                    <div className="flex gap-3 mb-3">
                        <div className="flex-1">
                            <label className="text-xs mb-1 block" style={{ color: 'var(--color-text-muted)' }}><Calendar size={12} className="inline mr-1" />期限</label>
                            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }} />
                        </div>
                        <div className="flex-1">
                            <label className="text-xs mb-1 block" style={{ color: 'var(--color-text-muted)' }}><Flag size={12} className="inline mr-1" />重要度</label>
                            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}
                                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}>
                                <option value="low">低</option><option value="medium">中</option><option value="high">高</option>
                            </select>
                        </div>
                    </div>

                    {/* 繰り返し設定 */}
                    <div className="mb-3">
                        <label className="text-xs mb-1 block" style={{ color: 'var(--color-text-muted)' }}><Repeat size={12} className="inline mr-1" />繰り返し</label>
                        <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}
                            className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                            style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}>
                            <option value="none">なし</option>
                            <option value="daily">毎日</option>
                            <option value="weekly">毎週</option>
                            <option value="monthly">毎月</option>
                        </select>
                    </div>

                    {/* タグ入力 */}
                    <div className="mb-3">
                        <label className="text-xs mb-1 block" style={{ color: 'var(--color-text-muted)' }}>
                            <Tag size={12} className="inline mr-1" />タグ
                        </label>
                        <div className="flex flex-wrap gap-1.5 px-3 py-2 rounded-lg min-h-[38px]"
                            style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)' }}>
                            {tags.map((tag) => (
                                <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                                    style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>
                                    {tag}
                                    <button type="button" onClick={() => handleRemoveTag(tag)} className="hover:opacity-70">
                                        <X size={12} />
                                    </button>
                                </span>
                            ))}
                            <input
                                type="text"
                                value={tagInput}
                                onChange={(e) => setTagInput(e.target.value)}
                                onKeyDown={handleTagKeyDown}
                                onBlur={handleAddTag}
                                placeholder={tags.length === 0 ? "タグを入力 (Enter/スペースで追加)" : ""}
                                className="flex-1 min-w-[80px] text-sm outline-none bg-transparent"
                                style={{ color: 'var(--color-text-primary)' }}
                            />
                        </div>
                    </div>

                    {/* サブタスク入力 */}
                    <div className="mb-3">
                        <label className="text-xs mb-1 block" style={{ color: 'var(--color-text-muted)' }}>
                            <ListPlus size={12} className="inline mr-1" />サブタスク
                        </label>
                        {formSubtasks.length > 0 && (
                            <div className="flex flex-col gap-1.5 mb-1.5">
                                {formSubtasks.map((subtask) => (
                                    <div key={subtask.id} className="flex items-center gap-2 px-3 py-2 rounded-lg"
                                        style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)' }}>
                                        <span className={`flex-1 min-w-0 text-sm ${subtask.completed ? 'line-through' : ''}`}
                                            style={{ color: subtask.completed ? 'var(--color-text-muted)' : 'var(--color-text-primary)' }}>
                                            {subtask.name}
                                        </span>
                                        <button type="button" onClick={() => handleRemoveFormSubtask(subtask.id)}
                                            className="p-0.5 rounded transition-colors hover:opacity-70" style={{ color: 'var(--color-text-danger)' }}>
                                            <X size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={formSubtaskInput}
                                onChange={(e) => setFormSubtaskInput(e.target.value)}
                                onKeyDown={handleFormSubtaskKeyDown}
                                placeholder="サブタスクを入力 (Enterで追加)"
                                className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm outline-none"
                                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}
                            />
                            <button type="button" onClick={handleAddFormSubtask}
                                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors hover:opacity-90"
                                style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>
                                <ListPlus size={16} />
                            </button>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button type="submit" className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors hover:opacity-90"
                            style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>{editingTask ? '更新' : '追加'}</button>
                        <button type="button" onClick={() => { setShowForm(false); setEditingTask(null); resetForm(); }}
                            className="px-4 py-2.5 rounded-lg text-sm transition-colors hover:opacity-70"
                            style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}>キャンセル</button>
                    </div>
                </form>
            )}

            <div className="flex flex-col gap-2">
                {sortedTasks.length === 0 && (
                    <div className="text-center py-16 opacity-60">
                        <div className="flex justify-center"><div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg-card)' }}>
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </div></div>
                        <p className="mt-4 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                            {selectedTags.length > 0 || searchQuery.trim() ? '該当するタスクがありません' : 'タスクがありません。\n+ボタンから追加しましょう！'}
                        </p>
                    </div>
                )}
                {sortedTasks.map((task) => {
                    const subtasks = task.subtasks || [];
                    const completedSubtaskCount = subtasks.filter((subtask) => subtask.completed).length;
                    const isExpanded = isTaskExpanded(task);
                    const overdue = !task.completed && isOverdue(task.dueDate);
                    const pending = isPending(task.id);
                    return (
                        <div key={task.id} className={`rounded-xl transition-all duration-200 ${pending ? 'animate-pulse-glow' : ''}`}
                            style={{ backgroundColor: task.completed ? 'var(--color-bg-secondary)' : 'var(--color-bg-card)', border: `1px solid ${overdue ? 'var(--color-text-danger)' : 'var(--color-border-default)'}`, opacity: task.completed && !pending ? 0.6 : 1 }}>
                            <div className="group flex items-center gap-2 px-3 py-3">
                                <button onClick={() => toggleExpanded(task)} className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors" style={{ color: 'var(--color-text-muted)' }}>
                                    {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                </button>
                                <button onClick={() => handleToggleComplete(task)} className="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200"
                                    style={{ borderColor: task.completed ? 'var(--color-accent-emerald)' : PRIORITY_COLORS[task.priority], backgroundColor: task.completed ? 'var(--color-accent-emerald)' : 'transparent' }}>
                                    {task.completed && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" /></svg>}
                                </button>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-medium ${task.completed ? 'line-through' : ''}`} style={{ color: overdue ? 'var(--color-text-danger)' : 'var(--color-text-primary)' }}>{task.name}</p>
                                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                        {task.dueDate && <span className="text-[11px]" title={task.dueDate} style={{ color: overdue ? 'var(--color-text-danger)' : 'var(--color-text-muted)' }}>📅 {formatRelativeDate(task.dueDate)}</span>}
                                        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: `${PRIORITY_COLORS[task.priority]}22`, color: PRIORITY_COLORS[task.priority] }}>{PRIORITY_LABELS[task.priority]}</span>
                                        {task.recurrence && task.recurrence !== 'none' && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium inline-flex items-center gap-0.5"
                                                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-accent-primary)', border: '1px solid var(--color-border-default)' }}>
                                                <Repeat size={10} />{RECURRENCE_LABELS[task.recurrence]}
                                            </span>
                                        )}
                                        {subtasks.length > 0 && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-accent-emerald)', border: '1px solid var(--color-border-default)' }}>
                                                {completedSubtaskCount}/{subtasks.length}
                                            </span>
                                        )}
                                        {(task.tags || []).map((tag) => (
                                            <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                                                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border-default)' }}>
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button onClick={() => handleEdit(task)} className="p-1.5 rounded-lg transition-colors hover:opacity-70" style={{ color: 'var(--color-text-muted)' }}><Edit3 size={14} /></button>
                                    <button onClick={() => deleteTask(task.id)} className="p-1.5 rounded-lg transition-colors hover:opacity-70" style={{ color: 'var(--color-text-danger)' }}><Trash2 size={14} /></button>
                                </div>
                            </div>
                            {isExpanded && (
                                <div className="px-4 pb-4 pl-12 animate-fade-in">
                                    <div className="flex flex-col gap-2 mb-3">
                                        {subtasks.map((subtask) => (
                                            <div key={subtask.id} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)' }}>
                                                <button onClick={() => toggleSubtaskComplete(task.id, subtask.id)} className="w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200"
                                                    style={{ borderColor: subtask.completed ? 'var(--color-accent-emerald)' : 'var(--color-text-muted)', backgroundColor: subtask.completed ? 'var(--color-accent-emerald)' : 'transparent' }}>
                                                    {subtask.completed && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" /></svg>}
                                                </button>
                                                <span className={`flex-1 min-w-0 text-sm ${subtask.completed ? 'line-through' : ''}`} style={{ color: subtask.completed ? 'var(--color-text-muted)' : 'var(--color-text-secondary)' }}>
                                                    {subtask.name}
                                                </span>
                                                <button onClick={() => deleteSubtask(task.id, subtask.id)} className="p-1 rounded transition-colors hover:opacity-70" style={{ color: 'var(--color-text-danger)' }}>
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                    <form onSubmit={(e) => handleAddSubtask(task.id, e)} className="flex gap-2">
                                        <input
                                            type="text"
                                            value={subtaskInputs[task.id] || ''}
                                            onChange={(e) => setSubtaskInputs((prev) => ({ ...prev, [task.id]: e.target.value }))}
                                            placeholder="サブタスクを追加..."
                                            className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm outline-none"
                                            style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}
                                        />
                                        <button type="submit" className="w-10 h-10 rounded-lg flex items-center justify-center transition-colors hover:opacity-90" style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>
                                            <ListPlus size={16} />
                                        </button>
                                    </form>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
