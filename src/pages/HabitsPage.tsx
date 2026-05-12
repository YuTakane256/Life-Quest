import { useState } from 'react';
import { Plus, Trash2, HeartPulse, MessageSquare, Sparkles } from 'lucide-react';
import { useHabitStore } from '../stores/useHabitStore';
import { getTodayJST } from '../utils/dateUtils';

export function HabitsPage() {
    const { habits, dailyRecords, addHabit, deleteHabit, toggleHabitCompletion, setHabitMemo, setRestDay, isRestDay, areAllHabitsComplete } = useHabitStore();
    const [showForm, setShowForm] = useState(false);
    const [name, setName] = useState('');
    const [memoTarget, setMemoTarget] = useState<string | null>(null);
    const [memoText, setMemoText] = useState('');
    const [showRestConfirm, setShowRestConfirm] = useState(false);

    const today = getTodayJST();
    const isRest = isRestDay(today);
    const allComplete = areAllHabitsComplete(today);
    const getRecordForHabit = (habitId: string) => dailyRecords.find((r) => r.habitId === habitId && r.date === today);

    const handleAddHabit = (e: React.FormEvent) => {
        e.preventDefault(); if (!name.trim()) return;
        addHabit(name.trim()); setName(''); setShowForm(false);
    };

    const handleToggle = (habitId: string) => {
        const record = getRecordForHabit(habitId);
        const isCompleting = !record?.completed;
        toggleHabitCompletion(habitId, today);
        if (isCompleting) { setMemoTarget(habitId); setMemoText(record?.memo || ''); }
    };

    const handleSaveMemo = () => { if (memoTarget) { setHabitMemo(memoTarget, today, memoText); setMemoTarget(null); setMemoText(''); } };
    const handleRestDay = () => { setRestDay(today); setShowRestConfirm(false); };
    const completedCount = habits.filter((h) => getRecordForHabit(h.id)?.completed).length;

    return (
        <div className="max-w-lg mx-auto px-4 pt-6">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>習慣</h1>
                    <p className="text-sm mt-1" style={{ color: 'var(--color-text-muted)' }}>本日: {completedCount}/{habits.length} 達成{isRest && <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-accent-sky)', color: 'white' }}>🩹 お休み中</span>}</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => setShowRestConfirm(true)} disabled={isRest} className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-105 disabled:opacity-40" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', color: 'var(--color-accent-sky)' }} title="お休み"><HeartPulse size={18} /></button>
                    <button onClick={() => { setShowForm(!showForm); setName(''); }} className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-105" style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}><Plus size={20} /></button>
                </div>
            </div>

            {habits.length > 0 && <div className="mb-6"><div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}><div className="h-full rounded-full transition-all duration-500" style={{ width: `${habits.length > 0 ? (completedCount / habits.length) * 100 : 0}%`, backgroundColor: allComplete ? 'var(--color-accent-gold)' : 'var(--color-accent-emerald)' }} /></div>{allComplete && <div className="flex items-center gap-1 mt-2 animate-fade-in"><Sparkles size={14} style={{ color: 'var(--color-accent-gold)' }} /><span className="text-xs font-medium" style={{ color: 'var(--color-accent-gold)' }}>全習慣達成！ボーナスXPを獲得！</span></div>}</div>}

            {showForm && (
                <form onSubmit={handleAddHabit} className="mb-4 p-4 rounded-xl animate-fade-in" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
                    <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="新しい習慣を入力..." autoFocus className="w-full px-3 py-2.5 rounded-lg text-sm outline-none mb-3" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }} />
                    <div className="flex gap-2"><button type="submit" className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors hover:opacity-90" style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>追加</button><button type="button" onClick={() => setShowForm(false)} className="px-4 py-2.5 rounded-lg text-sm transition-colors hover:opacity-70" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}>キャンセル</button></div>
                </form>
            )}

            <div className="flex flex-col gap-2">
                {habits.length === 0 && <div className="text-center py-16 opacity-60"><div className="flex justify-center mb-4"><div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ backgroundColor: 'var(--color-bg-card)' }}><Sparkles size={28} style={{ color: 'var(--color-text-muted)' }} /></div></div><p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>習慣がありません。<br />+ボタンから追加しましょう！</p></div>}
                {habits.map((habit) => {
                    const record = getRecordForHabit(habit.id); const isCompleted = record?.completed ?? false;
                    return (
                        <div key={habit.id} className="group flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200" style={{ backgroundColor: isCompleted ? 'var(--color-bg-secondary)' : 'var(--color-bg-card)', border: `1px solid var(--color-border-default)`, opacity: isCompleted ? 0.7 : 1 }}>
                            <button onClick={() => handleToggle(habit.id)} className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200" style={{ borderColor: isCompleted ? 'var(--color-accent-emerald)' : 'var(--color-accent-secondary)', backgroundColor: isCompleted ? 'var(--color-accent-emerald)' : 'transparent' }}>{isCompleted && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" /></svg>}</button>
                            <div className="flex-1 min-w-0"><p className={`text-sm font-medium ${isCompleted ? 'line-through' : ''}`} style={{ color: 'var(--color-text-primary)' }}>{habit.name}</p>{record?.memo && <p className="text-[11px] mt-0.5 flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}><MessageSquare size={10} />{record.memo}</p>}</div>
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={() => deleteHabit(habit.id)} className="p-1.5 rounded-lg transition-colors hover:opacity-70" style={{ color: 'var(--color-text-danger)' }}><Trash2 size={14} /></button></div>
                        </div>
                    );
                })}
            </div>

            {memoTarget && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4" onClick={(e) => { if (e.target === e.currentTarget) handleSaveMemo(); }}>
                    <div className="w-full max-w-sm rounded-2xl p-5 animate-fade-in" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
                        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>📝 一言メモ（任意）</h3>
                        <input type="text" value={memoText} onChange={(e) => setMemoText(e.target.value)} placeholder="今日の一言..." autoFocus className="w-full px-3 py-2.5 rounded-lg text-sm outline-none mb-4" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }} onKeyDown={(e) => { if (e.key === 'Enter') handleSaveMemo(); }} />
                        <div className="flex gap-2"><button onClick={handleSaveMemo} className="flex-1 py-2.5 rounded-lg text-sm font-medium" style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>保存</button><button onClick={() => { setMemoTarget(null); setMemoText(''); }} className="px-4 py-2.5 rounded-lg text-sm" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}>スキップ</button></div>
                    </div>
                </div>
            )}

            {showRestConfirm && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 px-4" onClick={(e) => { if (e.target === e.currentTarget) setShowRestConfirm(false); }}>
                    <div className="w-full max-w-sm rounded-2xl p-5 animate-fade-in" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
                        <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>🩹 お休みにしますか？</h3>
                        <p className="text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>本当に今日はお休みにしますか？<br />未達成デバフは免除されます。</p>
                        <div className="flex gap-2"><button onClick={handleRestDay} className="flex-1 py-2.5 rounded-lg text-sm font-medium" style={{ backgroundColor: 'var(--color-accent-sky)', color: 'white' }}>お休みにする</button><button onClick={() => setShowRestConfirm(false)} className="px-4 py-2.5 rounded-lg text-sm" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}>キャンセル</button></div>
                    </div>
                </div>
            )}
        </div>
    );
}
