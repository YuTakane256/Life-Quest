import { useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LAYOUT_TOKENS, type ThemePalette } from '@life-quest/core/designTokens';
import { TAB_SCREEN_EDGES } from '../theme/layout';
import { type Equipment, type EquipmentSlot, type Rarity } from '@life-quest/core/equipment';
import { createInventoryConfirmation, filterAndSortInventory, type InventoryRarityFilter, type InventorySlotFilter, type InventorySortMode } from '@life-quest/core/inventory';
import { SELL_XP_BY_RARITY, SYNTHESIS_CONFIG } from '@life-quest/core/rewards';
import { getItemImage } from '../assets/images';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { CharacterOverview } from '../components/CharacterOverview';
import { usePalette } from '../theme/usePalette';
import { useCloudChestOpen } from '../hooks/useCloudChestOpen';
import { useCloudItemSynthesis } from '../hooks/useCloudItemSynthesis';
import { useInteractionScope } from '../hooks/useInteractionScope';

const RARITY_LABELS: Record<Rarity, string> = {
    common: 'コモン',
    uncommon: 'アンコモン',
    rare: 'レア',
    epic: 'エピック',
    legendary: 'レジェンダリー',
};

const SLOT_LABELS: Record<EquipmentSlot, string> = {
    weapon: '武器',
    armor: '防具',
    accessory: '装飾',
};

