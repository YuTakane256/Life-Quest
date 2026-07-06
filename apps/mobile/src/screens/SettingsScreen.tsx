import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { getCurrentUser, signInWithEmail, signOutUser, signUpWithEmail } from '../platform/auth';
import {
    approveMobileContentImport,
    getPendingMobileContent,
    type PendingMobileContent,
} from '../platform/cloudMigration';
import { readMobileSupabaseEnv } from '../platform/supabase';
import { theme } from '../theme/colors';

type Mode = 'signIn' | 'signUp';

/**
 * 設定画面の最小版（#503: アカウントセクションのみ）。
 * テーマ・通知・データ管理などの本格的な設定は #508 で拡張する。
 */
export default function SettingsScreen() {
    const router = useRouter();
    const configured = readMobileSupabaseEnv() !== null;
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [mode, setMode] = useState<Mode>('signIn');
    const [currentEmail, setCurrentEmail] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [pendingContent, setPendingContent] = useState<PendingMobileContent | null>(null);
    const [importMessage, setImportMessage] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void getCurrentUser().then(async (user) => {
            if (cancelled) return;
            setCurrentEmail(user?.email ?? null);
            if (user) {
                // クラウドに存在しないこの端末のタスク・習慣を検出する（#506 フローB）
                const pending = await getPendingMobileContent(user.userId);
                if (!cancelled && (pending.tasks.length > 0 || pending.habits.length > 0)) {
                    setPendingContent(pending);
                }
            }
        });
        return () => { cancelled = true; };
    }, []);

    const handleImportContent = async () => {
        if (!pendingContent) return;
        setBusy(true);
        setImportMessage(null);
        const result = await approveMobileContentImport(pendingContent);
        if (result.status === 'imported') {
            setPendingContent(null);
            setImportMessage('この端末のデータをクラウドへ統合しました');
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
            const user = await getCurrentUser();
            setCurrentEmail(user?.email ?? null);
            setMessage(mode === 'signIn' ? 'ログインしました' : '登録しました');
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

    return (
        <SafeAreaView style={styles.safeArea}>
            <ScrollView contentContainerStyle={styles.scroll}>
                <View style={styles.header}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="戻る"
                        onPress={() => router.back()}
                        style={styles.backButton}
                        hitSlop={8}
                    >
                        <Text style={styles.backSymbol}>←</Text>
                    </Pressable>
                    <Text style={styles.title}>設定</Text>
                </View>

                {currentEmail && pendingContent && (
                    <View style={styles.card}>
                        <Text style={styles.sectionTitle}>クラウド統合の確認</Text>
                        <Text style={styles.hint}>
                            この端末にはクラウドに無いデータがあります（タスク{pendingContent.tasks.length}件・習慣{pendingContent.habits.length}件）。
                            統合するとWebと共有されます。統合しない場合もこの端末のバックアップには残ります。
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
                    </View>
                )}

                {!currentEmail && importMessage && null}

                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>アカウント</Text>
                    <Text style={styles.hint}>
                        ログインするとWebとモバイルでデータを同期できるようになります（同期機能は準備中）
                    </Text>

                    {!configured ? (
                        <Text style={styles.mutedText}>
                            クラウド接続は未設定です。これまでどおり端末内のみで動作します。
                        </Text>
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
                        </View>
                    ) : (
                        <View style={styles.form}>
                            <TextInput
                                value={email}
                                onChangeText={setEmail}
                                placeholder="メールアドレス"
                                placeholderTextColor={theme.text.muted}
                                autoCapitalize="none"
                                keyboardType="email-address"
                                accessibilityLabel="メールアドレス"
                                style={styles.input}
                            />
                            <TextInput
                                value={password}
                                onChangeText={setPassword}
                                placeholder="パスワード（6文字以上）"
                                placeholderTextColor={theme.text.muted}
                                secureTextEntry
                                accessibilityLabel="パスワード"
                                style={styles.input}
                            />
                            <View style={styles.formActions}>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={mode === 'signIn' ? 'ログインする' : '新規登録する'}
                                    disabled={busy || !email.trim() || password.length < 6}
                                    onPress={handleSubmit}
                                    style={({ pressed }) => [
                                        styles.primaryButton,
                                        (busy || !email.trim() || password.length < 6 || pressed) && styles.muted,
                                    ]}
                                >
                                    <Text style={styles.primaryButtonText}>{mode === 'signIn' ? 'ログイン' : '新規登録'}</Text>
                                </Pressable>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={mode === 'signIn' ? '新規登録へ切り替える' : 'ログインへ切り替える'}
                                    onPress={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}
                                    hitSlop={8}
                                >
                                    <Text style={styles.linkText}>{mode === 'signIn' ? 'アカウントを作る' : 'ログインへ戻る'}</Text>
                                </Pressable>
                            </View>
                        </View>
                    )}

                    {message && <Text accessibilityRole="alert" style={styles.message}>{message}</Text>}
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: theme.bg.primary },
    scroll: { paddingBottom: 32 },
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 },
    backButton: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg.card, borderWidth: 1, borderColor: theme.border.default },
    backSymbol: { color: theme.text.secondary, fontSize: 20 },
    title: { color: theme.text.primary, fontSize: 24, fontWeight: '800' },
    card: { marginHorizontal: 20, backgroundColor: theme.bg.card, borderColor: theme.border.default, borderWidth: 1, borderRadius: 10, padding: 16, gap: 10 },
    sectionTitle: { color: theme.text.primary, fontSize: 15, fontWeight: '800' },
    hint: { color: theme.text.muted, fontSize: 12, lineHeight: 17 },
    mutedText: { color: theme.text.muted, fontSize: 13 },
    bodyText: { color: theme.text.secondary, fontSize: 14 },
    loggedIn: { gap: 10 },
    form: { gap: 8 },
    input: { height: 44, borderRadius: 8, paddingHorizontal: 12, color: theme.text.primary, backgroundColor: theme.bg.secondary, borderWidth: 1, borderColor: theme.border.default, fontSize: 14 },
    formActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    primaryButton: { height: 40, paddingHorizontal: 18, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.accent.primary },
    primaryButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
    secondaryButton: { alignSelf: 'flex-start', height: 38, paddingHorizontal: 14, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg.secondary, borderWidth: 1, borderColor: theme.border.default },
    secondaryButtonText: { color: theme.text.primary, fontSize: 13, fontWeight: '700' },
    linkText: { color: theme.text.muted, fontSize: 12, textDecorationLine: 'underline' },
    message: { color: theme.text.secondary, fontSize: 12 },
    muted: { opacity: 0.45 },
});
