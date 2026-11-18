import { useSyncExternalStore } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getPasswordRecoveryState, subscribePasswordRecoveryState } from '../platform/auth';
import { getMobileCloudRecoveryState, subscribeMobileCloudRecovery } from '../platform/cloudSessionRecovery';
import {
    getSecureSessionStorageState, retrySecureSessionStorage, subscribeSecureSessionStorage,
} from '../platform/secureSessionStorage';
import SettingsScreen from '../screens/SettingsScreen';
import { usePalette } from '../theme/usePalette';

/** A native modal also blocks tabs, gestures and the accessibility tree underneath. */
export function CloudSessionRecoveryGate() {
    const state = useSyncExternalStore(subscribeMobileCloudRecovery, getMobileCloudRecoveryState);
    const passwordRecovery = useSyncExternalStore(subscribePasswordRecoveryState, getPasswordRecoveryState);
    const storage = useSyncExternalStore(subscribeSecureSessionStorage, getSecureSessionStorageState);
    const { palette } = usePalette();

    if (storage !== 'ready') {
        return <Modal visible animationType="none" onRequestClose={() => {}}>
            <ScrollView contentContainerStyle={[styles.storage, { backgroundColor: palette.bg.primary }]}>
                <Text accessibilityRole="header" style={[styles.title, { color: palette.text.primary }]}>
                    ログイン情報を確認できません
                </Text>
                <Text accessibilityRole="alert" style={[styles.message, { color: palette.text.secondary }]}>
                    端末の安全な保存領域を読み込めませんでした。保存データを保持しています。端末のロックを解除して、もう一度お試しください。
                </Text>
                {storage === 'retrying'
                    ? <View style={styles.waiting}>
                        <ActivityIndicator />
                        <Text style={{ color: palette.text.secondary }}>ログイン情報を再確認しています</Text>
                    </View>
                    : <Pressable accessibilityRole="button" accessibilityLabel="ログイン情報を再確認する"
                        onPress={retrySecureSessionStorage}
                        style={[styles.retry, { backgroundColor: palette.accent.primary }]}>
                        <Text style={styles.retryText}>再確認する</Text>
                    </Pressable>}
            </ScrollView>
        </Modal>;
    }

    return <Modal visible={state !== 'ready'} animationType="none" onRequestClose={() => {}}>
        {state === 'checking' && passwordRecovery === 'idle'
            ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                <ActivityIndicator /><Text>アカウントを確認しています</Text>
            </View>
            : state !== 'ready' && <SettingsScreen recoveryOnly />}
    </Modal>;
}

const styles = StyleSheet.create({
    storage: { flexGrow: 1, justifyContent: 'center', gap: 20, paddingHorizontal: 24, paddingVertical: 60 },
    title: { fontSize: 22, fontWeight: '700' },
    message: { fontSize: 16 },
    retry: { minHeight: 44, padding: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
    retryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    waiting: { alignItems: 'center', gap: 12 },
});
