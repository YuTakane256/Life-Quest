import { useRef } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LAYOUT_TOKENS } from '@life-quest/core/designTokens';
import { TAB_SCREEN_EDGES } from '../theme/layout';
import { CharacterOverview } from '../components/CharacterOverview';
import { CharacterLevelUpNotice } from '../components/CharacterLevelUpNotice';
import { ChestAcquisitionHistory } from '../components/ChestAcquisitionHistory';
import { useCloudChestOpen } from '../hooks/useCloudChestOpen';
import { useInteractionScope } from '../hooks/useInteractionScope';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { usePalette } from '../theme/usePalette';

export default function CharacterScreen() {
    const router = useRouter();
    const hasHydrated = useMobileGameStore((state) => state.hasHydrated);
    const equipmentCount = useMobileGameStore((state) => state.equipment.length);
    const { openingChestId, errorChestId, openChest, retry } = useCloudChestOpen();
    const { palette } = usePalette();
    const navigating = useRef(false);
    const interactions = useInteractionScope(() => { navigating.current = false; });
    const isCurrent = interactions.capture();
    if (!hasHydrated) return <SafeAreaView edges={TAB_SCREEN_EDGES} style={{ flex: 1, backgroundColor: palette.bg.primary }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: palette.text.muted }}>保存データを読み込み中…</Text></View>
    </SafeAreaView>;
    return <SafeAreaView edges={TAB_SCREEN_EDGES} style={{ flex: 1, backgroundColor: palette.bg.primary }}>
        <ScrollView contentContainerStyle={{ width: '100%', maxWidth: LAYOUT_TOKENS.page.maxWidth, alignSelf: 'center', paddingHorizontal: LAYOUT_TOKENS.page.detailHorizontal, paddingTop: LAYOUT_TOKENS.page.top, paddingBottom: 32, gap: 14 }}>
            <CharacterLevelUpNotice />
            <CharacterOverview openingChestId={openingChestId} errorChestId={errorChestId}
                onOpenChest={(id) => { void openChest(id); }} onRetryChest={() => { void retry(); }} />
            <Pressable accessibilityRole="button" accessibilityLabel="インベントリを開く"
                onPress={() => {
                    if (isCurrent() && !navigating.current && useMobileGameStore.getState().hasHydrated) {
                        navigating.current = true;
                        router.push('/inventory');
                    }
                }}
                style={({ pressed }) => ({ minHeight: 44, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: palette.border.default, backgroundColor: palette.bg.card, opacity: pressed ? 0.6 : 1 })}>
                <Text style={{ color: palette.text.primary, fontSize: 15, fontWeight: '700' }}>インベントリを見る（{equipmentCount}） ›</Text>
                <Text style={{ color: palette.text.muted, fontSize: 12, marginTop: 4 }}>持ち物の装備・売却・合成</Text>
            </Pressable>
            <ChestAcquisitionHistory />
        </ScrollView>
    </SafeAreaView>;
}
