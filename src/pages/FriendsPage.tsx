import { useMemo, useState } from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import { useFriendsStore, type FriendProfile } from '../stores/useFriendsStore';
import { useGameStore } from '../stores/useGameStore';

type RankingEntry = FriendProfile & { kind: 'self' | 'friend' };

interface FriendFormState {
    name: string;
    level: string;
    totalXp: string;
    maxStage: string;
}

const INITIAL_FORM: FriendFormState = {
    name: '',
    level: '1',
    totalXp: '0',
    maxStage: '0',
};

function toNonNegativeInteger(value: string): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function compareRanking(a: RankingEntry, b: RankingEntry): number {
    if (b.level !== a.level) return b.level - a.level;
    if (b.totalXp !== a.totalXp) return b.totalXp - a.totalXp;
    if (b.maxStage !== a.maxStage) return b.maxStage - a.maxStage;
    return a.name.localeCompare(b.name, 'ja');
}

export function FriendsPage() {
    const friends = useFriendsStore((s) => s.friends);
    const addFriend = useFriendsStore((s) => s.addFriend);
    const deleteFriend = useFriendsStore((s) => s.deleteFriend);
    const character = useGameStore((s) => s.character);
    const maxStage = useGameStore((s) => s.battle.maxClearedStage);
    const [form, setForm] = useState<FriendFormState>(INITIAL_FORM);

    const ranking = useMemo<RankingEntry[]>(() => {
        const self: RankingEntry = {
            id: 'self',
            kind: 'self',
            name: character.name,
            level: character.level,
            totalXp: character.totalXp,
            maxStage,
        };
        return [self, ...friends.map((friend) => ({ ...friend, kind: 'friend' as const }))].sort(compareRanking);
    }, [character.level, character.name, character.totalXp, friends, maxStage]);

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        addFriend({
            name: form.name,
            level: Math.max(1, toNonNegativeInteger(form.level)),
            totalXp: toNonNegativeInteger(form.totalXp),
            maxStage: toNonNegativeInteger(form.maxStage),
        });
        setForm(INITIAL_FORM);
    };

    const updateField = (key: keyof FriendFormState, value: string) => {
        setForm((current) => ({ ...current, [key]: value }));
    };

    return (
        <div className="max-w-lg mx-auto px-5 pt-6 pb-28">
            <div className="flex items-center gap-2 mb-5">
                <Users size={22} style={{ color: 'var(--color-accent-primary)' }} />
                <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>友達</h1>
            </div>

            <section className="rounded-xl p-4 mb-4" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
                <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>リーダーボード</h2>
                <div className="flex flex-col gap-2">
                    {ranking.map((entry, index) => (
                        <div
                            key={`${entry.kind}-${entry.id}`}
                            className="rounded-lg px-3 py-2 flex items-center gap-3"
                            style={{
                                backgroundColor: entry.kind === 'self' ? 'rgba(124, 58, 237, 0.16)' : 'var(--color-bg-secondary)',
                                border: `1px solid ${entry.kind === 'self' ? 'var(--color-accent-primary)' : 'var(--color-border-default)'}`,
                            }}
                        >
                            <div className="w-8 text-center text-sm font-bold" style={{ color: index === 0 ? 'var(--color-accent-gold)' : 'var(--color-text-muted)' }}>
                                #{index + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-text-primary)' }}>{entry.name}</span>
                                    {entry.kind === 'self' && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>自分</span>
                                    )}
                                </div>
                                <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                                    Lv.{entry.level} · {entry.totalXp.toLocaleString()} XP · Stage {entry.maxStage || '-'}
                                </div>
                            </div>
                            {entry.kind === 'friend' && (
                                <button
                                    type="button"
                                    onClick={() => deleteFriend(entry.id)}
                                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-all active:scale-95"
                                    style={{ color: 'var(--color-text-danger)', backgroundColor: 'var(--color-bg-card)' }}
                                    aria-label={`${entry.name}を削除`}
                                >
                                    <Trash2 size={15} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </section>

            <section className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
                <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>友達を追加</h2>
                <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                    <input
                        value={form.name}
                        onChange={(event) => updateField('name', event.target.value)}
                        placeholder="名前"
                        className="h-11 rounded-xl px-3 text-sm outline-none"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}
                    />
                    <div className="grid grid-cols-3 gap-2">
                        <NumberField label="Lv" value={form.level} onChange={(value) => updateField('level', value)} min={1} />
                        <NumberField label="XP" value={form.totalXp} onChange={(value) => updateField('totalXp', value)} min={0} />
                        <NumberField label="Stage" value={form.maxStage} onChange={(value) => updateField('maxStage', value)} min={0} />
                    </div>
                    <button
                        type="submit"
                        disabled={form.name.trim().length === 0}
                        className="h-11 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-45"
                        style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}
                    >
                        <Plus size={16} />
                        追加
                    </button>
                </form>
            </section>
        </div>
    );
}

function NumberField({ label, value, onChange, min }: { label: string; value: string; onChange: (value: string) => void; min: number }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
            <input
                type="number"
                inputMode="numeric"
                min={min}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="h-10 rounded-lg px-2 text-sm outline-none"
                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}
            />
        </label>
    );
}