export default function CharacterScreen() {
    const equipment = useMobileGameStore((state) => state.equipment);
    const hasHydrated = useMobileGameStore((state) => state.hasHydrated);
    const lastLevelUp = useMobileGameStore((state) => state.lastLevelUp);
    const clearLastLevelUp = useMobileGameStore((state) => state.clearLastLevelUp);
    const { openingChestId, errorChestId, openChest, retry: retryOpenChest } = useCloudChestOpen();
    const equipItem = useMobileGameStore((state) => state.equipItem);
    const unequipItem = useMobileGameStore((state) => state.unequipItem);
    const sellItem = useMobileGameStore((state) => state.sellItem);
    const { isSynthesizing, hasError: synthHasError, synthesize, retry: retrySynthesize } = useCloudItemSynthesis();

    const { palette } = usePalette();
    const styles = useMemo(() => createStyles(palette), [palette]);
    const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
    const [lastReveal, setLastReveal] = useState<Equipment | null>(null);
    const [slotFilter, setSlotFilter] = useState<InventorySlotFilter>('all');
    const [rarityFilter, setRarityFilter] = useState<InventoryRarityFilter>('all');
    const [sortMode, setSortMode] = useState<InventorySortMode>('rarity');
    const pendingConfirmation = useRef<object | null>(null);
    const interactions = useInteractionScope(() => {
        pendingConfirmation.current = null; setSelectedIds([]); setLastReveal(null);
    });

    // 最大2000件になり得るため FlatList で仮想化して描画する
    const inventory = useMemo(
        () => filterAndSortInventory(equipment, { slotFilter, rarityFilter, sortMode, slotLabels: SLOT_LABELS }),
        [equipment, slotFilter, rarityFilter, sortMode],
    );

    const selectedItems = inventory.filter((item) => selectedIds.includes(item.id));
    const canSynthesize = selectedItems.length === SYNTHESIS_CONFIG.REQUIRED_COUNT
        && selectedItems.every((item) => !item.equipped && item.rarity === selectedItems[0].rarity)
        && selectedItems[0].rarity !== 'legendary';

    const toggleSelect = (item: Equipment) => {
        if (!interactions.capture()()) return;
        if (item.equipped) return;
        setSelectedIds((current) => current.includes(item.id)
            ? current.filter((id) => id !== item.id)
            : [...current, item.id]);
    };

    // The store publishes a presentation event only after a confirmed open, including retries.
    const handleOpenChest = (chestId: string) => { void openChest(chestId); };

    const handleSell = (item: Equipment) => {
        const isCurrent = interactions.capture();
        if (!isCurrent()) return;
        const token = {};
        pendingConfirmation.current = token;
        const confirm = createInventoryConfirmation([item], () => useMobileGameStore.getState().equipment,
            () => isCurrent() && pendingConfirmation.current === token, () => {
                setSelectedIds((current) => current.filter((id) => id !== item.id));
                sellItem(item.id);
            });
        Alert.alert(
            '装備を売却',
            `「${item.name}」を売却して ${SELL_XP_BY_RARITY[item.rarity]} XP を獲得します。よろしいですか？`,
            [
                { text: 'キャンセル', style: 'cancel', onPress: () => { if (pendingConfirmation.current === token) pendingConfirmation.current = null; } },
                {
                    text: '売却する',
                    style: 'destructive',
                    onPress: confirm,
                },
            ],
        );
    };

    const runSynthesis = (invoke: () => Promise<Equipment | null>) => {
        const isCurrent = interactions.capture();
        if (!isCurrent()) return;
        void invoke().then((result) => { if (isCurrent() && result) setLastReveal({ ...result }); });
    };

    const handleSynthesize = () => {
        if (!canSynthesize) return;
        const isCurrent = interactions.capture();
        if (!isCurrent()) return;
        const token = {};
        pendingConfirmation.current = token;
        // Only the visible, approved three items are consumed; hidden stale IDs cannot join.
        const ingredientIds = selectedItems.map((item) => item.id);
        const confirm = createInventoryConfirmation(selectedItems, () => useMobileGameStore.getState().equipment,
            () => isCurrent() && pendingConfirmation.current === token, () => {
                setSelectedIds([]);
                runSynthesis(() => synthesize(ingredientIds));
            });
        Alert.alert(
            '装備を合成',
            `選択した${SYNTHESIS_CONFIG.REQUIRED_COUNT}個を消費して、1つ上のレアリティの装備を生成します。よろしいですか？`,
            [
                { text: 'キャンセル', style: 'cancel', onPress: () => { if (pendingConfirmation.current === token) pendingConfirmation.current = null; } },
                {
                    text: '合成する',
                    onPress: confirm,
                },
            ],
        );
    };

    if (!hasHydrated) {
        return (
            <SafeAreaView edges={TAB_SCREEN_EDGES} style={styles.safeArea}>
                <View style={styles.loading}>
                    <Text style={styles.loadingText}>保存データを読み込み中…</Text>
                </View>
            </SafeAreaView>
        );
    }

    const listHeader = (
        <View style={styles.headerContent}>
            {lastLevelUp && (
                <View style={styles.banner} accessibilityRole="alert">
                    <Text style={styles.bannerText}>
                        レベルアップ！ Lv.{lastLevelUp.fromLevel} → Lv.{lastLevelUp.toLevel}
                        {'\n'}攻撃+{lastLevelUp.attackGain} / 防御+{lastLevelUp.defenseGain} / HP+{lastLevelUp.hpGain}
                    </Text>
                    <Pressable accessibilityRole="button" accessibilityLabel="レベルアップ通知を閉じる" onPress={clearLastLevelUp} hitSlop={10}>
                        <Text style={styles.bannerClose}>×</Text>
                    </Pressable>
                </View>
            )}
            {lastReveal && (
                <View style={styles.banner} accessibilityRole="alert">
                    <Text style={styles.bannerText}>{`合成で「${lastReveal.name}」が誕生！`}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel="入手通知を閉じる" onPress={() => setLastReveal((current) => current === lastReveal ? null : current)} hitSlop={10}>
                        <Text style={styles.bannerClose}>×</Text>
                    </Pressable>
                </View>
            )}

            <CharacterOverview
                openingChestId={openingChestId}
                errorChestId={errorChestId}
                onOpenChest={handleOpenChest}
                onRetryChest={() => void retryOpenChest()}
            />

            {/* インベントリフィルタ・ソート（Web InventorySectionと同一の選択肢） */}
            <View style={styles.filterRow}>
                <FilterSelect
                    label="種類"
                    value={slotFilter}
                    options={[['all', 'すべて'], ['weapon', '武器'], ['armor', '防具'], ['accessory', '装飾']]}
                    onChange={(value) => setSlotFilter(value as InventorySlotFilter)}
                    styles={styles}
                />
                <FilterSelect
                    label="レア"
                    value={rarityFilter}
                    options={[['all', 'すべて'], ...Object.entries(RARITY_LABELS) as [string, string][]]}
                    onChange={(value) => setRarityFilter(value as InventoryRarityFilter)}
                    styles={styles}
                />
                <FilterSelect
                    label="並び"
                    value={sortMode}
                    options={[['rarity', 'レア順'], ['slot', '種類順'], ['name', '名前順']]}
                    onChange={(value) => setSortMode(value as InventorySortMode)}
                    styles={styles}
                />
            </View>

            {/* インベントリ見出し（行自体はFlatListが仮想化して描画する） */}
            <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>インベントリ（{inventory.length}）</Text>
                <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !canSynthesize || isSynthesizing }}
                    accessibilityLabel={`選択した${SYNTHESIS_CONFIG.REQUIRED_COUNT}個の装備を合成する`}
                    disabled={!canSynthesize || isSynthesizing}
                    onPress={handleSynthesize}
                    style={({ pressed }) => [styles.secondaryButton, (!canSynthesize || isSynthesizing || pressed) && styles.muted]}
                >
                    <Text style={styles.secondaryButtonText}>
                        {isSynthesizing ? '合成中…' : `合成（${selectedItems.length}/${SYNTHESIS_CONFIG.REQUIRED_COUNT}）`}
                    </Text>
                </Pressable>
            </View>
            <Text style={styles.hint}>同じレアリティの未装備品{SYNTHESIS_CONFIG.REQUIRED_COUNT}個を選ぶと上位レアリティへ合成できます。</Text>
            {synthHasError && (
                <View style={styles.sectionHeader}>
                    <Text style={styles.dangerButtonText}>合成の同期に失敗しました。</Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="装備合成を再送する"
                        onPress={() => runSynthesis(retrySynthesize)}
                        style={({ pressed }) => [styles.dangerButton, pressed && styles.muted]}
                    >
                        <Text style={styles.dangerButtonText}>再送</Text>
                    </Pressable>
                </View>
            )}
        </View>
    );

    return (
        <SafeAreaView edges={TAB_SCREEN_EDGES} style={styles.safeArea}>
            <FlatList
                data={inventory}
                keyExtractor={(item) => item.id}
                ListHeaderComponent={listHeader}
                ListEmptyComponent={
                    <Text style={styles.emptyText}>装備はまだありません。タスクを達成して宝箱を集めましょう。</Text>
                }
                renderItem={({ item }) => (
                    <InventoryRow
                        item={item}
                        selected={selectedIds.includes(item.id)}
                        onToggleSelect={toggleSelect}
                        onEquipToggle={(target) => target.equipped ? unequipItem(target.id) : equipItem(target.id)}
                        onSell={handleSell}
                        styles={styles}
                        palette={palette}
                    />
                )}
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
            />
        </SafeAreaView>
    );
}

