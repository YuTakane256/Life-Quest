import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { startAuthSessionListener } from '../src/platform/auth';
import { registerMobileAuthStoreHooks } from '../src/platform/authStores';
import { registerMobileCloudMigrationHooks } from '../src/platform/cloudMigration';
import { registerPendingCompletionFlush } from '../src/platform/pendingCompletionFlush';
import { registerMobileCloudSyncHooks } from '../src/platform/cloudSync';
import { registerMobileOutboxHooks } from '../src/platform/cloudOutbox';
import { startMobileCanonicalSync } from '../src/platform/canonicalSync';
import { startRewardSync } from '../src/stores/rewardSync';
import { usePalette } from '../src/theme/usePalette';

export default function RootLayout() {
    const { palette, resolvedTheme } = usePalette();

    // 各ストアのhydration完了後に、完了済みタスク・習慣と報酬台帳を再照合する。
    // 保存失敗やクラッシュで報酬だけ失われた場合もここで回復する。
    useEffect(() => startRewardSync(), []);

    // 旧quest-board-*データのcanonical移行と、以降のストア変更の書き戻しを開始する。
    useEffect(() => {
        const sync = startMobileCanonicalSync();
        return sync.stop;
    }, []);

    // 認証ライフサイクル: ログアウト時のストア即時クリア（ADR-009、クラウドシード後のみ作動）と
    // 保存済みセッションの復元通知。Supabase未設定なら双方とも何もしない。
    useEffect(() => registerMobileAuthStoreHooks(), []);
    useEffect(() => registerMobileCloudMigrationHooks(), []); // バックアップはプル置換より先（#506）
    useEffect(() => registerMobileCloudSyncHooks(), []);
    useEffect(() => registerMobileOutboxHooks(), []);
    useEffect(() => registerPendingCompletionFlush(), []);
    useEffect(() => startAuthSessionListener(), []);

    return (
        <>
            <StatusBar style={resolvedTheme === 'light' ? 'dark' : 'light'} />
            <Stack screenOptions={{ contentStyle: { backgroundColor: palette.bg.primary } }}>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="settings" options={{ headerShown: false }} />
                <Stack.Screen name="help" options={{ headerShown: false }} />
            </Stack>
        </>
    );
}
