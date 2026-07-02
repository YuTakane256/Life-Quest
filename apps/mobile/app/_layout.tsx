import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { startRewardSync } from '../src/stores/rewardSync';

export default function RootLayout() {
    // 各ストアのhydration完了後に、完了済みタスク・習慣と報酬台帳を再照合する。
    // 保存失敗やクラッシュで報酬だけ失われた場合もここで回復する。
    useEffect(() => startRewardSync(), []);

    return (
        <>
            <StatusBar style="light" />
            <Stack screenOptions={{ contentStyle: { backgroundColor: '#0f1118' } }}>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            </Stack>
        </>
    );
}
