import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import type { ThemePalette } from '@life-quest/core/designTokens';
import type { CloudSyncPublicState } from '@life-quest/core/cloudSyncState';
import {
    deleteCurrentAccount,
    cancelPasswordRecovery,
    getCurrentUser,
    getPasswordRecoveryState,
    requestPasswordReset,
    resendEmailVerification,
    signInWithEmail,
    signOutUser,
    signUpWithEmail,
    subscribePasswordRecoveryState,
    updatePasswordFromRecovery,
} from '../platform/auth';
import {
    approveMobileContentImport,
    getPendingMobileContent,
    type PendingMobileContent,
} from '../platform/cloudMigration';
import { ensureNotificationPermission } from '../platform/notifications';
import { readMobileSupabaseEnv } from '../platform/supabase';
import { getMobileCloudSyncState, subscribeMobileCloudSyncState, syncMobileNow } from '../platform/cloudSync';
import {
    useMobileSettingsStore,
    type MobileMotionMode,
    type MobileThemeMode,
} from '../stores/useMobileSettingsStore';
import { usePalette } from '../theme/usePalette';

type Mode = 'signIn' | 'signUp' | 'passwordReset';

type StorageSummary = {
    loading: boolean;
    appKeyCount: number;
    cloudKeyCount: number;
    bytes: number;
};

const THEME_OPTIONS: readonly { mode: MobileThemeMode; label: string }[] = [
    { mode: 'light', label: 'ライト' },
    { mode: 'dark', label: 'ダーク' },
    { mode: 'system', label: 'システム' },
];

const MOTION_OPTIONS: readonly { mode: MobileMotionMode; label: string }[] = [
    { mode: 'standard', label: '標準' },
    { mode: 'reduced', label: '減らす' },
    { mode: 'system', label: 'システム' },
];

const REMINDER_HOURS = [7, 12, 20, 22] as const;

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
    return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

function syncMessage(state: CloudSyncPublicState): string {
    if (state.availability === 'inactive') return 'ログインすると同期状態を確認できます';
    if (state.push.failureKinds.includes('auth-required')) return '再ログインすると保留中の同期を再開できます';
    if (state.push.conflict > 0) return '一部の変更に競合があります。今すぐ同期では自動再送しません';
    if (state.push.failed > 0) return '一部の変更を同期できませんでした。今すぐ同期では自動再送しません';
    if (state.pull.phase === 'failed') return 'クラウドの変更を確認できませんでした。接続を確認してください';
    if (state.push.pending > 0 || state.push.inflight > 0) return `同期を待っている変更: ${state.push.pending + state.push.inflight}件`;
    if (state.pull.lastSuccessAt === null) return 'クラウドの変更を確認しています';
    return '同期済み';
}

async function readStorageSummary(): Promise<StorageSummary> {
    const keys = await AsyncStorage.getAllKeys();
    const appKeys = keys.filter((key) => key.startsWith('quest-board') || key.startsWith('life-quest:'));
    const values = await Promise.all(appKeys.map((key) => AsyncStorage.getItem(key)));
    const bytes = appKeys.reduce((sum, key, index) => sum + key.length + (values[index]?.length ?? 0), 0) * 2;
    return {
        loading: false,
        appKeyCount: appKeys.length,
        cloudKeyCount: appKeys.filter((key) => key.startsWith('life-quest:cloud:')).length,
        bytes,
    };
}

