import { Alert, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useMobileLoginBonusStore } from '../stores/useMobileLoginBonusStore';
import { usePalette } from '../theme/usePalette';

export function LoginBonusNotice() {
    const message = useMobileLoginBonusStore((state) => state.claimMessage);
    const status = useMobileLoginBonusStore((state) => state.claimStatus);
    const retryDailyLogin = useMobileLoginBonusStore((state) => state.retryDailyLogin);
    const { palette } = usePalette();
    const { fontScale } = useWindowDimensions();

    if (!message) return null;

    const retryable = status === 'retryable-error' || status === 'unavailable' || status === 'rejected';
    const retry = () => { void retryDailyLogin(); };
    const showDetails = () => Alert.alert('ログインボーナス', message, retryable
        ? [{ text: '閉じる', style: 'cancel' }, { text: '再試行', onPress: retry }]
        : [{ text: '閉じる' }]);

    const colors = { backgroundColor: palette.bg.card, borderColor: palette.border.default };
    // Keep long, scaled errors from taking over the tab screen on small devices.
    if (fontScale >= 2) {
        return (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="ログインボーナスの通知を確認"
                onPress={showDetails}
                style={[styles.notice, styles.compact, colors]}
            >
                <Text style={[styles.actionText, { color: palette.accent.primary }]}>ログインボーナス</Text>
            </Pressable>
        );
    }

    return (
        <View style={[styles.notice, styles.row, colors]}>
            <Text accessibilityLiveRegion="polite" style={[styles.message, { color: palette.text.secondary }]}>{message}</Text>
            {retryable && (
                <Pressable accessibilityRole="button" onPress={retry} style={styles.button}>
                    <Text style={[styles.actionText, { color: palette.accent.primary }]}>再試行</Text>
                </Pressable>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    notice: {
        marginHorizontal: 16,
        marginVertical: 4,
        borderWidth: 1,
        borderRadius: 8,
        paddingVertical: 4,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 12 },
    compact: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, marginBottom: 10 },
    message: { flex: 1, fontSize: 12 },
    button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
    actionText: { fontSize: 12, fontWeight: '800', textAlign: 'center' },
});
