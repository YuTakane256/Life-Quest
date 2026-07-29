import { useEffect, useState } from 'react';
import { CloudOff, UserRound } from 'lucide-react';
import { deleteCurrentAccount, getCurrentUser, signInWithEmail, signOutUser, signUpWithEmail } from '../../platform/auth';
import { readWebSupabaseEnv } from '../../platform/supabase';

type Mode = 'signIn' | 'signUp';

/**
 * アカウントセクション（#503、メール認証の最小UI）。
 * Supabase未設定の環境では案内のみ表示し、アプリは完全ローカルで動作し続ける。
 */
export function AccountSettings() {
    const configured = readWebSupabaseEnv() !== null;
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [mode, setMode] = useState<Mode>('signIn');
    const [currentEmail, setCurrentEmail] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [deleteConfirming, setDeleteConfirming] = useState(false);
    const [deleteText, setDeleteText] = useState('');

    useEffect(() => {
        let cancelled = false;
        void getCurrentUser().then((user) => {
            if (!cancelled) setCurrentEmail(user?.email ?? null);
        });
        return () => { cancelled = true; };
    }, []);

    const handleSubmit = async () => {
        setBusy(true);
        setMessage(null);
        const action = mode === 'signIn' ? signInWithEmail : signUpWithEmail;
        const result = await action(email.trim(), password);
        if (result.ok) {
            const user = await getCurrentUser();
            setCurrentEmail(user?.email ?? null);
            setMessage(mode === 'signIn' ? 'ログインしました' : '登録しました（確認メールが必要な場合があります）');
            setPassword('');
        } else {
            setMessage(result.message);
        }
        setBusy(false);
    };

    const handleSignOut = async () => {
        setBusy(true);
        const result = await signOutUser();
        if (result.ok) {
            setCurrentEmail(null);
            setMessage('ログアウトしました（この端末のデータは残ります）');
        } else {
            setMessage(result.message);
        }
        setBusy(false);
    };

    const handleDelete = async () => {
        if (busy || deleteText !== '削除') return;
        setBusy(true);
        setMessage(null);
        const result = await deleteCurrentAccount();
        if (result.ok) {
            setCurrentEmail(null);
            setDeleteConfirming(false);
            setDeleteText('');
            setMessage('アカウントとクラウドデータを削除しました');
        } else setMessage(result.message);
        setBusy(false);
    };

    return (
        <section
            className="rounded-xl p-4"
            style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
            aria-label="アカウント"
        >
            <div className="flex items-start gap-2 mb-3">
                <UserRound size={16} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-accent-primary)' }} />
                <div>
                    <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>アカウント</h2>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                        ログインするとWebとモバイルでデータを同期できるようになります（同期機能は準備中）
                    </p>
                </div>
            </div>

            {!configured ? (
                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    <CloudOff size={14} />
                    クラウド接続は未設定です。これまでどおり端末内のみで動作します。
                </div>
            ) : currentEmail ? (
                <div className="flex flex-col gap-3">
                    <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                        ログイン中: <span style={{ color: 'var(--color-text-primary)' }}>{currentEmail}</span>
                    </p>
                    <button
                        type="button"
                        onClick={handleSignOut}
                        disabled={busy}
                        className="self-start px-4 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}
                    >
                        ログアウト
                    </button>
                    {!deleteConfirming ? (
                        <button
                            type="button"
                            onClick={() => setDeleteConfirming(true)}
                            disabled={busy}
                            className="self-start text-sm disabled:opacity-50"
                            style={{ color: 'var(--color-danger, #dc2626)' }}
                        >
                            アカウントを削除
                        </button>
                    ) : (
                        <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: 'var(--color-border-default)' }}>
                            <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>クラウド上のデータは完全に削除されます。確認のため「削除」と入力してください。</p>
                            <input
                                value={deleteText}
                                onChange={(event) => setDeleteText(event.target.value)}
                                placeholder="削除"
                                aria-label="退会確認文字"
                                className="px-3 py-2 rounded-lg text-sm"
                                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}
                            />
                            <div className="flex gap-2">
                                <button type="button" onClick={handleDelete} disabled={busy || deleteText !== '削除'} className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: 'var(--color-danger, #dc2626)', color: '#fff' }}>
                                    {busy ? '削除中' : '完全に削除する'}
                                </button>
                                <button type="button" onClick={() => { setDeleteConfirming(false); setDeleteText(''); }} disabled={busy} className="text-xs underline disabled:opacity-50" style={{ color: 'var(--color-text-muted)' }}>キャンセル</button>
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    <input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="メールアドレス"
                        autoComplete="email"
                        className="px-3 py-2 rounded-lg text-sm"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}
                    />
                    <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="パスワード（6文字以上）"
                        autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
                        className="px-3 py-2 rounded-lg text-sm"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}
                    />
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={busy || !email.trim() || password.length < 6}
                            className="px-4 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50"
                            style={{ backgroundColor: 'var(--color-accent-primary)', color: '#fff' }}
                        >
                            {mode === 'signIn' ? 'ログイン' : '新規登録'}
                        </button>
                        <button
                            type="button"
                            onClick={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}
                            className="text-xs underline"
                            style={{ color: 'var(--color-text-muted)' }}
                        >
                            {mode === 'signIn' ? 'アカウントを作る' : 'ログインへ戻る'}
                        </button>
                    </div>
                </div>
            )}

            {message && (
                <p role="status" className="text-xs mt-3" style={{ color: 'var(--color-text-secondary)' }}>{message}</p>
            )}
        </section>
    );
}
