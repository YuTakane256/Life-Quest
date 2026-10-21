import { useEffect, useRef } from 'react';
import { Check, X } from 'lucide-react';
import { GAME_STATE_LIMITS, type AvatarId } from '@life-quest/core/gameState';
import heroImg from '@life-quest/assets/images/hero.png';
import heroMaleImg from '@life-quest/assets/images/hero_male.png';
import { useModalEscape } from '../../hooks/useModalEscape';

export interface ProfileEditorProps {
    name: string; avatar: AvatarId; error: string;
    onNameChange: (name: string) => void; onAvatarChange: (avatar: AvatarId) => void;
    onSave: () => void; onClose: () => void;
}

export function ProfileEditor({ name, avatar, error, onNameChange, onAvatarChange, onSave, onClose }: ProfileEditorProps) {
    const dialog = useRef<HTMLFormElement>(null);
    const input = useRef<HTMLInputElement>(null);
    useModalEscape(true, onClose);
    useEffect(() => {
        const opener = document.activeElement;
        const bodyOverflow = document.body.style.overflow;
        const rootOverflow = document.documentElement.style.overflow;
        document.body.style.overflow = 'hidden';
        document.documentElement.style.overflow = 'hidden';
        input.current?.focus();
        return () => {
            document.body.style.overflow = bodyOverflow;
            document.documentElement.style.overflow = rootOverflow;
            if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
        };
    }, []);
    return <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}>
        <form ref={dialog} role="dialog" aria-modal="true" aria-labelledby="profile-edit-title"
            className="w-full min-w-0 max-w-sm rounded-2xl p-5 overflow-y-auto" style={{ maxHeight: 'calc(100dvh - 32px)', backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', overflowWrap: 'anywhere' }}
            onSubmit={(event) => { event.preventDefault(); onSave(); }} onKeyDown={(event) => {
                if (event.key !== 'Tab') return;
                const nodes = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)');
                const first = nodes?.[0]; const last = nodes?.[nodes.length - 1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }}>
            <div className="flex items-center justify-between gap-2 mb-4">
                <h2 id="profile-edit-title" className="text-lg font-bold min-w-0" style={{ color: 'var(--color-text-primary)' }}>プロフィール編集</h2>
                <button type="button" onClick={onClose} aria-label="プロフィール編集を閉じる" className="min-h-11 min-w-11 shrink-0 rounded-lg flex items-center justify-center" style={{ color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg-secondary)' }}><X size={20} /></button>
            </div>
            <label htmlFor="profile-name" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>名前</label>
            <input ref={input} id="profile-name" aria-label="キャラクター名" type="text" value={name} onChange={(event) => onNameChange(event.target.value)}
                className="w-full min-w-0 min-h-11 px-3 py-2.5 rounded-xl text-base outline-none mb-4" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }} placeholder="名前を入力" maxLength={GAME_STATE_LIMITS.maxCharacterNameLength} />
            <p className="text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>アバター</p>
            <div role="group" aria-label="アバター" className="grid gap-3 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(120px, 100%), 1fr))' }}>
                {([['female', '女性', heroImg], ['male', '男性', heroMaleImg]] as const).map(([value, label, image]) => <button key={value} type="button"
                    aria-label={`アバターを${label}にする`} aria-pressed={avatar === value} onClick={() => onAvatarChange(value)}
                    className="min-w-0 min-h-11 p-3 rounded-xl border flex flex-col items-center gap-2 relative" style={{ backgroundColor: avatar === value ? 'var(--color-bg-secondary)' : 'transparent', borderColor: avatar === value ? 'var(--color-accent-primary)' : 'var(--color-border-default)' }}>
                    <img src={image} alt="" className="w-14 h-14 rounded-lg object-cover max-w-full" />
                    <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>{label}</span>
                    {avatar === value && <Check size={14} aria-hidden="true" className="absolute top-2 right-2" style={{ color: 'var(--color-accent-primary)' }} />}
                </button>)}
            </div>
            {error && <p role="alert" className="text-sm mb-4" style={{ color: 'var(--color-text-danger)' }}>{error}</p>}
            <div className="flex flex-wrap gap-2">
                <button type="submit" className="min-h-11 flex-1 min-w-0 px-3 py-3 rounded-xl text-base font-bold" style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>保存する</button>
                <button type="button" onClick={onClose} className="min-h-11 min-w-0 px-3 py-3 rounded-xl text-sm" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}>キャンセル</button>
            </div>
        </form>
    </div>;
}
