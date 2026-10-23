import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Image, Keyboard, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LAYOUT_TOKENS, type ThemePalette } from '@life-quest/core/designTokens';
import { PAGE_HEADING } from '../theme/layout';
import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { captureLoadoutActions, type Equipment, type EquipmentSlot, type Rarity } from '@life-quest/core/equipment';
import { createInventoryConfirmation, filterAndSortInventory, INVENTORY_SELECTION_CHANGED, reconcileSynthesisSelection, toggleSynthesisSelection, type InventoryRarityFilter, type InventorySlotFilter, type InventorySortMode } from '@life-quest/core/inventory';
import { SELL_XP_BY_RARITY, SYNTHESIS_CONFIG } from '@life-quest/core/rewards';
import { getItemImage } from '../assets/images';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { CharacterLevelUpNotice } from '../components/CharacterLevelUpNotice';
import { Dialog } from '../components/DailyScreenUI';
import { usePalette } from '../theme/usePalette';
import { useInventorySynthesis } from '../hooks/useInventorySynthesis';
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
    accessory: 'アクセサリー',
};

type InventoryMode = 'normal' | 'sell' | 'synthesize';
const FILTERS = {
    slot: { label: '種類', options: [['all', 'すべて'], ['weapon', '武器'], ['armor', '防具'], ['accessory', 'アクセサリー']] },
    rarity: { label: 'レア', options: [['all', 'すべて'], ...Object.entries(RARITY_LABELS)] },
    sort: { label: '並び', options: [['rarity', 'レア順'], ['slot', '種類順'], ['name', '名前順']] },
} satisfies Record<string, { label: string; options: string[][] }>;
type FilterKind = keyof typeof FILTERS;
type FilterPicker = { kind: FilterKind; token: object; isCurrent: () => boolean };

