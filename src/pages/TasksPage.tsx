import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Edit3, X, ChevronDown, ChevronRight, ListPlus, Repeat, Copy, HelpCircle, Download } from 'lucide-react';
import { useTaskStore } from '../stores/useTaskStore';
import { useTaskSortStore } from '../stores/useTaskSortStore';
import { useSnackbar } from '../components/ui/snackbarContext';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { isOverdue, generateId, formatRelativeDate, getTodayJST } from '../utils/dateUtils';
import { tasksToCsv } from '../utils/taskCsv';
import { PRIORITY_LABELS, PRIORITY_COLORS, PRIORITY_SORT_ORDER, RECURRENCE_LABELS } from '../config/taskLabels';
import type { Priority, Recurrence, Task, Subtask } from '../types';
import { TaskFilters, type DueFilter, type PriorityFilter } from '../components/tasks/TaskFilters';
import { TaskForm } from '../components/tasks/TaskForm';

export function TasksPage() {
    const navigate = useNavigate();
    const { tasks, addTask, updateTask, deleteTask, duplicateTask, deleteCompletedTasks, toggleComplete, addSubtask, deleteSubtask, toggleSubtaskComplete, cancelPendingCompletion, pendingCompletions } = useTaskStore();
    const { sortMode, setSortMode } = useTaskSortStore();
    const { showUndo } = useSnackbar();
    const [showForm, setShowForm] = useState(false);
    const [showDeleteCompletedConfirm, setShowDeleteCompletedConfirm] = useState(false);
    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [name, setName] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [priority, setPriority] = useState<Priority>('medium');
    const [recurrence, setRecurrence] = useState<Recurrence>('none');
    const [tagInput, setTagInput] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [dueFilter, setDueFilter] = useState<DueFilter>('all');
    const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
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

    // フィルタリング（タグ絞り込み + 名前検索 + 期限フィルタ + 優先度フィルタ）
    const filteredTasks = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        const today = getTodayJST();
        return tasks.filter((t) => {
            const matchesTags =
                selectedTags.length === 0 ||
                selectedTags.every((tag) => (t.tags || []).includes(tag));
            const matchesSearch = query === '' || t.name.toLowerCase().includes(query);
            let matchesDue = true;
            if (dueFilter === 'overdue') {
                matchesDue = !t.completed && isOverdue(t.dueDate);
            } else if (dueFilter === 'dueSoon') {
                matchesDue = !t.completed && t.dueDate !== null && t.dueDate <= today;
            }
            const matchesPriority = priorityFilter === 'all' || t.priority === priorityFilter;
            return matchesTags && matchesSearch && matchesDue && matchesPriority;
        });
    }, [tasks, selectedTags, searchQuery, dueFilter, priorityFilter]);

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

    const incompleteTaskCount = useMemo(
        () => tasks.filter((t) => !t.completed).length,
        [tasks]
    );

    const taskGroups = useMemo(() => ({
        incomplete: sortedTasks.filter((t) => !t.completed),
        completed: sortedTasks.filter((t) => t.completed),
    }), [sortedTasks]);

    const resetForm = () => {
        setName(''); setDueDate(''); setPriority('medium'); setRecurrence('none');
        setTags([]); setTagInput('');
        setFormSubtasks([]); setFormSubtaskInput('');
    };

    const toggleTaskForm = () => {
        setEditingTask(null);
        resetForm();
        setShowForm((current) => !current);
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

    const handleDuplicate = (task: Task) => {
        const newId = duplicateTask(task.id);
        if (!newId) return;
        showUndo(`「${task.name}」を複製しました`, () => deleteTask(newId));
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

    const pendingIds = useMemo(
        () => new Set(pendingCompletions.map((p) => p.taskId)),
        [pendingCompletions]
    );
    const isPending = useCallback((taskId: string) => pendingIds.has(taskId), [pendingIds]);

    /** 一括削除の対象となる完了タスク数（保留中は除外） */
    const deletableCompletedCount = useMemo(
        () => tasks.filter((t) => t.completed && !pendingIds.has(t.id)).length,
        [tasks, pendingIds]
    );

    const handleDeleteCompleted = () => {
        deleteCompletedTasks();
        setShowDeleteCompletedConfirm(false);
    };

    const handleExportCsv = () => {
        const csv = tasksToCsv(tasks);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `life-quest-tasks-${getTodayJST()}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    /** サブタスクの有無を踏まえた既定の展開状態 */
    const isTaskExpanded = useCallback(
        (task: Task) => expandOverrides[task.id] ?? ((task.subtasks || []).length > 0),
        [expandOverrides]
    );

    const toggleExpanded = useCallback((task: Task) => {
        const current = isTaskExpanded(task);
        setExpandOverrides((prev) => ({ ...prev, [task.id]: !current }));
    }, [isTaskExpanded]);

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
        <div className="app-page max-w-lg mx-auto px-4 pt-6">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>タスク</h1>
                    <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>{incompleteTaskCount}件の未完了タスク</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={handleExportCsv}
                        disabled={tasks.length === 0}
                        aria-label="タスクをCSVで保存"
                        title="タスクをCSVで保存"
                        className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-105 disabled:opacity-40"
                        style={{
                            backgroundColor: 'var(--color-bg-card)',
                            color: 'var(--color-accent-emerald)',
                            border: '1px solid var(--color-border-default)',
                        }}
                    >
                        <Download size={19} />
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate('/help')}
                        aria-label="使い方"
                        title="使い方"
                        className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-105"
                        style={{
                            backgroundColor: 'var(--color-bg-card)',
                            color: 'var(--color-accent-primary)',
                            border: '1px solid var(--color-border-default)',
                        }}
                    >
                        <HelpCircle size={20} />
                    </button>
                </div>
            </div>

            <TaskFilters
                searchQuery={searchQuery}
                dueFilter={dueFilter}
                priorityFilter={priorityFilter}
                sortMode={sortMode}
                allTags={allTags}
                selectedTags={selectedTags}
                deletableCompletedCount={deletableCompletedCount}
                onSearchQueryChange={setSearchQuery}
                onDueFilterChange={setDueFilter}
                onPriorityFilterChange={setPriorityFilter}
                onSortModeChange={setSortMode}
                onToggleTag={toggleTagFilter}
                onClearTags={() => setSelectedTags([])}
                onRequestDeleteCompleted={() => setShowDeleteCompletedConfirm(true)}
            />

            {showForm && (
                <TaskForm
                    editing={editingTask !== null}
                    name={name}
                    dueDate={dueDate}
                    priority={priority}
                    recurrence={recurrence}
                    tags={tags}
                    tagInput={tagInput}
                    subtasks={formSubtasks}
                    subtaskInput={formSubtaskInput}
                    onSubmit={handleSubmit}
                    onCancel={() => { setShowForm(false); setEditingTask(null); resetForm(); }}
                    onNameChange={setName}
                    onDueDateChange={setDueDate}
                    onPriorityChange={setPriority}
                    onRecurrenceChange={setRecurrence}
                    onTagInputChange={setTagInput}
                    onTagKeyDown={handleTagKeyDown}
                    onAddTag={handleAddTag}
                    onRemoveTag={handleRemoveTag}
                    onSubtaskInputChange={setFormSubtaskInput}
                    onSubtaskKeyDown={handleFormSubtaskKeyDown}
                    onAddSubtask={handleAddFormSubtask}
                    onRemoveSubtask={handleRemoveFormSubtask}
                />
            )}

            <div className="flex flex-col gap-2">
                {sortedTasks.length === 0 && (
                    <div className="text-center py-16 opacity-60">
                        <div className="flex justify-center"><div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg-card)' }}>
                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-muted)" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </div></div>
                        <p className="mt-4 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                            {selectedTags.length > 0 || searchQuery.trim() || dueFilter !== 'all' || priorityFilter !== 'all' ? '該当するタスクがありません' : 'タスクがありません。\n+ボタンから追加しましょう！'}
                        </p>
                    </div>
                )}
                {(() => {
                    const renderTaskItem = (task: Task) => {
                        const subtasks = task.subtasks || [];
                        const completedSubtaskCount = subtasks.filter((subtask) => subtask.completed).length;
                        const isExpanded = isTaskExpanded(task);
                        const overdue = !task.completed && isOverdue(task.dueDate);
                        const pending = isPending(task.id);
                        return (
                        <div key={task.id} className={`rounded-xl transition-all duration-200 ${pending ? 'animate-pulse-glow' : ''}`}
                            style={{ backgroundColor: task.completed ? 'var(--color-bg-secondary)' : 'var(--color-bg-card)', border: `1px solid ${overdue ? 'var(--color-text-danger)' : 'var(--color-border-default)'}`, opacity: task.completed && !pending ? 0.6 : 1 }}>
                            <div className="group flex items-center gap-2 px-3 py-3">
                                <button
                                    onClick={() => toggleExpanded(task)}
                                    aria-label={isExpanded ? `タスク「${task.name}」を折りたたむ` : `タスク「${task.name}」を展開`}
                                    className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
                                    style={{ color: 'var(--color-text-muted)' }}
                                >
                                    {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                </button>
                                <button
                                    onClick={() => handleToggleComplete(task)}
                                    aria-label={task.completed ? `タスク「${task.name}」を未完了にする` : `タスク「${task.name}」を完了にする`}
                                    className="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200"
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
                                    <button onClick={() => handleDuplicate(task)} className="p-1.5 rounded-lg transition-colors hover:opacity-70" style={{ color: 'var(--color-text-muted)' }} aria-label="複製"><Copy size={14} /></button>
                                    <button onClick={() => handleEdit(task)} className="p-1.5 rounded-lg transition-colors hover:opacity-70" style={{ color: 'var(--color-text-muted)' }} aria-label="編集"><Edit3 size={14} /></button>
                                    <button onClick={() => deleteTask(task.id)} className="p-1.5 rounded-lg transition-colors hover:opacity-70" style={{ color: 'var(--color-text-danger)' }} aria-label="削除"><Trash2 size={14} /></button>
                                </div>
                            </div>
                            {isExpanded && (
                                <div className="px-4 pb-4 pl-12 animate-fade-in">
                                    <div className="flex flex-col gap-2 mb-3">
                                        {subtasks.map((subtask) => (
                                            <div key={subtask.id} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)' }}>
                                                <button
                                                    onClick={() => toggleSubtaskComplete(task.id, subtask.id)}
                                                    aria-label={subtask.completed ? `サブタスク「${subtask.name}」を未完了にする` : `サブタスク「${subtask.name}」を完了にする`}
                                                    className="w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200"
                                                    style={{ borderColor: subtask.completed ? 'var(--color-accent-emerald)' : 'var(--color-text-muted)', backgroundColor: subtask.completed ? 'var(--color-accent-emerald)' : 'transparent' }}>
                                                    {subtask.completed && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" /></svg>}
                                                </button>
                                                <span className={`flex-1 min-w-0 text-sm ${subtask.completed ? 'line-through' : ''}`} style={{ color: subtask.completed ? 'var(--color-text-muted)' : 'var(--color-text-secondary)' }}>
                                                    {subtask.name}
                                                </span>
                                                <button onClick={() => deleteSubtask(task.id, subtask.id)} aria-label={`サブタスク「${subtask.name}」を削除`} className="p-1 rounded transition-colors hover:opacity-70" style={{ color: 'var(--color-text-danger)' }}>
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
                                        <button
                                            type="submit"
                                            aria-label={`タスク「${task.name}」にサブタスクを追加`}
                                            className="w-10 h-10 rounded-lg flex items-center justify-center transition-colors hover:opacity-90"
                                            style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}
                                        >
                                            <ListPlus size={16} />
                                        </button>
                                    </form>
                                </div>
                            )}
                        </div>
                        );
                    };
                    return (
                        <>
                            {taskGroups.incomplete.map(renderTaskItem)}
                            {taskGroups.completed.length > 0 && (
                                <details className="rounded-xl mt-2 group" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)' }}>
                                    <summary className="cursor-pointer list-none px-3 py-2.5 flex items-center gap-2 text-xs select-none" style={{ color: 'var(--color-text-muted)' }}>
                                        <ChevronRight size={14} className="transition-transform group-open:rotate-90" />
                                        <span className="font-medium">完了タスク ({taskGroups.completed.length})</span>
                                    </summary>
                                    <div className="flex flex-col gap-2 px-2 pb-2 pt-1">
                                        {taskGroups.completed.map(renderTaskItem)}
                                    </div>
                                </details>
                            )}
                        </>
                    );
                })()}
            </div>

            {/* 完了タスク一括削除の確認モーダル */}
            <ConfirmDialog
                open={showDeleteCompletedConfirm}
                title="完了タスクを削除しますか？"
                message={`完了済みのタスク${deletableCompletedCount}件をまとめて削除します。この操作は取り消せません。`}
                confirmLabel="削除する"
                onConfirm={handleDeleteCompleted}
                onClose={() => setShowDeleteCompletedConfirm(false)}
            />
            <button
                type="button"
                onClick={toggleTaskForm}
                aria-label={showForm ? 'タスク追加フォームを閉じる' : '新しいタスクを追加'}
                title={showForm ? 'タスク追加フォームを閉じる' : '新しいタスクを追加'}
                className="app-floating-button fixed right-4 z-40 w-11 h-11 rounded-full flex items-center justify-center transition-all hover:scale-110"
                style={{
                    bottom: 'calc(64px + env(safe-area-inset-bottom, 0px) + 12px)',
                    backgroundColor: 'var(--color-accent-primary)',
                    color: 'white',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                }}
            >
                <Plus size={22} />
            </button>
        </div>
    );
}
