/**
 * Mobile版ログインボーナス演出。Web `src/components/ui/LoginBonusOverlay.tsx`の
 * 情報階層（連続ログイン日数・獲得XP・特別報酬）をReact Native向けに再現する。
 */
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ThemePalette } from '@life-quest/core/designTokens';
import { useMobileLoginBonusStore } from '../stores/useMobileLoginBonusStore';
import { usePalette } from '../theme/usePalette';
import { useRewardEventTimers } from '../hooks/useRewardEventTimers';

const getPendingBonus = () => useMobileLoginBonusStore.getState().pendingBonus;

export function LoginBonusOverlay() {
    const pendingBonus = useMobileLoginBonusStore((state) => state.pendingBonus);
    const clearPendingBonus = useMobileLoginBonusStore((state) => state.clearPendingBonus);
    const claimMessage = useMobileLoginBonusStore((state) => state.claimMessage);
    const claimStatus = useMobileLoginBonusStore((state) => state.claimStatus);
    const retryDailyLogin = useMobileLoginBonusStore((state) => state.retryDailyLogin);
    const { palette } = usePalette();
    const styles = createStyles(palette);
    const { active, isCurrent } = useRewardEventTimers(pendingBonus, getPendingBonus);
    const dismiss = () => { if (isCurrent()) clearPendingBonus(); };

    const retryable = claimStatus === 'retryable-error' || claimStatus === 'unavailable' || claimStatus === 'rejected';
    const banner = claimMessage ? (
        <View style={styles.banner}>
            <Text style={styles.bannerText}>{claimMessage}</Text>
            {retryable && (
                <Pressable accessibilityRole="button" onPress={() => void retryDailyLogin()} hitSlop={8}>
                    <Text style={styles.retry}>再試行</Text>
                </Pressable>
            )}
        </View>
    ) : null;

    if (!pendingBonus || !active) return banner;

    return (
        <>
            {banner}
            <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
                <Pressable accessible={false} style={styles.backdrop} onPress={dismiss}>
                    <Pressable accessible={false} style={styles.card} onPress={(event) => event.stopPropagation()}>
                    <Text style={styles.title}>ログインボーナス</Text>
                    <Text style={styles.streak}>連続ログイン{pendingBonus.streak}日目</Text>

                    <View style={styles.row}>
                        <Text style={styles.rowLabel}>⭐ 経験値</Text>
                        <Text style={styles.rowValueXp}>+{pendingBonus.xp} XP</Text>
                    </View>

                    {pendingBonus.chestLabel && (
                        <View style={styles.row}>
                            <Text style={styles.rowLabel}>🎁 特別報酬</Text>
                            <Text style={styles.rowValueChest}>{pendingBonus.chestLabel}</Text>
                        </View>
                    )}

                    <Pressable accessibilityRole="button" accessibilityLabel="ログインボーナスを閉じる" onPress={dismiss} style={styles.dismiss}>
                        <Text style={styles.hint}>タップして閉じる</Text>
                    </Pressable>
                    </Pressable>
                </Pressable>
            </Modal>
        </>
    );
}

function createStyles(palette: ThemePalette) {
    return StyleSheet.create({
        backdrop: {
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 24,
        },
        card: {
            width: '100%',
            maxWidth: 360,
            borderRadius: 20,
            borderWidth: 2,
            borderColor: palette.accent.gold,
            backgroundColor: palette.bg.card,
            paddingHorizontal: 28,
            paddingVertical: 32,
            alignItems: 'center',
            gap: 10,
        },
        title: { color: palette.accent.gold, fontSize: 24, fontWeight: '800' },
        streak: { color: palette.text.secondary, fontSize: 15, marginBottom: 8 },
        row: {
            width: '100%',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: palette.bg.secondary,
            borderRadius: 12,
            paddingHorizontal: 16,
            paddingVertical: 10,
        },
        rowLabel: { color: palette.text.secondary, fontSize: 13 },
        rowValueXp: { color: palette.accent.emerald, fontSize: 15, fontWeight: '800' },
        rowValueChest: { color: palette.accent.gold, fontSize: 13, fontWeight: '800', textAlign: 'right', flexShrink: 1 },
        dismiss: { alignSelf: 'stretch', minHeight: 44, alignItems: 'center', justifyContent: 'center',
            marginTop: 12, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, backgroundColor: palette.bg.secondary },
        hint: { color: palette.text.secondary, fontSize: 13 },
        banner: {
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: 84,
            zIndex: 20,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            borderWidth: 1,
            borderColor: palette.border.default,
            borderRadius: 8,
            backgroundColor: palette.bg.card,
            paddingHorizontal: 12,
            paddingVertical: 10,
        },
        bannerText: { color: palette.text.secondary, flex: 1, fontSize: 12 },
        retry: { color: palette.accent.primary, fontSize: 12, fontWeight: '800' },
    });
}
