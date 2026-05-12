import { useState, useMemo } from 'react';
import { Plus, Trash2, Edit3, Calendar, Flag, X, Tag } from 'lucide-react';
import { useTaskStore } from '../stores/useTaskStore';
import { useSnackbar } from '../components/ui/SnackbarProvider';
import { isOverdue } from '../utils/dateUtils';
import type { Priority, Task } from '../types';

const PRIORITY_LABELS: Record<Priority, string> = { low: '低', medium: '中', high: '高' };
const PRIORITY_COLORS: Record<Priority, string> = { low: 'var(--color-priority-low)', medium: 'var(--color-priority-medium)', high: 'var(--color-priority-high)' };

export function TasksPage() {
    const { tasks, addTask, updateTask, deleteTask, toggleComplete, cancelPendingCompletion, pendingCompletions } = useTaskStore();
    const { showUndo } = useSnackbar();
    const [showForm, setShowForm] = useState(false);
    const [editingTask, setEditingTask] = useState<Task | null>(null);
    const [name, setName] = useState('');
    const [dueDate, setDueDate] = useState('');
    const [priority, setPriority] = useState<Priority>('medium');
    const [tagInput, setTagInput] = useState('');
    const [tags, setTags] = useState<string[]>([]);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);

    // 全タスクからユニークなタグを抽出
    const allTags = useMemo(() => {
        const tagSet = new Set<string>();
        tasks.forEach((t) => (t.tags || []).forEach((tag) => tagSet.add(tag)));
        return Array.from(tagSet).sort();
    }, [tasks]);

    // フィルタリング
    const filteredTasks = useMemo(() => {
        if (selectedTags.length === 0) return tasks;
        return tasks.filter((t) =>
            selectedTags.every((tag) => (t.tags || []).includes(tag))
        );
    }, [tasks, selectedTags]);

    const sortedTasks = useMemo(() => {
        return [...filteredTasks].sort((a, b) => {
            if (a.completed !== b.completed) return a.completed ? 1 : -1;
            if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
            if (a.dueDate) return -1;
            if (b.dueDate) return 1;
            return 0;
        });
    }, [filteredTasks]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        if (editingTask) {
            updateTask(editingTask.id, { name: name.trim(), dueDate: dueDate || null, priority, tags });
            setEditingTask(null);
        } else {
            addTask(name.trim(), dueDate || null, priority, tags);
        }
        setName(''); setDueDate(''); setPriority('medium'); setTags([]); setTagInput(''); setShowForm(false);
    };

    const handleEdit = (task: Task) => {
        setEditingTask(task);
        setName(task.name);
        setDueDate(task.dueDate || '');
        setPriority(task.priority);
        setTags(task.tags || []);
        setTagInput('');
        setShowForm(true);
    };

    const handleToggleComplete = (task: Task) => {
        if (!task.completed) {
            toggleComplete(task.id);
            showUndo(`「${task.name}」を完了しました`, () => cancelPendingCompletion(task.id));
        } else {
            toggleComplete(task.id);
        }
    };

    const isPending = (taskId: string) => pendingCompletions.some((p) => p.taskId === taskId);

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
                <button onClick={() => { setEditingTask(null); setName(''); setDueDate(''); setPriority('medium'); setTags([]); setTagInput(''); setShowForm(!showForm); }}
                    className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-105"
                    style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>
                    <Plus size={20} />
                </button>
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

                    <div className="flex gap-2">
                        <button type="submit" className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors hover:opacity-90"
                            style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>{editingTask ? '更新' : '追加'}</button>
                        <button type="button" onClick={() => { setShowForm(false); setEditingTask(null); }}
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
                            {selectedTags.length > 0 ? '該当するタスクがありません' : 'タスクがありません。\n+ボタンから追加しましょう！'}
                        </p>
                    </div>
                )}
                {sortedTasks.map((task) => {
                    const overdue = !task.completed && isOverdue(task.dueDate);
                    const pending = isPending(task.id);
                    return (
                        <div key={task.id} className={`group flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${pending ? 'animate-pulse-glow' : ''}`}
                            style={{ backgroundColor: task.completed ? 'var(--color-bg-secondary)' : 'var(--color-bg-card)', border: `1px solid ${overdue ? 'var(--color-text-danger)' : 'var(--color-border-default)'}`, opacity: task.completed && !pending ? 0.6 : 1 }}>
                            <button onClick={() => handleToggleComplete(task)} className="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200"
                                style={{ borderColor: task.completed ? 'var(--color-accent-emerald)' : PRIORITY_COLORS[task.priority], backgroundColor: task.completed ? 'var(--color-accent-emerald)' : 'transparent' }}>
                                {task.completed && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" /></svg>}
                            </button>
                            <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium ${task.completed ? 'line-through' : ''}`} style={{ color: overdue ? 'var(--color-text-danger)' : 'var(--color-text-primary)' }}>{task.name}</p>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                    {task.dueDate && <span className="text-[11px]" style={{ color: overdue ? 'var(--color-text-danger)' : 'var(--color-text-muted)' }}>📅 {task.dueDate}</span>}
                                    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: `${PRIORITY_COLORS[task.priority]}22`, color: PRIORITY_COLORS[task.priority] }}>{PRIORITY_LABELS[task.priority]}</span>
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
                    );
                })}
            </div>
        </div>
    );
}
