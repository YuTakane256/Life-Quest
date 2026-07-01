import { Calendar, Flag, ListPlus, Repeat, Tag, X } from 'lucide-react';
import type { KeyboardEvent, FormEvent } from 'react';
import type { Priority, Recurrence, Subtask } from '../../types';

interface TaskFormProps {
    editing: boolean;
    name: string;
    dueDate: string;
    priority: Priority;
    recurrence: Recurrence;
    tags: string[];
    tagInput: string;
    subtasks: Subtask[];
    subtaskInput: string;
    onSubmit: (event: FormEvent) => void;
    onCancel: () => void;
    onNameChange: (value: string) => void;
    onDueDateChange: (value: string) => void;
    onPriorityChange: (value: Priority) => void;
    onRecurrenceChange: (value: Recurrence) => void;
    onTagInputChange: (value: string) => void;
    onTagKeyDown: (event: KeyboardEvent) => void;
    onAddTag: () => void;
    onRemoveTag: (tag: string) => void;
    onSubtaskInputChange: (value: string) => void;
    onSubtaskKeyDown: (event: KeyboardEvent) => void;
    onAddSubtask: () => void;
    onRemoveSubtask: (id: string) => void;
}

export function TaskForm(props: TaskFormProps) {
    return (
        <form onSubmit={props.onSubmit} className="mb-6 p-4 rounded-xl animate-fade-in" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
            <input type="text" value={props.name} onChange={(event) => props.onNameChange(event.target.value)} placeholder="タスク名を入力..." autoFocus className="w-full px-3 py-2.5 rounded-lg text-sm outline-none mb-3" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }} />
            <div className="flex gap-3 mb-3">
                <label className="flex-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    <span className="mb-1 block"><Calendar size={12} className="inline mr-1" />期限</span>
                    <input type="date" value={props.dueDate} onChange={(event) => props.onDueDateChange(event.target.value)} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }} />
                </label>
                <label className="flex-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    <span className="mb-1 block"><Flag size={12} className="inline mr-1" />重要度</span>
                    <select value={props.priority} onChange={(event) => props.onPriorityChange(event.target.value as Priority)} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}>
                        <option value="low">低</option><option value="medium">中</option><option value="high">高</option>
                    </select>
                </label>
            </div>

            <label className="text-xs mb-3 block" style={{ color: 'var(--color-text-muted)' }}>
                <span className="mb-1 block"><Repeat size={12} className="inline mr-1" />繰り返し</span>
                <select value={props.recurrence} onChange={(event) => props.onRecurrenceChange(event.target.value as Recurrence)} className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}>
                    <option value="none">なし</option><option value="daily">毎日</option><option value="weekly">毎週</option><option value="monthly">毎月</option>
                </select>
            </label>

            <div className="mb-3">
                <label className="text-xs mb-1 block" style={{ color: 'var(--color-text-muted)' }}><Tag size={12} className="inline mr-1" />タグ</label>
                <div className="flex flex-wrap gap-1.5 px-3 py-2 rounded-lg min-h-[38px]" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)' }}>
                    {props.tags.map((tag) => (
                        <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>
                            {tag}
                            <button type="button" onClick={() => props.onRemoveTag(tag)} aria-label={`タグ「${tag}」を削除`} className="hover:opacity-70"><X size={12} /></button>
                        </span>
                    ))}
                    <input type="text" value={props.tagInput} onChange={(event) => props.onTagInputChange(event.target.value)} onKeyDown={props.onTagKeyDown} onBlur={props.onAddTag} placeholder={props.tags.length === 0 ? 'タグを入力 (Enter/スペースで追加)' : ''} className="flex-1 min-w-[80px] text-sm outline-none bg-transparent" style={{ color: 'var(--color-text-primary)' }} />
                </div>
            </div>

            <div className="mb-3">
                <label className="text-xs mb-1 block" style={{ color: 'var(--color-text-muted)' }}><ListPlus size={12} className="inline mr-1" />サブタスク</label>
                {props.subtasks.length > 0 && (
                    <div className="flex flex-col gap-1.5 mb-1.5">
                        {props.subtasks.map((subtask) => (
                            <div key={subtask.id} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)' }}>
                                <span className={`flex-1 min-w-0 text-sm ${subtask.completed ? 'line-through' : ''}`} style={{ color: subtask.completed ? 'var(--color-text-muted)' : 'var(--color-text-primary)' }}>{subtask.name}</span>
                                <button type="button" onClick={() => props.onRemoveSubtask(subtask.id)} aria-label={`サブタスク「${subtask.name}」を削除`} className="p-0.5 rounded transition-colors hover:opacity-70" style={{ color: 'var(--color-text-danger)' }}><X size={14} /></button>
                            </div>
                        ))}
                    </div>
                )}
                <div className="flex gap-2">
                    <input type="text" value={props.subtaskInput} onChange={(event) => props.onSubtaskInputChange(event.target.value)} onKeyDown={props.onSubtaskKeyDown} placeholder="サブタスクを入力 (Enterで追加)" className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm outline-none" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }} />
                    <button type="button" onClick={props.onAddSubtask} className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors hover:opacity-90" style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }} aria-label="サブタスクを追加"><ListPlus size={16} /></button>
                </div>
            </div>

            <div className="flex gap-2">
                <button type="submit" className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors hover:opacity-90" style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>{props.editing ? '更新' : '追加'}</button>
                <button type="button" onClick={props.onCancel} className="px-4 py-2.5 rounded-lg text-sm transition-colors hover:opacity-70" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}>キャンセル</button>
            </div>
        </form>
    );
}
