import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useMobileLoginBonusStore } from '../stores/useMobileLoginBonusStore';
import { usePalette } from '../theme/usePalette';

export function LoginBonusNotice() {
    const message = useMobileLoginBonusStore((state) => state.claimMessage);
    const status = useMobileLoginBonusStore((state) => state.claimStatus);
    const retryDailyLogin = useMobileLoginBonusStore((state) => state.retryDailyLogin);
    const { palette } = usePalette();

    if (!message) return null;

    const retryable = status === 'retryable-error' || status === 'unavailable' || status === 'rejected';
    return (
        <View style={[styles.notice, { backgroundColor: palette.bg.card, borderColor: palette.border.default }]}>
            <Text style={[styles.message, { color: palette.text.secondary }]}>{message}</Text>
            {retryable && (
                <Pressable accessibilityRole="button" onPress={() => void retryDailyLogin()} style={styles.button}>
                    <Text style={[styles.retry, { color: palette.accent.primary }]}>再試行</Text>
                </Pressable>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    notice: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginHorizontal: 16,
        marginVertical: 4,
        borderWidth: 1,
        borderRadius: 8,
        paddingLeft: 12,
        paddingVertical: 4,
    },
    message: { flex: 1, fontSize: 12 },
    button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12 },
    retry: { fontSize: 12, fontWeight: '800' },
});
