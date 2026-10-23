import { Image, ScrollView, Text, View } from 'react-native';
import { History } from 'lucide-react-native';
import { getChestImage } from '../assets/images';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { usePalette } from '../theme/usePalette';

/** Read only the awarded snapshot, not today's inventory (which may have been sold or synthesized). */
export function ChestAcquisitionHistory() {
    const chestQueue = useMobileGameStore((state) => state.chestQueue);
    const { palette: p } = usePalette();
    // Match Web's reverse queue order; do not reverse the persisted array itself.
    const opened = chestQueue.filter((chest) => chest.opened).reverse();
    if (!opened.length) return null;

    return <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 }}>
            <History size={18} color={p.text.primary} accessible={false} />
            <Text accessibilityRole="header" style={{ flex: 1, fontSize: 16, fontWeight: '600', color: p.text.primary }}>
                獲得履歴 ({opened.length})
            </Text>
        </View>
        <ScrollView testID="chest-acquisition-history" nestedScrollEnabled
            style={{ maxHeight: 320, borderRadius: 12, borderWidth: 1, borderColor: p.border.default, backgroundColor: p.bg.card }}>
            {opened.map((chest, index) => {
                const result = chest.equipment?.name ?? (chest.isStarterCharacter ? 'キャラクター獲得' : '—');
                const color = chest.equipment ? p.rarity[chest.equipment.rarity] : chest.isStarterCharacter ? p.accent.primary : p.text.muted;
                return <View key={chest.id} accessible accessibilityLabel={`${chest.label}、${result}`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10,
                        borderTopWidth: index === 0 ? 0 : 1, borderTopColor: p.border.default }}>
                    <Image source={getChestImage(chest.chestType) ?? getChestImage('wood')!} accessible={false}
                        resizeMode="contain" style={{ width: 32, height: 32 }} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ fontSize: 11, color: p.text.muted }}>{chest.label}</Text>
                        <Text style={{ fontSize: 14, fontWeight: '500', color }}>{result}</Text>
                    </View>
                </View>;
            })}
        </ScrollView>
    </View>;
}
