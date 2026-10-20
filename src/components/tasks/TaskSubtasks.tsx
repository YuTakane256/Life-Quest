import { useRef, useState } from 'react';
import { ListPlus, X } from 'lucide-react';
import { captureTaskEdit, TASK_LIMITS, type Task } from '@life-quest/core/tasks';
import { useInteractionScope } from '../../hooks/useInteractionScope';
import { useTaskStore } from '../../stores/useTaskStore';

export function TaskSubtasks({ task }: { task: Task }) {
    const [draft, setDraft] = useState({ text: '', error: '' });
    const owner = useRef<{ accepts: ReturnType<typeof captureTaskEdit>; isCurrent: () => boolean } | null>(null);
    const lifetime = useRef({});
    const reset = () => { owner.current = null; lifetime.current = {}; setDraft({ text: '', error: '' }); };
    const interactions = useInteractionScope(reset);
    const renderedLifetime = lifetime.current;
    const isCurrent = () => lifetime.current === renderedLifetime && interactions.capture()();
    const renderedOwner = owner.current;
    const acceptsRow = captureTaskEdit(task);
    const canAct = () => isCurrent() && acceptsRow(useTaskStore.getState().tasks.find((item) => item.id === task.id));
    const change = (text: string) => {
        if (!isCurrent()) return;
        if (!text) { reset(); return; }
        owner.current ??= { accepts: captureTaskEdit(task), isCurrent: interactions.capture() };
        setDraft({ text, error: '' });
    };
    const add = () => {
        if (!isCurrent() || !renderedOwner || owner.current !== renderedOwner || !renderedOwner.isCurrent() || !draft.text.trim()) return;
        const current = useTaskStore.getState();
        if (!renderedOwner.accepts(current.tasks.find((item) => item.id === task.id))) {
            setDraft((value) => ({ ...value, error: 'このタスクは変更されています。入力内容を確認し、「入力をやり直す」から追加し直してください。' })); return;
        }
        owner.current = null; // Consume before the store update or a second submit.
        if (current.addSubtask(task.id, draft.text)) reset();
        else {
            owner.current = renderedOwner;
            setDraft((value) => ({ ...value, error: '追加できませんでした。サブタスク数の上限を確認してください。' }));
        }
    };
    return (
        <div className="px-4 pb-4 pl-12 animate-fade-in">
            <div className="flex flex-col gap-2 mb-3">
                {task.subtasks.map((subtask) => (
                    <div key={subtask.id} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-default)' }}>
                        <button
                            onClick={() => { if (canAct()) useTaskStore.getState().toggleSubtaskComplete(task.id, subtask.id); }}
                            aria-label={subtask.completed ? `サブタスク「${subtask.name}」を未完了にする` : `サブタスク「${subtask.name}」を完了にする`}
                            className="w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200"
                            style={{ borderColor: subtask.completed ? 'var(--color-accent-emerald)' : 'var(--color-text-muted)', backgroundColor: subtask.completed ? 'var(--color-accent-emerald)' : 'transparent' }}>
                            {subtask.completed && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" /></svg>}
                        </button>
                        <span className={`flex-1 min-w-0 text-sm ${subtask.completed ? 'line-through' : ''}`} style={{ color: subtask.completed ? 'var(--color-text-muted)' : 'var(--color-text-secondary)' }}>{subtask.name}</span>
                        <button onClick={() => { if (canAct()) useTaskStore.getState().deleteSubtask(task.id, subtask.id); }} aria-label={`サブタスク「${subtask.name}」を削除`} className="p-1 rounded transition-colors hover:opacity-70" style={{ color: 'var(--color-text-danger)' }}><X size={14} /></button>
                    </div>
                ))}
            </div>
            <form aria-label={`タスク「${task.name}」のサブタスク追加`} onSubmit={(event) => { event.preventDefault(); add(); }} className="flex gap-2">
                <input type="text" value={draft.text} onChange={(event) => change(event.target.value)}
                    aria-label={`タスク「${task.name}」のサブタスク名`} placeholder="サブタスクを追加..." maxLength={TASK_LIMITS.maxSubtaskNameLength}
                    className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm outline-none"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }} />
                <button type="submit" aria-label={`タスク「${task.name}」にサブタスクを追加`} className="w-10 h-10 rounded-lg flex items-center justify-center transition-colors hover:opacity-90" style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}><ListPlus size={16} /></button>
            </form>
            {draft.error && <div className="mt-2 text-sm" style={{ color: 'var(--color-text-danger)' }}>
                <p role="alert">{draft.error}</p>
                <button onClick={() => { if (isCurrent()) reset(); }} className="underline mt-1" style={{ color: 'var(--color-accent-primary)' }}>入力をやり直す</button>
            </div>}
        </div>
    );
}