/** 装備アイコン（レアリティ色の枠）。未知のtemplate_idはプレースホルダー。 */
function ItemIcon({ templateId, rarity, styles, palette }: { templateId: string; rarity: Rarity; styles: Styles; palette: ThemePalette }) {
    const source = getItemImage(templateId);
    if (!source) {
        return (
            <View style={[styles.itemIcon, styles.imageFallback, { borderColor: palette.rarity[rarity] }]}>
                <Text style={styles.imageFallbackText}>?</Text>
            </View>
        );
    }
    return <Image source={source} style={[styles.itemIcon, { borderColor: palette.rarity[rarity] }]} />;
}

function InventoryRow({
    item,
    selected,
    onToggleSelect,
    onEquipToggle,
    onSell,
    styles,
    palette,
}: {
    item: Equipment;
    selected: boolean;
    onToggleSelect: (item: Equipment) => void;
    onEquipToggle: (item: Equipment) => void;
    onSell: (item: Equipment) => void;
    styles: Styles;
    palette: ThemePalette;
}) {
    return (
        <View style={[styles.itemRow, selected && styles.itemRowSelected]}>
            <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected, disabled: item.equipped }}
                accessibilityLabel={`${item.name}を合成素材に${selected ? '選択解除' : '選択'}する`}
                disabled={item.equipped}
                onPress={() => onToggleSelect(item)}
                style={[styles.selectBox, selected && styles.selectBoxActive, item.equipped && styles.muted]}
                hitSlop={6}
            >
                {selected && <Text style={styles.selectMark}>✓</Text>}
            </Pressable>
            <ItemIcon templateId={item.templateId} rarity={item.rarity} styles={styles} palette={palette} />
            <View style={styles.flex}>
                <Text style={[styles.itemName, { color: palette.rarity[item.rarity] }]} numberOfLines={1}>
                    {item.name}{item.equipped ? '（装備中）' : ''}
                </Text>
                <Text style={styles.itemMeta}>
                    {RARITY_LABELS[item.rarity]} / {SLOT_LABELS[item.slot]}
                    {item.attackBonus > 0 ? ` 攻+${item.attackBonus}` : ''}
                    {item.defenseBonus > 0 ? ` 防+${item.defenseBonus}` : ''}
                    {item.hpBonus > 0 ? ` HP+${item.hpBonus}` : ''}
                </Text>
            </View>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.equipped ? `${item.name}を外す` : `${item.name}を装備する`}
                onPress={() => onEquipToggle(item)}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.muted]}
            >
                <Text style={styles.secondaryButtonText}>{item.equipped ? '外す' : '装備'}</Text>
            </Pressable>
            <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: item.equipped }}
                accessibilityLabel={`${item.name}を売却する`}
                disabled={item.equipped}
                onPress={() => onSell(item)}
                style={({ pressed }) => [styles.dangerButton, (item.equipped || pressed) && styles.muted]}
            >
                <Text style={styles.dangerButtonText}>売却</Text>
            </Pressable>
        </View>
    );
}