export default function SettingsScreen() {
    const configured = readMobileSupabaseEnv() !== null;
    const themeMode = useMobileSettingsStore((state) => state.themeMode);
    const setThemeMode = useMobileSettingsStore((state) => state.setThemeMode);
    const motionMode = useMobileSettingsStore((state) => state.motionMode);
    const setMotionMode = useMobileSettingsStore((state) => state.setMotionMode);
    const notificationsEnabled = useMobileSettingsStore((state) => state.notificationsEnabled);
    const setNotificationsEnabled = useMobileSettingsStore((state) => state.setNotificationsEnabled);
    const habitReminderHour = useMobileSettingsStore((state) => state.habitReminderHour);
    const setHabitReminderHour = useMobileSettingsStore((state) => state.setHabitReminderHour);

    const { palette } = usePalette();
    const styles = useMemo(() => createStyles(palette), [palette]);

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [passwordConfirmation, setPasswordConfirmation] = useState('');
    const [mode, setMode] = useState<Mode>('signIn');
    const [currentEmail, setCurrentEmail] = useState<string | null>(null);
    const [verificationEmail, setVerificationEmail] = useState<string | null>(null);
    const [recoveryState, setRecoveryState] = useState(getPasswordRecoveryState);
    const [message, setMessage] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [deleteConfirming, setDeleteConfirming] = useState(false);
    const [deleteText, setDeleteText] = useState('');
    const [pendingContent, setPendingContent] = useState<PendingMobileContent | null>(null);
    const [importMessage, setImportMessage] = useState<string | null>(null);
    const [storageSummary, setStorageSummary] = useState<StorageSummary>({
        loading: true,
        appKeyCount: 0,
        cloudKeyCount: 0,
        bytes: 0,
    });
    const [notificationMessage, setNotificationMessage] = useState<string | null>(null);
    const [syncState, setSyncState] = useState<CloudSyncPublicState>(getMobileCloudSyncState);
    const [syncing, setSyncing] = useState(false);

    // ONにする時はOSの通知許可を要求し、拒否されたらトグルを戻す（Web設定画面と同じ挙動）
    const handleNotificationsToggle = useCallback(async (enabled: boolean) => {
        setNotificationMessage(null);
        if (!enabled) {
            setNotificationsEnabled(false);
            return;
        }
        const granted = await ensureNotificationPermission();
        if (granted) {
            setNotificationsEnabled(true);
        } else {
            setNotificationsEnabled(false);
            setNotificationMessage('通知が許可されていません。端末の設定アプリから通知を許可してください。');
        }
    }, [setNotificationsEnabled]);

    const refreshAccount = useCallback(async (): Promise<void> => {
        const user = await getCurrentUser();
        setCurrentEmail(user?.email ?? null);
        if (!user) {
            setPendingContent(null);
            return;
        }
        const pending = await getPendingMobileContent(user.userId);
        setPendingContent(pending.tasks.length > 0 || pending.habits.length > 0 ? pending : null);
    }, []);

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            await refreshAccount();
            if (cancelled) return;
            try {
                const summary = await readStorageSummary();
                if (!cancelled) setStorageSummary(summary);
            } catch {
                if (!cancelled) setStorageSummary((current) => ({ ...current, loading: false }));
            }
        })();
        return () => { cancelled = true; };
    }, [refreshAccount]);

    useEffect(() => subscribeMobileCloudSyncState(setSyncState), []);
    useEffect(() => subscribePasswordRecoveryState(setRecoveryState), []);

    const handleSyncNow = async (): Promise<void> => {
        if (syncing || syncState.availability !== 'ready') return;
        setSyncing(true);
        try { await syncMobileNow(); } finally { setSyncing(false); }
    };

    const handleImportContent = async () => {
        if (!pendingContent) return;
        setBusy(true);
        setImportMessage(null);
        const result = await approveMobileContentImport(pendingContent);
        if (result.status === 'imported') {
            setPendingContent(null);
            setImportMessage('この端末のデータをクラウドへ統合しました');
            void readStorageSummary().then(setStorageSummary).catch(() => undefined);
        } else if (result.status === 'web_migration_required') {
            setImportMessage('先にWeb版でログインして初回設定を完了してください');
        } else {
            setImportMessage(result.message);
        }
        setBusy(false);
    };

    const handleSubmit = async () => {
        setBusy(true);
        setMessage(null);
        const action = mode === 'signIn' ? signInWithEmail : signUpWithEmail;
        const result = await action(email.trim(), password);
        if (result.ok) {
            await refreshAccount();
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

    const handlePasswordResetRequest = async (): Promise<void> => {
        setBusy(true);
        setMessage(null);
        const result = await requestPasswordReset(email.trim());
        setMessage(result.ok
            ? '入力したメールアドレスに、パスワード再設定用のリンクを送信しました。'
            : result.message);
        setBusy(false);
    };

    const handleResendVerification = async (): Promise<void> => {
        if (!verificationEmail) return;
        setBusy(true);
        setMessage(null);
        await resendEmailVerification(verificationEmail);
        setMessage('確認が必要な場合は、受信箱の案内をご確認ください。');
        setBusy(false);
    };

    const handleRecoveryPasswordUpdate = async (): Promise<void> => {
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

    const handleRecoveryCancel = async (nextMode: Mode = 'signIn'): Promise<void> => {
        setBusy(true);
        setMessage(null);
        const result = await cancelPasswordRecovery();
        if (result.ok) {
            setPassword('');
            setPasswordConfirmation('');
            setCurrentEmail(null);
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
            setCurrentEmail(null);
            setPendingContent(null);
            setMessage('ログアウトしました（この端末のデータは残ります）');
        } else {
            setMessage(result.message);
        }
        setBusy(false);
    };

    const handleDelete = async (): Promise<void> => {
        if (busy || deleteText !== '削除') return;
        setBusy(true);
        setMessage(null);
        const result = await deleteCurrentAccount();
        if (result.ok) {
            setCurrentEmail(null);
            setPendingContent(null);
            setDeleteConfirming(false);
            setDeleteText('');
            setMessage('アカウントとクラウドデータを削除しました');
        } else setMessage(result.message);
        setBusy(false);
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <ScrollView contentContainerStyle={styles.scroll}>
                <View style={styles.header}>
                    <Text style={styles.title}>設定</Text>
                </View>

                <View style={styles.stack}>
                    <Card title="アカウント" styles={styles}>
                        <Text style={styles.hint}>WebとMobileで同じデータを使います</Text>
                        {!configured ? (
                            <Text style={styles.mutedText}>
                                クラウド接続は未設定です。これまでどおり端末内のみで動作します。
                            </Text>
                        ) : recoveryState === 'ready' ? (
                            <View style={styles.form}>
                                <Text style={styles.hint}>新しいパスワードを設定してください。</Text>
                                <TextInput
                                    value={password}
                                    onChangeText={setPassword}
                                    placeholder="新しいパスワード（6文字以上）"
                                    placeholderTextColor={palette.text.muted}
                                    secureTextEntry
                                    autoComplete="new-password"
                                    accessibilityLabel="新しいパスワード"
                                    style={styles.input}
                                />
                                <TextInput
                                    value={passwordConfirmation}
                                    onChangeText={setPasswordConfirmation}
                                    placeholder="新しいパスワード（確認）"
                                    placeholderTextColor={palette.text.muted}
                                    secureTextEntry
                                    autoComplete="new-password"
                                    accessibilityLabel="新しいパスワードの確認"
                                    style={styles.input}
                                />
                                {passwordConfirmation.length > 0 && password !== passwordConfirmation && <Text accessibilityRole="alert" style={styles.hint}>パスワードが一致しません。</Text>}
                                <View style={styles.formActions}>
                                    <Pressable accessibilityRole="button" accessibilityLabel="パスワードを更新する" disabled={busy || password.length < 6 || password !== passwordConfirmation} onPress={() => { void handleRecoveryPasswordUpdate(); }} style={({ pressed }) => [styles.primaryButton, (busy || password.length < 6 || password !== passwordConfirmation || pressed) && styles.muted]}>
                                        <Text style={styles.primaryButtonText}>{busy ? '更新中' : 'パスワードを更新'}</Text>
                                    </Pressable>
                                    <Pressable accessibilityRole="button" accessibilityLabel="パスワード更新をキャンセルする" disabled={busy} onPress={() => { void handleRecoveryCancel(); }}><Text style={styles.linkText}>キャンセル</Text></Pressable>
                                </View>
                            </View>
                        ) : recoveryState === 'invalid' ? (
                            <View style={styles.form}>
                                <Text style={styles.hint}>このリンクは無効または期限切れです。もう一度パスワードを再設定してください。</Text>
                                <Pressable accessibilityRole="button" accessibilityLabel="パスワードを再設定する" disabled={busy} onPress={() => { void handleRecoveryCancel('passwordReset'); }}><Text style={styles.linkText}>パスワードを再設定する</Text></Pressable>
                            </View>
                        ) : currentEmail ? (
                            <View style={styles.loggedIn}>
                                <Text style={styles.bodyText}>ログイン中: {currentEmail}</Text>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="ログアウトする"
                                    disabled={busy}
                                    onPress={handleSignOut}
                                    style={({ pressed }) => [styles.secondaryButton, (busy || pressed) && styles.muted]}
                                >
                                    <Text style={styles.secondaryButtonText}>ログアウト</Text>
                                </Pressable>
                                {!deleteConfirming ? (
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel="アカウントを削除する"
                                        disabled={busy}
                                        onPress={() => setDeleteConfirming(true)}
                                        style={({ pressed }) => [styles.deleteLink, (busy || pressed) && styles.muted]}
                                    >
                                        <Text style={styles.deleteLinkText}>アカウントを削除</Text>
                                    </Pressable>
                                ) : (
                                    <View style={styles.deletePanel}>
                                        <Text style={styles.hint}>クラウド上のデータは完全に削除されます。確認のため「削除」と入力してください。</Text>
                                        <TextInput value={deleteText} onChangeText={setDeleteText} placeholder="削除" placeholderTextColor={palette.text.muted} accessibilityLabel="退会確認文字" style={styles.input} />
                                        <View style={styles.formActions}>
                                            <Pressable accessibilityRole="button" accessibilityLabel="アカウントを完全に削除する" accessibilityState={{ disabled: busy || deleteText !== '削除', busy }} disabled={busy || deleteText !== '削除'} onPress={() => { void handleDelete(); }} style={({ pressed }) => [styles.deleteButton, (busy || deleteText !== '削除' || pressed) && styles.muted]}>
                                                <Text style={styles.primaryButtonText}>{busy ? '削除中' : '完全に削除する'}</Text>
                                            </Pressable>
                                            <Pressable accessibilityRole="button" accessibilityLabel="退会をキャンセルする" disabled={busy} onPress={() => { setDeleteConfirming(false); setDeleteText(''); }}><Text style={styles.linkText}>キャンセル</Text></Pressable>
                                        </View>
                                    </View>
                                )}
                            </View>
                        ) : verificationEmail ? (
                            <View style={styles.form}>
                                <Text style={styles.hint}>{verificationEmail} 宛てに確認メールを送信しました。リンクを開くまでログインできません。</Text>
                                <View style={styles.formActions}>
                                    <Pressable accessibilityRole="button" accessibilityLabel="確認メールを再送する" disabled={busy} onPress={() => { void handleResendVerification(); }} style={({ pressed }) => [styles.secondaryButton, (busy || pressed) && styles.muted]}>
                                        <Text style={styles.secondaryButtonText}>{busy ? '送信中' : '確認メールを再送'}</Text>
                                    </Pressable>
                                    <Pressable accessibilityRole="button" accessibilityLabel="ログインへ戻る" disabled={busy} onPress={() => { setVerificationEmail(null); setMode('signIn'); }}><Text style={styles.linkText}>ログインへ戻る</Text></Pressable>
                                </View>
                            </View>
                        ) : (
                            <View style={styles.form}>
                                <TextInput
                                    value={email}
                                    onChangeText={setEmail}
                                    placeholder="メールアドレス"
                                    placeholderTextColor={palette.text.muted}
                                    autoCapitalize="none"
                                    keyboardType="email-address"
                                    accessibilityLabel="メールアドレス"
                                    style={styles.input}
                                />
                                {mode !== 'passwordReset' && <TextInput
                                    value={password}
                                    onChangeText={setPassword}
                                    placeholder="パスワード（6文字以上）"
                                    placeholderTextColor={palette.text.muted}
                                    secureTextEntry
                                    accessibilityLabel="パスワード"
                                    style={styles.input}
                                />}
                                <View style={styles.formActions}>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={mode === 'signIn' ? 'ログインする' : mode === 'signUp' ? '新規登録する' : '再設定メールを送る'}
                                        disabled={busy || !email.trim() || (mode !== 'passwordReset' && password.length < 6)}
                                        onPress={() => { void (mode === 'passwordReset' ? handlePasswordResetRequest() : handleSubmit()); }}
                                        style={({ pressed }) => [
                                            styles.primaryButton,
                                            (busy || !email.trim() || (mode !== 'passwordReset' && password.length < 6) || pressed) && styles.muted,
                                        ]}
                                    >
                                        <Text style={styles.primaryButtonText}>{mode === 'signIn' ? 'ログイン' : mode === 'signUp' ? '新規登録' : '再設定メールを送る'}</Text>
                                    </Pressable>
                                    <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={mode === 'signIn' ? '新規登録へ切り替える' : 'ログインへ切り替える'}
                                        onPress={() => { setMode(mode === 'signIn' ? 'signUp' : 'signIn'); setPassword(''); setPasswordConfirmation(''); }}
                                        hitSlop={8}
                                    >
                                        <Text style={styles.linkText}>{mode === 'signIn' ? 'アカウントを作る' : 'ログインへ戻る'}</Text>
                                    </Pressable>
                                    {mode === 'signIn' && <Pressable accessibilityRole="button" accessibilityLabel="パスワードを忘れた場合" onPress={() => { setMode('passwordReset'); setPassword(''); setPasswordConfirmation(''); }} hitSlop={8}><Text style={styles.linkText}>パスワードを忘れた場合</Text></Pressable>}
                                </View>
                            </View>
                        )}
                        {message && <Text accessibilityRole="alert" style={styles.message}>{message}</Text>}
                    </Card>

                    <Card title="同期" styles={styles}>
                        <Text
                            accessibilityRole={syncState.attention === 'required' ? 'alert' : undefined}
                            accessibilityLiveRegion="polite"
                            style={[styles.hint, syncState.attention === 'required' && styles.syncWarning]}
                        >
                            {syncMessage(syncState)}
                        </Text>
                        {syncState.pull.lastSuccessAt && syncState.attention !== 'required' && (
                            <Text style={styles.hint}>最終確認: {new Date(syncState.pull.lastSuccessAt).toLocaleString('ja-JP')}</Text>
                        )}
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="今すぐ同期"
                            accessibilityState={{ disabled: syncing || syncState.availability !== 'ready', busy: syncing }}
                            disabled={syncing || syncState.availability !== 'ready'}
                            onPress={() => { void handleSyncNow(); }}
                            style={({ pressed }) => [styles.syncButton, (syncing || syncState.availability !== 'ready' || pressed) && styles.muted]}
                        >
                            <Text style={styles.syncButtonText}>{syncing ? '同期中' : '今すぐ同期'}</Text>
                        </Pressable>
                    </Card>

                    <Card title="テーマ" styles={styles}>
                        <SegmentedControl
                            options={THEME_OPTIONS}
                            value={themeMode}
                            onChange={setThemeMode}
                            styles={styles}
                        />
                    </Card>

                    <Card title="動きの量" styles={styles}>
                        <SegmentedControl
                            options={MOTION_OPTIONS}
                            value={motionMode}
                            onChange={setMotionMode}
                            styles={styles}
                        />
                    </Card>

                    <Card title="通知" styles={styles}>
                        <View style={styles.rowBetween}>
                            <View style={styles.rowText}>
                                <Text style={styles.bodyText}>習慣リマインダー</Text>
                                <Text style={styles.hint}>{habitReminderHour}:00</Text>
                            </View>
                            <Switch
                                value={notificationsEnabled}
                                onValueChange={(enabled) => { void handleNotificationsToggle(enabled); }}
                                trackColor={{ false: palette.bg.tertiary, true: palette.accent.primary }}
                                thumbColor="#ffffff"
                                accessibilityLabel="習慣リマインダー通知"
                            />
                        </View>
                        {notificationMessage && (
                            <Text accessibilityRole="alert" style={styles.hint}>{notificationMessage}</Text>
                        )}
                        <View style={styles.chipRow}>
                            {REMINDER_HOURS.map((hour) => (
                                <Pressable
                                    key={hour}
                                    accessibilityRole="radio"
                                    accessibilityState={{ selected: habitReminderHour === hour }}
                                    accessibilityLabel={`通知時刻を${hour}時にする`}
                                    onPress={() => setHabitReminderHour(hour)}
                                    style={[styles.timeChip, habitReminderHour === hour && styles.timeChipActive]}
                                >
                                    <Text style={[styles.timeChipText, habitReminderHour === hour && styles.timeChipTextActive]}>
                                        {hour}:00
                                    </Text>
                                </Pressable>
                            ))}
                        </View>
                    </Card>

                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="使い方を見る"
                        onPress={() => router.push('/help')}
                        style={({ pressed }) => [styles.helpCard, pressed && styles.muted]}
                    >
                        <View style={styles.helpCardText}>
                            <Text style={styles.sectionTitle}>使い方</Text>
                            <Text style={styles.hint}>タスク、習慣、バトル、通知の説明を確認できます</Text>
                        </View>
                        <Text style={styles.helpCardChevron}>›</Text>
                    </Pressable>

                    {currentEmail && pendingContent && (
                        <Card title="クラウド統合の確認" styles={styles}>
                            <Text style={styles.hint}>
                                この端末にはクラウドに無いデータがあります（タスク{pendingContent.tasks.length}件・習慣{pendingContent.habits.length}件）。
                            </Text>
                            <View style={styles.formActions}>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="この端末のデータをクラウドへ統合する"
                                    disabled={busy}
                                    onPress={handleImportContent}
                                    style={({ pressed }) => [styles.primaryButton, (busy || pressed) && styles.muted]}
                                >
                                    <Text style={styles.primaryButtonText}>統合する</Text>
                                </Pressable>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel="統合を後で行う"
                                    disabled={busy}
                                    onPress={() => setPendingContent(null)}
                                    style={({ pressed }) => [styles.secondaryButton, (busy || pressed) && styles.muted]}
                                >
                                    <Text style={styles.secondaryButtonText}>後で</Text>
                                </Pressable>
                            </View>
                            {importMessage && <Text style={styles.bodyText}>{importMessage}</Text>}
                        </Card>
                    )}

                    <Card title="データ管理" styles={styles}>
                        <View style={styles.metricGrid}>
                            <Metric label="保存容量" value={storageSummary.loading ? '確認中' : formatBytes(storageSummary.bytes)} styles={styles} />
                            <Metric label="保存キー" value={`${storageSummary.appKeyCount}`} styles={styles} />
                            <Metric label="クラウド関連" value={`${storageSummary.cloudKeyCount}`} styles={styles} />
                        </View>
                    </Card>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

function Card({ title, styles, children }: { title: string; styles: ReturnType<typeof createStyles>; children: ReactNode }) {
    return (
        <View style={styles.card}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {children}
        </View>
    );
}

function SegmentedControl<T extends string>({
    options,
    value,
    onChange,
    styles,
}: {
    options: readonly { mode: T; label: string }[];
    value: T;
    onChange: (value: T) => void;
    styles: ReturnType<typeof createStyles>;
}) {
    return (
        <View style={styles.segmented}>
            {options.map((option) => {
                const active = value === option.mode;
                return (
                    <Pressable
                        key={option.mode}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`${option.label}を選択`}
                        onPress={() => onChange(option.mode)}
                        style={[styles.segment, active && styles.segmentActive]}
                    >
                        <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{option.label}</Text>
                    </Pressable>
                );
            })}
        </View>
    );
}

function Metric({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) {
    return (
        <View style={styles.metric}>
            <Text style={styles.metricLabel}>{label}</Text>
            <Text style={styles.metricValue}>{value}</Text>
        </View>
    );
}

function createStyles(palette: ThemePalette) {
    return StyleSheet.create({
        safeArea: { flex: 1, backgroundColor: palette.bg.primary },
        scroll: { paddingBottom: 32 },
        header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 },
        backButton: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg.card, borderWidth: 1, borderColor: palette.border.default },
        backSymbol: { color: palette.text.secondary, fontSize: 20 },
        title: { color: palette.text.primary, fontSize: 24, fontWeight: '800' },
        stack: { width: '100%', maxWidth: 640, alignSelf: 'center', gap: 12 },
        card: { marginHorizontal: 20, backgroundColor: palette.bg.card, borderColor: palette.border.default, borderWidth: 1, borderRadius: 10, padding: 16, gap: 10 },
        helpCard: { marginHorizontal: 20, backgroundColor: palette.bg.card, borderColor: palette.border.default, borderWidth: 1, borderRadius: 10, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
        helpCardText: { flex: 1, gap: 4 },
        helpCardChevron: { color: palette.text.muted, fontSize: 22, lineHeight: 22 },
        sectionTitle: { color: palette.text.primary, fontSize: 15, fontWeight: '800' },
        hint: { color: palette.text.muted, fontSize: 12, lineHeight: 17 },
        mutedText: { color: palette.text.muted, fontSize: 13 },
        bodyText: { color: palette.text.secondary, fontSize: 14 },
        loggedIn: { gap: 10 },
        form: { gap: 8 },
        input: { height: 44, borderRadius: 8, paddingHorizontal: 12, color: palette.text.primary, backgroundColor: palette.bg.secondary, borderWidth: 1, borderColor: palette.border.default, fontSize: 14 },
        formActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 14 },
        primaryButton: { height: 40, paddingHorizontal: 18, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.accent.primary },
        primaryButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
        secondaryButton: { alignSelf: 'flex-start', height: 38, paddingHorizontal: 14, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg.secondary, borderWidth: 1, borderColor: palette.border.default },
        secondaryButtonText: { color: palette.text.primary, fontSize: 13, fontWeight: '700' },
        deleteLink: { alignSelf: 'flex-start', paddingVertical: 4 },
        deleteLinkText: { color: palette.text.danger, fontSize: 12, fontWeight: '700' },
        deletePanel: { gap: 8, borderTopWidth: 1, borderColor: palette.border.default, paddingTop: 12 },
        deleteButton: { height: 40, paddingHorizontal: 18, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.text.danger },
        syncButton: { minHeight: 44, alignSelf: 'flex-start', paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg.secondary, borderWidth: 1, borderColor: palette.border.default },
        syncButtonText: { color: palette.accent.primary, fontSize: 13, fontWeight: '800' },
        syncWarning: { color: palette.text.danger },
        linkText: { color: palette.text.muted, fontSize: 12, textDecorationLine: 'underline' },
        message: { color: palette.text.secondary, fontSize: 12 },
        muted: { opacity: 0.45 },
        segmented: { flexDirection: 'row', backgroundColor: palette.bg.secondary, borderRadius: 8, padding: 2 },
        segment: { flex: 1, minHeight: 36, borderRadius: 7, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
        segmentActive: { backgroundColor: palette.accent.primary },
        segmentText: { color: palette.text.muted, fontSize: 12, fontWeight: '800' },
        segmentTextActive: { color: '#ffffff' },
        rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
        rowText: { gap: 2 },
        chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
        timeChip: { height: 34, minWidth: 64, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg.secondary, borderWidth: 1, borderColor: palette.border.default },
        timeChipActive: { borderColor: palette.border.active, backgroundColor: palette.bg.cardHover },
        timeChipText: { color: palette.text.muted, fontSize: 12, fontWeight: '800' },
        timeChipTextActive: { color: palette.text.primary },
        metricGrid: { flexDirection: 'row', gap: 8 },
        metric: { flex: 1, minHeight: 64, borderRadius: 8, backgroundColor: palette.bg.secondary, borderWidth: 1, borderColor: palette.border.default, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 6 },
        metricLabel: { color: palette.text.muted, fontSize: 10, fontWeight: '700' },
        metricValue: { color: palette.text.primary, fontSize: 14, fontWeight: '800', marginTop: 4 },
    });
}