export default function InventoryScreen() {
    const router = useRouter();
    const equipment = useMobileGameStore((state) => state.equipment);
    const hasHydrated = useMobileGameStore((state) => state.hasHydrated);
    const sellItem = useMobileGameStore((state) => state.sellItem);
    const { isSynthesizing, hasError: synthHasError, synthesize, retry: retrySynthesize } = useInventorySynthesis();

    const { palette } = usePalette();
    const { fontScale } = useWindowDimensions();
    const styles = useMemo(() => createStyles(palette), [palette]);
    const [selection, setSelection] = useState<readonly Equipment[]>([]);
    const [selectionNotice, setSelectionNotice] = useState('');
    const [lastReveal, setLastReveal] = useState<Equipment | null>(null);
    const [mode, setMode] = useState<InventoryMode>('normal');
    const [slotFilter, setSlotFilter] = useState<InventorySlotFilter>('all');
    const [rarityFilter, setRarityFilter] = useState<InventoryRarityFilter>('all');
    const [sortMode, setSortMode] = useState<InventorySortMode>('rarity');
    const [picker, setPicker] = useState<FilterPicker | null>(null);
    const pickerRef = useRef<object | null>(null);
    const closePicker = useCallback(() => { pickerRef.current = null; setPicker(null); }, []);
    const pendingConfirmation = useRef<object | null>(null);
    const leaving = useRef(false);
    const viewRef = useRef({});
    const selectionRef = useRef({});
    const invalidateView = useCallback(() => {
        closePicker();
        viewRef.current = {}; selectionRef.current = {}; pendingConfirmation.current = null; setSelection([]); setSelectionNotice('');
    }, [closePicker]);
    const interactions = useInteractionScope(() => {
        leaving.current = false;
        invalidateView(); setLastReveal(null); setMode('normal'); setSlotFilter('all'); setRarityFilter('all'); setSortMode('rarity');
    });
    const view = viewRef.current; const renderedScope = interactions.capture();
    const isCurrentView = useCallback(() => !leaving.current && viewRef.current === view && renderedScope() && useMobileGameStore.getState().hasHydrated, [view, renderedScope]);
    useEffect(() => { if (!hasHydrated) closePicker(); }, [hasHydrated, closePicker]);
    const selectionVersion = selectionRef.current;
    const isCurrentSelection = () => isCurrentView() && selectionRef.current === selectionVersion;
    const loadoutAction = captureLoadoutActions(equipment, () => useMobileGameStore.getState().equipment,
        isCurrentView);
    const selectedItems = useMemo(() => reconcileSynthesisSelection(selection, equipment), [selection, equipment]);
    useEffect(() => {
        if (selectedItems === selection || !isCurrentView()) return;
        selectionRef.current = {}; setSelection(selectedItems); setSelectionNotice(INVENTORY_SELECTION_CHANGED);
    }, [selectedItems, selection, isCurrentView]);
    const changeView = (update: () => void) => { if (isCurrentView()) { invalidateView(); update(); } };
    const resetFilters = () => changeView(() => { setSlotFilter('all'); setRarityFilter('all'); setSortMode('rarity'); });
    const filtersActive = slotFilter !== 'all' || rarityFilter !== 'all' || sortMode !== 'rarity';
    const filterValues = { slot: slotFilter, rarity: rarityFilter, sort: sortMode };
    const openPicker = (kind: FilterKind) => {
        if (!isCurrentView() || pickerRef.current) return;
        Keyboard.dismiss();
        const token = {};
        pickerRef.current = token;
        setPicker({ kind, token, isCurrent: isCurrentView });
    };
    const dismissPicker = () => {
        if (picker && pickerRef.current === picker.token) closePicker();
    };
    const chooseFilter = (value: string) => {
        if (!picker || pickerRef.current !== picker.token || !picker.isCurrent() || !isCurrentView()) return;
        // Consume this dialog before React rerenders: old choices/close callbacks cannot own a later dialog.
        closePicker();
        if (value === filterValues[picker.kind]) return;
        changeView(() => {
            if (picker.kind === 'slot') setSlotFilter(value as InventorySlotFilter);
            else if (picker.kind === 'rarity') setRarityFilter(value as InventoryRarityFilter);
            else setSortMode(value as InventorySortMode);
        });
    };
    const unequipped = useMemo(() => equipment.filter((item) => !item.equipped), [equipment]);

    // 最大2000件になり得るため FlatList で仮想化して描画する
    const inventory = useMemo(
        () => filterAndSortInventory(unequipped, { slotFilter, rarityFilter, sortMode, slotLabels: SLOT_LABELS }),
        [unequipped, slotFilter, rarityFilter, sortMode],
    );

    const canSynthesize = selectedItems.length === SYNTHESIS_CONFIG.REQUIRED_COUNT
        && selectedItems.every((item) => !item.equipped && item.rarity === selectedItems[0].rarity)
        && selectedItems[0].rarity !== 'legendary';

    const toggleSelect = (item: Equipment) => {
        if (mode !== 'synthesize' || !isCurrentView()) return;
        selectionRef.current = {};
        setSelectionNotice('');
        setSelection((current) => toggleSynthesisSelection(current, item, useMobileGameStore.getState().equipment, SYNTHESIS_CONFIG.REQUIRED_COUNT));
    };

    const handleSell = (item: Equipment) => {
        const isCurrent = isCurrentView;
        if (mode !== 'sell' || !isCurrent()) return;
        const token = {};
        pendingConfirmation.current = token;
        const confirm = createInventoryConfirmation([item], () => useMobileGameStore.getState().equipment,
            () => isCurrent() && pendingConfirmation.current === token, () => {
                setSelection((current) => current.filter((candidate) => candidate.id !== item.id));
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
        const isCurrent = isCurrentView;
        if (!isCurrent()) return;
        void invoke().then((result) => { if (isCurrent() && result) setLastReveal({ ...result }); });
    };

    const handleSynthesize = () => {
        if (mode !== 'synthesize' || !canSynthesize) return;
        const isCurrent = isCurrentSelection;
        if (!isCurrent()) return;
        const token = {};
        pendingConfirmation.current = token;
        // Only the visible, approved three items are consumed; hidden stale IDs cannot join.
        const ingredientIds = selectedItems.map((item) => item.id);
        const confirm = createInventoryConfirmation(selectedItems, () => useMobileGameStore.getState().equipment,
            () => isCurrent() && pendingConfirmation.current === token, () => {
                setSelection([]);
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

    const pageHeader = (
        <View style={styles.pageHeader}>
            <Pressable accessibilityRole="button" accessibilityLabel="キャラクター画面に戻る"
                onPress={() => {
                    if (!leaving.current && viewRef.current === view && renderedScope()) {
                        leaving.current = true; invalidateView(); router.dismissTo('/character');
                    }
                }} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>‹ 戻る</Text></Pressable>
            <Text accessibilityRole="header" style={styles.pageTitle}>インベントリ</Text>
        </View>
    );
    if (!hasHydrated) {
        return (
            <SafeAreaView style={styles.safeArea}>
                {pageHeader}
                <View style={styles.loading}>
                    <Text style={styles.loadingText}>保存データを読み込み中…</Text>
                </View>
            </SafeAreaView>
        );
    }

    const listHeader = (
        <View style={styles.headerContent}>
            <CharacterLevelUpNotice />
            {lastReveal && (
                <View style={styles.banner} accessibilityRole="alert">
                    <Text style={styles.bannerText}>{`合成で「${lastReveal.name}」が誕生！`}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel="入手通知を閉じる" onPress={() => setLastReveal((current) => current === lastReveal ? null : current)} style={styles.closeButton}>
                        <Text style={styles.bannerClose}>×</Text>
                    </Pressable>
                </View>
            )}

            <View style={styles.sectionHeader}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>インベントリ（{inventory.length}/{unequipped.length}）</Text>
                {unequipped.length > 0 && <View style={styles.modeActions}>
                    {(['sell', 'synthesize'] as const).map((value) => (
                        <Pressable key={value} accessibilityRole="button" accessibilityLabel={value === 'sell' ? '売却' : '合成'}
                            accessibilityState={{ selected: mode === value }}
                            onPress={() => changeView(() => setMode(mode === value ? 'normal' : value))}
                            style={[styles.secondaryButton, mode === value && styles.modeActive]}>
                            <Text style={[styles.secondaryButtonText, mode === value && styles.activeText]}>{value === 'sell' ? '売却' : '合成'}</Text>
                        </Pressable>
                    ))}
                </View>}
            </View>

            <View style={styles.filterCard}>
                <View style={styles.filterHeading}>
                    <SlidersHorizontal size={14} color={palette.text.secondary} accessible={false} />
                    <Text style={styles.filterHeadingText}>表示</Text>
                </View>
                <View style={styles.filterRow}>
                    {(['slot', 'rarity', 'sort'] as const).map((kind) => (
                        <FilterSelect key={kind} kind={kind} value={filterValues[kind]} fontScale={fontScale}
                            expanded={picker?.kind === kind} onOpen={() => openPicker(kind)} styles={styles} palette={palette} />
                    ))}
                </View>
                {filtersActive && <Pressable accessibilityRole="button" accessibilityLabel="表示条件をリセット" onPress={resetFilters} style={styles.filterReset}><Text style={styles.secondaryButtonText}>表示条件をリセット</Text></Pressable>}
            </View>

            {mode === 'synthesize' && <Text style={styles.hint}>同レアリティ{SYNTHESIS_CONFIG.REQUIRED_COUNT}個 → 多い装備種別の上位装備に合成（{selectedItems.length}/{SYNTHESIS_CONFIG.REQUIRED_COUNT}）。表示条件を変更すると素材の選択を解除します。</Text>}
            {mode === 'sell' && <Text style={styles.hint}>タップでアイテムを売却しXPに変換</Text>}
            {selectedItems.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="素材の選択を解除" onPress={() => changeView(() => {})} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>素材の選択を解除</Text></Pressable>}
            {selectionNotice ? <Text accessibilityRole="alert" style={styles.hint}>{selectionNotice}</Text> : null}
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
        <SafeAreaView style={styles.safeArea}>
            {pageHeader}
            <FlatList
                data={inventory}
                keyExtractor={(item) => item.id}
                ListHeaderComponent={listHeader}
                ListEmptyComponent={
                    <Text style={styles.emptyText}>{unequipped.length ? '条件に合う装備がありません。表示条件をリセットしてください。' : '未装備の装備がありません。タスクを達成して宝箱を集めましょう。'}</Text>
                }
                ListFooterComponent={mode === 'synthesize' ? <Pressable accessibilityRole="button"
                    accessibilityState={{ disabled: !canSynthesize || isSynthesizing }}
                    accessibilityLabel={`選択した${SYNTHESIS_CONFIG.REQUIRED_COUNT}個の装備を合成する`}
                    disabled={!canSynthesize || isSynthesizing} onPress={handleSynthesize}
                    style={[styles.primaryButton, styles.synthesizeButton, (!canSynthesize || isSynthesizing) && styles.muted]}>
                    <Text style={styles.activeText}>{isSynthesizing ? '合成中…' : `合成する（${selectedItems.length}/${SYNTHESIS_CONFIG.REQUIRED_COUNT}）`}</Text>
                </Pressable> : null}
                renderItem={({ item }) => (
                    <InventoryRow
                        item={item}
                        mode={mode}
                        selected={selectedItems.some((candidate) => candidate.id === item.id)}
                        selectionDisabled={item.equipped || item.rarity === 'legendary' || (!selectedItems.some((candidate) => candidate.id === item.id) && (selectedItems.length >= SYNTHESIS_CONFIG.REQUIRED_COUNT || (selectedItems.length > 0 && selectedItems[0].rarity !== item.rarity)))}
                        onToggleSelect={loadoutAction(() => toggleSelect(item))}
                        onEquip={loadoutAction(() => useMobileGameStore.getState().equipItem(item.id))}
                        onSell={handleSell}
                        styles={styles}
                        palette={palette}
                    />
                )}
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
            />
            {picker && pickerRef.current === picker.token && picker.isCurrent() && (
                <Dialog title={`${FILTERS[picker.kind].label}を選択`} onClose={dismissPicker}
                    closeLabel={`${FILTERS[picker.kind].label}の選択を閉じる`} closeTargetSize={44}>
                    {FILTERS[picker.kind].options.map(([value, label]) => (
                        <Pressable key={value} accessibilityRole="radio"
                            accessibilityLabel={`${FILTERS[picker.kind].label}を${label}にする`}
                            accessibilityState={{ checked: filterValues[picker.kind] === value }}
                            onPress={() => chooseFilter(value)}
                            style={[styles.filterOption, filterValues[picker.kind] === value && styles.filterOptionSelected]}>
                            <Text style={styles.filterOptionText}>{label}</Text>
                            {filterValues[picker.kind] === value && <Check size={16} color={palette.accent.primary} accessible={false} />}
                        </Pressable>
                    ))}
                </Dialog>
            )}
        </SafeAreaView>
    );
}

/** 装備アイコン（レアリティ色の枠）。未知のtemplate_idはプレースホルダー。 */
function ItemIcon({ templateId, rarity, styles, palette }: { templateId: string; rarity: Rarity; styles: Styles; palette: ThemePalette }) {
    const source = getItemImage(templateId);
    return <View style={[styles.iconFrame, { backgroundColor: `${palette.rarity[rarity]}22` }]}>
        {source ? <Image source={source} resizeMode="contain" style={styles.itemIcon} /> : <Text style={styles.imageFallbackText}>?</Text>}
    </View>;
}

function InventoryRow({
    item,
    mode,
    selected,
    selectionDisabled,
    onToggleSelect,
    onEquip,
    onSell,
    styles,
    palette,
}: {
    item: Equipment;
    mode: InventoryMode;
    selected: boolean;
    selectionDisabled: boolean;
    onToggleSelect: (item: Equipment) => void;
    onEquip: (item: Equipment) => void;
    onSell: (item: Equipment) => void;
    styles: Styles;
    palette: ThemePalette;
}) {
    const itemDescription = [RARITY_LABELS[item.rarity], SLOT_LABELS[item.slot],
        ...(item.attackBonus > 0 ? [`攻撃力+${item.attackBonus}`] : []),
        ...(item.defenseBonus > 0 ? [`防御力+${item.defenseBonus}`] : []),
        ...(item.hpBonus > 0 ? [`HP+${item.hpBonus}`] : []),
        ...(mode === 'sell' ? [`確認後に${SELL_XP_BY_RARITY[item.rarity]}XPを獲得します`] : []),
    ].join('、');
    const content = <>
                {mode === 'synthesize' && <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
                    style={[styles.checkbox, { borderColor: selected ? palette.rarity[item.rarity] : palette.text.muted, backgroundColor: selected ? palette.rarity[item.rarity] : 'transparent' }]}>
                    {selected && <Check size={12} color="#000" />}
                </View>}
                <ItemIcon templateId={item.templateId} rarity={item.rarity} styles={styles} palette={palette} />
                <View style={styles.flex}>
                    <Text style={[styles.itemName, { color: palette.rarity[item.rarity] }]}>{item.name}</Text>
                    <Text style={styles.itemMeta}>
                        {RARITY_LABELS[item.rarity]} · {SLOT_LABELS[item.slot]}
                        {item.attackBonus > 0 ? ` · 攻+${item.attackBonus}` : ''}
                        {item.defenseBonus > 0 ? ` · 防+${item.defenseBonus}` : ''}
                        {item.hpBonus > 0 ? ` · HP+${item.hpBonus}` : ''}
                    </Text>
                </View>
                {mode === 'normal' && <Pressable accessibilityRole="button" accessibilityLabel={`${item.name}を装備する`}
                    onPress={() => onEquip(item)} style={styles.primaryButton}><Text style={styles.activeText}>装備</Text></Pressable>}
                {mode === 'sell' && <Text style={styles.saleXp}>+{SELL_XP_BY_RARITY[item.rarity]} XP</Text>}
            </>;
    const rowStyle = [styles.itemRow, {
        borderColor: selected ? palette.rarity[item.rarity] : `${palette.rarity[item.rarity]}33`,
        backgroundColor: selected ? `${palette.rarity[item.rarity]}15` : palette.bg.card,
    }];
    if (mode === 'normal') return <View style={rowStyle}>{content}</View>;
    return <Pressable accessibilityRole={mode === 'synthesize' ? 'checkbox' : 'button'}
        accessibilityLabel={mode === 'synthesize' ? `${item.name}を合成素材に${selected ? '選択解除' : '選択'}する` : `${item.name}を売却する`}
        accessibilityValue={{ text: itemDescription }}
        accessibilityState={mode === 'synthesize' ? { checked: selected, disabled: selectionDisabled } : undefined}
        disabled={mode === 'synthesize' && selectionDisabled}
        onPress={() => mode === 'synthesize' ? onToggleSelect(item) : onSell(item)}
        style={[...rowStyle, mode === 'synthesize' && selectionDisabled && styles.muted]}>{content}</Pressable>;
}

function FilterSelect({ kind, value, fontScale, expanded, onOpen, styles, palette }: {
    kind: FilterKind;
    value: string;
    fontScale: number;
    expanded: boolean;
    onOpen: () => void;
    styles: Styles;
    palette: ThemePalette;
}) {
    const { label, options } = FILTERS[kind];
    const selectedLabel = options.find(([key]) => key === value)?.[1];
    return (
        <View style={[styles.filterGroup, { flexBasis: 104 * fontScale }]}>
            <Text accessible={false} style={styles.filterLabel}>{label}</Text>
            <Pressable testID={`inventory-filter-${kind}`} accessibilityRole="button"
                accessibilityLabel={`${label}：${selectedLabel}`} accessibilityState={{ expanded }}
                onPress={onOpen} style={styles.filterButton}>
                <Text style={styles.filterValue}>{selectedLabel}</Text>
                <ChevronDown size={12} color={palette.text.primary} accessible={false} />
            </Pressable>
        </View>
    );
}


type Styles = ReturnType<typeof createStyles>;

function createStyles(palette: ThemePalette) {
    return StyleSheet.create({
    flex: { flex: 1, minWidth: 100 },
    safeArea: { flex: 1, backgroundColor: palette.bg.primary },
    pageHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, paddingHorizontal: LAYOUT_TOKENS.page.detailHorizontal, paddingTop: 12, paddingBottom: 8, width: '100%', maxWidth: LAYOUT_TOKENS.page.maxWidth, alignSelf: 'center' },
    pageTitle: { ...PAGE_HEADING, color: palette.text.primary, flexShrink: 1 },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    loadingText: { color: palette.text.muted, fontSize: 14, fontWeight: '600' },
    // タブレット幅でも読みやすいよう本文幅を制限して中央寄せする
    listContent: { width: '100%', maxWidth: LAYOUT_TOKENS.page.maxWidth, alignSelf: 'center', paddingHorizontal: LAYOUT_TOKENS.page.detailHorizontal, paddingTop: LAYOUT_TOKENS.page.top, paddingBottom: 32, gap: 8 },
    headerContent: { gap: 14, marginBottom: 6 },
    banner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.bg.tertiary, borderColor: palette.accent.emerald, borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
    bannerText: { flex: 1, color: palette.text.primary, fontSize: 13, fontWeight: '600', lineHeight: 19 },
    bannerClose: { color: palette.text.secondary, fontSize: 21, lineHeight: 23 },
    closeButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    itemIcon: { width: 40, height: 40 },
    iconFrame: { width: 48, height: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    imageFallbackText: { color: palette.text.muted, fontSize: 15, fontWeight: '800' },
    sectionHeader: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' },
    filterCard: { gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: palette.border.default, backgroundColor: palette.bg.card },
    filterHeading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    filterHeadingText: { color: palette.text.secondary, fontSize: 12, fontWeight: '600' },
    filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    filterGroup: { flexGrow: 1, flexShrink: 1, minWidth: 0, maxWidth: '100%', gap: 4 },
    filterLabel: { color: palette.text.muted, fontSize: 10 },
    filterButton: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 44, minHeight: 44, paddingHorizontal: 8, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: palette.border.default, backgroundColor: palette.bg.secondary },
    filterValue: { flex: 1, minWidth: 0, color: palette.text.primary, fontSize: 12 },
    filterOption: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, padding: 12, borderRadius: 8, backgroundColor: palette.bg.secondary },
    filterOptionSelected: { backgroundColor: palette.bg.cardHover },
    filterOptionText: { flex: 1, minWidth: 0, color: palette.text.primary, fontSize: 14 },
    filterReset: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg.secondary },
    sectionTitle: { color: palette.text.primary, fontSize: 16, fontWeight: '800' },
    hint: { color: palette.text.muted, fontSize: 11, lineHeight: 16 },
    emptyText: { color: palette.text.muted, fontSize: 13, paddingVertical: 8 },
    itemRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', minHeight: 44, gap: 12, backgroundColor: palette.bg.card, borderWidth: 1, borderRadius: 12, padding: 12 },
    modeActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    modeActive: { backgroundColor: palette.accent.primary },
    primaryButton: { minWidth: 44, minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.accent.primary },
    activeText: { color: 'white', fontSize: 12, fontWeight: '700' },
    synthesizeButton: { marginTop: 8 },
    saleXp: { color: '#000', backgroundColor: palette.accent.gold, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, fontSize: 12, fontWeight: '700' },
    checkbox: { width: 20, height: 20, borderWidth: 2, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
    itemName: { fontSize: 14, fontWeight: '700' },
    itemMeta: { color: palette.text.muted, fontSize: 12, marginTop: 2 },
    secondaryButton: { minWidth: 44, minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.border.default },
    secondaryButtonText: { color: palette.text.primary, fontSize: 12, fontWeight: '700' },
    dangerButton: { minWidth: 44, minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg.tertiary, borderWidth: 1, borderColor: palette.text.danger },
    dangerButtonText: { color: palette.text.danger, fontSize: 12, fontWeight: '700' },
    muted: { opacity: 0.45 },
    });
}
