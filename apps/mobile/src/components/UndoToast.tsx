/**
 * 画面下部の取消トースト（#512）。WebのshowUndoスナックバーに対応する。
 * 表示・非表示の制御は親（メッセージがnullなら非表示）。自動消滅も親が管理する。
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ThemePalette } from '@life-quest/core/designTokens';
import { usePalette } from '../theme/usePalette';

export interface UndoToastProps {
    message: string;
    actionLabel?: string;
    onAction: () => void;
}

export function UndoToast({ message, actionLabel = '取消', onAction }: UndoToastProps) {
    const { palette } = usePalette();
    const styles = createStyles(palette);
    return (
        <View style={styles.container} accessibilityRole="alert">
            <Text style={styles.message} numberOfLines={2}>{message}</Text>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${actionLabel}する`}
                onPress={onAction}
                hitSlop={8}
                style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            >
                <Text style={styles.actionText}>{actionLabel}</Text>
            </Pressable>
        </View>
    );
}

function createStyles(palette: ThemePalette) {
    return StyleSheet.create({
        container: {
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            backgroundColor: palette.bg.cardHover,
            borderColor: palette.border.default,
            borderWidth: 1,
            borderRadius: 10,
            paddingHorizontal: 14,
            paddingVertical: 12,
            shadowColor: '#000',
            shadowOpacity: 0.3,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 2 },
            elevation: 6,
        },
        message: { flex: 1, color: palette.text.primary, fontSize: 13, fontWeight: '600' },
        action: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: palette.accent.primary },
        pressed: { opacity: 0.7 },
        actionText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
    });
}