function FilterSelect({ label, value, options, onChange, styles }: {
    label: string;
    value: string;
    options: [string, string][];
    onChange: (value: string) => void;
    styles: Styles;
}) {
    return (
        <View style={styles.filterGroup}>
            <Text style={styles.filterLabel}>{label}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.filterOptions}>
                    {options.map(([optionValue, optionLabel]) => (
                        <Pressable
                            key={optionValue}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: value === optionValue }}
                            accessibilityLabel={`${label}を${optionLabel}にする`}
                            onPress={() => onChange(optionValue)}
                            style={[styles.filterChip, value === optionValue && styles.filterChipActive]}
                        >
                            <Text style={[styles.filterChipText, value === optionValue && styles.filterChipTextActive]}>
                                {optionLabel}
                            </Text>
                        </Pressable>
                    ))}
                </View>
            </ScrollView>
        </View>
    );
}


type Styles = ReturnType<typeof createStyles>;

function createStyles(palette: ThemePalette) {
    return StyleSheet.create({
    flex: { flex: 1 },
    safeArea: { flex: 1, backgroundColor: palette.bg.primary },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    loadingText: { color: palette.text.muted, fontSize: 14, fontWeight: '600' },
    // タブレット幅でも読みやすいよう本文幅を制限して中央寄せする
    listContent: { width: '100%', maxWidth: LAYOUT_TOKENS.page.maxWidth, alignSelf: 'center', paddingHorizontal: LAYOUT_TOKENS.page.detailHorizontal, paddingTop: LAYOUT_TOKENS.page.top, paddingBottom: 32, gap: 8 },
    headerContent: { gap: 14, marginBottom: 6 },
    banner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.bg.tertiary, borderColor: palette.accent.emerald, borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
    bannerText: { flex: 1, color: palette.text.primary, fontSize: 13, fontWeight: '600', lineHeight: 19 },
    bannerClose: { color: palette.text.secondary, fontSize: 21, lineHeight: 23 },
    itemIcon: { width: 34, height: 34, borderRadius: 6, borderWidth: 2, backgroundColor: palette.bg.cardHover },
    imageFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.border.default, backgroundColor: palette.bg.cardHover },
    imageFallbackText: { color: palette.text.muted, fontSize: 15, fontWeight: '800' },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    filterRow: { flexDirection: 'row', gap: 10 },
    filterGroup: { flex: 1, gap: 4 },
    filterLabel: { color: palette.text.muted, fontSize: 10, fontWeight: '700' },
    filterOptions: { flexDirection: 'row', gap: 4 },
    filterChip: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, backgroundColor: palette.bg.secondary, borderColor: palette.border.default, borderWidth: 1 },
    filterChipActive: { backgroundColor: palette.accent.primary, borderColor: palette.accent.primary },
    filterChipText: { color: palette.text.muted, fontSize: 11, fontWeight: '700' },
    filterChipTextActive: { color: 'white' },
    sectionTitle: { color: palette.text.primary, fontSize: 16, fontWeight: '800' },
    hint: { color: palette.text.muted, fontSize: 11, lineHeight: 16 },
    emptyText: { color: palette.text.muted, fontSize: 13, paddingVertical: 8 },
    itemRow: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: palette.bg.secondary, borderColor: palette.border.default, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9 },
    itemRowSelected: { borderColor: palette.accent.emerald },
    selectBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: palette.text.muted, alignItems: 'center', justifyContent: 'center' },
    selectBoxActive: { backgroundColor: palette.accent.emerald, borderColor: palette.accent.emerald },
    selectMark: { color: palette.bg.primary, fontSize: 13, fontWeight: '900' },
    itemName: { fontSize: 14, fontWeight: '700' },
    itemMeta: { color: palette.text.muted, fontSize: 11, marginTop: 2 },
    secondaryButton: { height: 32, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.border.default },
    secondaryButtonText: { color: palette.text.primary, fontSize: 12, fontWeight: '700' },
    dangerButton: { height: 32, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg.tertiary, borderWidth: 1, borderColor: palette.text.danger },
    dangerButtonText: { color: palette.text.danger, fontSize: 12, fontWeight: '700' },
    muted: { opacity: 0.45 },
    });
}
