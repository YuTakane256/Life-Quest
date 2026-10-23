import { Pressable, Text, View } from 'react-native';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { usePalette } from '../theme/usePalette';

/** The same confirmed level-up event can be viewed from either character or inventory. */
export function CharacterLevelUpNotice() {
    const event = useMobileGameStore((state) => state.lastLevelUp);
    const clear = useMobileGameStore((state) => state.clearLastLevelUp);
    const { palette } = usePalette();
    if (!event) return null;
    return <View accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.bg.tertiary, borderColor: palette.accent.emerald, borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 }}>
        <Text style={{ flex: 1, color: palette.text.primary, fontSize: 13, fontWeight: '600', lineHeight: 19 }}>
            レベルアップ！ Lv.{event.fromLevel} → Lv.{event.toLevel}{'\n'}攻撃+{event.attackGain} / 防御+{event.defenseGain} / HP+{event.hpGain}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="レベルアップ通知を閉じる" onPress={clear}
            style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: palette.text.secondary, fontSize: 21, lineHeight: 23 }}>×</Text>
        </Pressable>
    </View>;
}
