import { useEffect, useState } from 'react';
import { CloudOff, UserRound } from 'lucide-react';
import {
    deleteCurrentAccount,
    cancelPasswordRecovery,
    getCurrentUser,
    getGoogleOAuthState,
    getPasswordRecoveryState,
    requestPasswordReset,
    resendEmailVerification,
    signInWithEmail,
    signInWithApple,
    signInWithGoogle,
    signOutUser,
    signUpWithEmail,
    subscribeGoogleOAuthState,
    subscribeAppleOAuthState,
    subscribePasswordRecoveryState,
    updatePasswordFromRecovery,
} from '../../platform/auth';
import { readWebSupabaseEnv } from '../../platform/supabase';

type Mode = 'signIn' | 'signUp' | 'passwordReset';

/**
 * アカウントセクション（#503、メール認証の最小UI）。
 * Supabase未設定の環境では案内のみ表示し、アプリは完全ローカルで動作し続ける。
 */
export function AccountSettings() {
    const configured = readWebSupabaseEnv() !== null;
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [passwordConfirmation, setPasswordConfirmation] = useState('');
    const [mode, setMode] = useState<Mode>('signIn');
    const [currentUser, setCurrentUser] = useState<{ userId: string; email: string | null } | null>(null);
    const [verificationEmail, setVerificationEmail] = useState<string | null>(null);
    const [recoveryState, setRecoveryState] = useState(getPasswordRecoveryState);
    const [googleOAuthState, setGoogleOAuthState] = useState(getGoogleOAuthState);
    const [message, setMessage] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [deleteConfirming, setDeleteConfirming] = useState(false);
    const [deleteText, setDeleteText] = useState('');

    useEffect(() => {
        let cancelled = false;
        void getCurrentUser().then((user) => {
            if (!cancelled) setCurrentUser(user);
        });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => subscribePasswordRecoveryState(setRecoveryState), []);
    useEffect(() => subscribeGoogleOAuthState((state) => {
        setGoogleOAuthState(state);
        if (state.status === 'success') {
            void getCurrentUser().then((user) => setCurrentUser(user));
        }
    }), []);
    useEffect(() => subscribeAppleOAuthState((state) => {
        if (state.status === 'success') void getCurrentUser().then(setCurrentUser);
        if (state.status === 'error') setMessage(state.message);
    }), []);

    const handleSubmit = async () => {
        setBusy(true);
        setMessage(null);
        const action = mode === 'signIn' ? signInWithEmail : signUpWithEmail;
        const result = await action(email.trim(), password);
        if (result.ok) {
            const user = await getCurrentUser();
            setCurrentUser(user);
            if (mode === 'signUp' && result.emailVerificationPending) {
                setVerificationEmail(email.trim());
                setMessage('登録を受け付けました。確認が必要な場合は受信箱の案内をご確認ください。');
            } else {
                setMessage(mode === 'signIn' ? 'ログインしました' : '登録しました');
            }
            setPassword('');
        } else {
            setMessage(result.message);
        }
        setBusy(false);
    };

    const handlePasswordResetRequest = async () => {
        setBusy(true);
        setMessage(null);
        const result = await requestPasswordReset(email.trim());
        setMessage(result.ok
            ? '入力したメールアドレスに、パスワード再設定用のリンクを送信しました。'
            : result.message);
        setBusy(false);
    };

    const handleGoogleSignIn = async () => {
        setBusy(true);
        setMessage(null);
        const result = await signInWithGoogle();
        if (!result.ok) setMessage(result.message);
        setBusy(false);
    };

    const handleAppleSignIn = async () => {
        setBusy(true);
        setMessage(null);
        const result = await signInWithApple();
        if (!result.ok) setMessage(result.message);
        setBusy(false);
    };

    const handleResendVerification = async () => {
        if (!verificationEmail) return;
        setBusy(true);
        setMessage(null);
        await resendEmailVerification(verificationEmail);
        setMessage('確認が必要な場合は、受信箱の案内をご確認ください。');
        setBusy(false);
    };

    const handleRecoveryPasswordUpdate = async () => {
        setBusy(true);
        setMessage(null);
        const result = await updatePasswordFromRecovery(password);
        if (result.ok) {
            setPassword('');
            setPasswordConfirmation('');
            setMessage('パスワードを更新しました。新しいパスワードでログインできます。');
        } else {
            setMessage(result.message);
        }
        setBusy(false);
    };

    const handleRecoveryCancel = async (nextMode: Mode = 'signIn') => {
        setBusy(true);
        setMessage(null);
        const result = await cancelPasswordRecovery();
        if (result.ok) {
            setPassword('');
            setPasswordConfirmation('');
            setCurrentUser(null);
            setVerificationEmail(null);
            setMode(nextMode);
        } else {
            setMessage(result.message);
        }
        setBusy(false);
    };

    const handleSignOut = async () => {
        setBusy(true);
        const result = await signOutUser();
        if (result.ok) {
            setCurrentUser(null);
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
            setCurrentUser(null);
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
            ) : recoveryState === 'ready' ? (
                <div className="flex flex-col gap-2">
                    <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>新しいパスワードを設定してください。</p>
                    <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="新しいパスワード（6文字以上）"
                        autoComplete="new-password"
                        aria-label="新しいパスワード"
                        className="px-3 py-2 rounded-lg text-sm"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}
                    />
                    <input
                        type="password"
                        value={passwordConfirmation}
                        onChange={(event) => setPasswordConfirmation(event.target.value)}
                        placeholder="新しいパスワード（確認）"
                        autoComplete="new-password"
                        aria-label="新しいパスワードの確認"
                        className="px-3 py-2 rounded-lg text-sm"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}
                    />
                    {passwordConfirmation.length > 0 && password !== passwordConfirmation && (
                        <p role="alert" className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>パスワードが一致しません。</p>
                    )}
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={handleRecoveryPasswordUpdate} disabled={busy || password.length < 6 || password !== passwordConfirmation} className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: 'var(--color-accent-primary)', color: '#fff' }}>
                            {busy ? '更新中' : 'パスワードを更新'}
                        </button>
                        <button type="button" onClick={() => { void handleRecoveryCancel(); }} disabled={busy} className="text-xs underline disabled:opacity-50" style={{ color: 'var(--color-text-muted)' }}>キャンセル</button>
                    </div>
                </div>
            ) : recoveryState === 'invalid' ? (
                <div className="flex flex-col gap-2">
                    <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>このリンクは無効または期限切れです。もう一度パスワードを再設定してください。</p>
                    <button type="button" onClick={() => { void handleRecoveryCancel('passwordReset'); }} disabled={busy} className="self-start text-xs underline disabled:opacity-50" style={{ color: 'var(--color-text-muted)' }}>パスワードを再設定する</button>
                </div>
            ) : currentUser ? (
                <div className="flex flex-col gap-3">
                    <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                        ログイン中: <span style={{ color: 'var(--color-text-primary)' }}>{currentUser.email ?? 'Appleアカウント'}</span>
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
            ) : verificationEmail ? (
                <div className="flex flex-col gap-2">
                    <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                        {verificationEmail} 宛てに確認メールを送信しました。リンクを開くまでログインできません。
                    </p>
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={handleResendVerification} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}>
                            {busy ? '送信中' : '確認メールを再送'}
                        </button>
                        <button type="button" onClick={() => { setVerificationEmail(null); setMode('signIn'); }} disabled={busy} className="text-xs underline disabled:opacity-50" style={{ color: 'var(--color-text-muted)' }}>ログインへ戻る</button>
                    </div>
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    {mode === 'signIn' && (
                        <>
                            <button
                                type="button"
                                onClick={handleAppleSignIn}
                                disabled={busy}
                                className="px-4 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50"
                                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}
                            >
                                Appleで続ける
                            </button>
                            <button
                                type="button"
                                onClick={handleGoogleSignIn}
                                disabled={busy}
                                className="px-4 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50"
                                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}
                            >
                                Googleで続ける
                            </button>
                            <p className="text-center text-xs" style={{ color: 'var(--color-text-muted)' }}>またはGoogle・メールアドレスで続ける</p>
                        </>
                    )}
                    <input
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="メールアドレス"
                        autoComplete="email"
                        className="px-3 py-2 rounded-lg text-sm"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}
                    />
                    {mode !== 'passwordReset' && <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="パスワード（6文字以上）"
                        autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
                        aria-label="パスワード"
                        className="px-3 py-2 rounded-lg text-sm"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}
                    />}
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={mode === 'passwordReset' ? handlePasswordResetRequest : handleSubmit}
                            disabled={busy || !email.trim() || (mode !== 'passwordReset' && password.length < 6)}
                            className="px-4 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-50"
                            style={{ backgroundColor: 'var(--color-accent-primary)', color: '#fff' }}
                        >
                            {mode === 'signIn' ? 'ログイン' : mode === 'signUp' ? '新規登録' : '再設定メールを送る'}
                        </button>
                        <button
                            type="button"
                            onClick={() => { setMode(mode === 'signIn' ? 'signUp' : 'signIn'); setPassword(''); setPasswordConfirmation(''); }}
                            className="text-xs underline"
                            style={{ color: 'var(--color-text-muted)' }}
                        >
                            {mode === 'signIn' ? 'アカウントを作る' : 'ログインへ戻る'}
                        </button>
                        {mode === 'signIn' && <button type="button" onClick={() => { setMode('passwordReset'); setPassword(''); setPasswordConfirmation(''); }} className="text-xs underline" style={{ color: 'var(--color-text-muted)' }}>パスワードを忘れた場合</button>}
                    </div>
                </div>
            )}

            {message && (
                <p role="status" className="text-xs mt-3" style={{ color: 'var(--color-text-secondary)' }}>{message}</p>
            )}
            {googleOAuthState.status === 'error' && (
                <p role="alert" className="text-xs mt-3" style={{ color: 'var(--color-text-secondary)' }}>{googleOAuthState.message}</p>
            )}
        </section>
    );
}
