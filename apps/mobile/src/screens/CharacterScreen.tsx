import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LAYOUT_TOKENS } from '@life-quest/core/designTokens';
import { TAB_SCREEN_EDGES } from '../theme/layout';
import { CharacterOverview } from '../components/CharacterOverview';
import { CharacterLevelUpNotice } from '../components/CharacterLevelUpNotice';
import { ChestAcquisitionHistory } from '../components/ChestAcquisitionHistory';
import { InventorySection } from '../components/InventorySection';
import { useCloudChestOpen } from '../hooks/useCloudChestOpen';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { usePalette } from '../theme/usePalette';

export default function CharacterScreen() {
    const hasHydrated = useMobileGameStore((state) => state.hasHydrated);
    const { openingChestId, errorChestId, openChest, retry } = useCloudChestOpen();
    const { palette } = usePalette();
    if (!hasHydrated) return <SafeAreaView edges={TAB_SCREEN_EDGES} style={{ flex: 1, backgroundColor: palette.bg.primary }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: palette.text.muted }}>保存データを読み込み中…</Text></View>
    </SafeAreaView>;
    return <SafeAreaView edges={TAB_SCREEN_EDGES} style={{ flex: 1, backgroundColor: palette.bg.primary }}>
        <ScrollView contentContainerStyle={{ width: '100%', maxWidth: LAYOUT_TOKENS.page.maxWidth, alignSelf: 'center', paddingHorizontal: LAYOUT_TOKENS.page.detailHorizontal, paddingTop: LAYOUT_TOKENS.page.top, paddingBottom: 32, gap: 14 }}>
            <CharacterLevelUpNotice />
            <CharacterOverview openingChestId={openingChestId} errorChestId={errorChestId}
                onOpenChest={(id) => { void openChest(id); }} onRetryChest={() => { void retry(); }} />
            <InventorySection embedded />
            <ChestAcquisitionHistory />
        </ScrollView>
    </SafeAreaView>;
}
