import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { startMobileCanonicalSync } from '../src/platform/canonicalSync';
import { startRewardSync } from '../src/stores/rewardSync';
import { theme } from '../src/theme/colors';

export default function RootLayout() {
    // 各ストアのhydration完了後に、完了済みタスク・習慣と報酬台帳を再照合する。
    // 保存失敗やクラッシュで報酬だけ失われた場合もここで回復する。
    useEffect(() => startRewardSync(), []);

    // 旧quest-board-*データのcanonical移行と、以降のストア変更の書き戻しを開始する。
    useEffect(() => {
        const sync = startMobileCanonicalSync();
        return sync.stop;
    }, []);

    return (
        <>
            <StatusBar style="light" />
            <Stack screenOptions={{ contentStyle: { backgroundColor: theme.bg.primary } }}>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            </Stack>
        </>
    );
}
