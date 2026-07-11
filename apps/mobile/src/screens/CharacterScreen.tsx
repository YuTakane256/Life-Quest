import { useMemo, useState } from 'react';
import { Alert, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ThemePalette } from '@life-quest/core/designTokens';
import { EQUIPMENT_SLOTS, type Equipment, type EquipmentSlot, type Rarity } from '@life-quest/core/equipment';
import { filterAndSortInventory, type InventoryRarityFilter, type InventorySlotFilter, type InventorySortMode } from '@life-quest/core/inventory';
import { calculateNextLevelXp, calculateXpProgress } from '@life-quest/core/progression';
import { SELL_XP_BY_RARITY, SYNTHESIS_CONFIG } from '@life-quest/core/rewards';
import { AVATAR_IMAGES, getChestImage, getItemImage } from '../assets/images';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { useMobileTitleStore } from '../stores/useMobileTitleStore';
import { usePalette } from '../theme/usePalette';

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

const AVATAR_OPTIONS = [
    { id: 'female', label: '女性' },
    { id: 'male', label: '男性' },
] as const;

export default function CharacterScreen() {
    const character = useMobileGameStore((state) => state.character);
    const equipment = useMobileGameStore((state) => state.equipment);
    const chestQueue = useMobileGameStore((state) => state.chestQueue);
    const hasHydrated = useMobileGameStore((state) => state.hasHydrated);
    const lastLevelUp = useMobileGameStore((state) => state.lastLevelUp);
    const updateCharacter = useMobileGameStore((state) => state.updateCharacter);
    const clearLastLevelUp = useMobileGameStore((state) => state.clearLastLevelUp);
    const openChest = useMobileGameStore((state) => state.openChest);
    const equipItem = useMobileGameStore((state) => state.equipItem);
    const unequipItem = useMobileGameStore((state) => state.unequipItem);
    const autoEquipBest = useMobileGameStore((state) => state.autoEquipBest);
    const sellItem = useMobileGameStore((state) => state.sellItem);
    const synthesizeItems = useMobileGameStore((state) => state.synthesizeItems);
    const getEffectiveStats = useMobileGameStore((state) => state.getEffectiveStats);
    const activeTitle = useMobileTitleStore((state) => state.activeTitle);

    const { palette } = usePalette();
    const styles = useMemo(() => createStyles(palette), [palette]);
    const rarityColors = palette.rarity;

    const [nameDraft, setNameDraft] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
    const [lastRevealText, setLastRevealText] = useState<string | null>(null);
    const [slotFilter, setSlotFilter] = useState<InventorySlotFilter>('all');
    const [rarityFilter, setRarityFilter] = useState<InventoryRarityFilter>('all');
    const [sortMode, setSortMode] = useState<InventorySortMode>('rarity');

    const stats = getEffectiveStats();
    const progress = calculateXpProgress(character.totalXp, character.level);
    const nextLevelXp = calculateNextLevelXp(character.level);
    const unopenedChests = chestQueue.filter((chest) => !chest.opened);
    const equippedBySlot = useMemo(() => {
        const map = new Map<EquipmentSlot, Equipment>();
        for (const item of equipment) {
            if (item.equipped) map.set(item.slot, item);
        }
        return map;
    }, [equipment]);
    // 最大2000件になり得るため FlatList で仮想化して描画する
    const inventory = useMemo(
        () => filterAndSortInventory(equipment, { slotFilter, rarityFilter, sortMode, slotLabels: SLOT_LABELS }),
        [equipment, slotFilter, rarityFilter, sortMode],
    );

    const selectedItems = inventory.filter((item) => selectedIds.includes(item.id));
    const canSynthesize = selectedItems.length === SYNTHESIS_CONFIG.REQUIRED_COUNT
        && selectedItems.every((item) => !item.equipped && item.rarity === selectedItems[0].rarity)
        && selectedItems[0].rarity !== 'legendary';

    const commitName = () => {
        if (nameDraft !== null && nameDraft.trim()) updateCharacter({ name: nameDraft.trim() });
        setNameDraft(null);
    };

    const toggleSelect = (item: Equipment) => {
        if (item.equipped) return;
        setSelectedIds((current) => current.includes(item.id)
            ? current.filter((id) => id !== item.id)
            : [...current, item.id]);
    };

    const handleOpenChest = (chestId: string, label: string) => {
        const reward = openChest(chestId);
        setLastRevealText(reward ? `${label}から「${reward.name}」を入手！` : `${label}を開封した！`);
    };

    const handleSell = (item: Equipment) => {
        Alert.alert(
            '装備を売却',
            `「${item.name}」を売却して ${SELL_XP_BY_RARITY[item.rarity]} XP を獲得します。よろしいですか？`,
            [
                { text: 'キャンセル', style: 'cancel' },
                {
                    text: '売却する',
                    style: 'destructive',
                    onPress: () => {
                        setSelectedIds((current) => current.filter((id) => id !== item.id));
                        sellItem(item.id);
                    },
                },
            ],
        );
    };

    const handleSynthesize = () => {
        if (!canSynthesize) return;
        Alert.alert(
            '装備を合成',
            `選択した${SYNTHESIS_CONFIG.REQUIRED_COUNT}個を消費して、1つ上のレアリティの装備を生成します。よろしいですか？`,
            [
                { text: 'キャンセル', style: 'cancel' },
                {
                    text: '合成する',
                    onPress: () => {
                        const result = synthesizeItems([...selectedIds]);
                        setSelectedIds([]);
                        if (result) setLastRevealText(`合成で「${result.name}」が誕生！`);
                    },
                },
            ],
        );
    };

    if (!hasHydrated) {
        return (
            <SafeAreaView style={styles.safeArea}>
                <View style={styles.loading}>
                    <Text style={styles.loadingText}>保存データを読み込み中…</Text>
                </View>
            </SafeAreaView>
        );
    }

    const listHeader = (
        <View style={styles.headerContent}>
            <View style={styles.titleRow}>
                <Text style={styles.title}>キャラクター</Text>
            </View>

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
            {lastRevealText && (
                <View style={styles.banner} accessibilityRole="alert">
                    <Text style={styles.bannerText}>{lastRevealText}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel="入手通知を閉じる" onPress={() => setLastRevealText(null)} hitSlop={10}>
                        <Text style={styles.bannerClose}>×</Text>
                    </Pressable>
                </View>
            )}

            {/* プロフィール */}
            <View style={styles.card}>
                <View style={styles.profileRow}>
                    <View style={styles.avatarCircle}>
                        <Image
                            source={AVATAR_IMAGES[character.avatar === 'male' ? 'male' : 'female']}
                            style={styles.avatarImage}
                            accessibilityLabel="キャラクターのアバター画像"
                        />
                    </View>
                    <View style={styles.flex}>
                        <TextInput
                            value={nameDraft ?? character.name}
                            onChangeText={setNameDraft}
                            onBlur={commitName}
                            onSubmitEditing={commitName}
                            maxLength={30}
                            accessibilityLabel="キャラクター名"
                            style={styles.nameInput}
                            placeholderTextColor="#737d90"
                        />
                        <Text style={styles.levelText}>Lv.{character.level}</Text>
                        {activeTitle && <Text style={styles.activeTitleText} numberOfLines={1}>{activeTitle}</Text>}
                    </View>
                </View>
                <View style={styles.avatarSwitch}>
                    {AVATAR_OPTIONS.map((option) => (
                        <Pressable
                            key={option.id}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: character.avatar === option.id }}
                            accessibilityLabel={`アバターを${option.label}にする`}
                            onPress={() => updateCharacter({ avatar: option.id })}
                            style={[styles.segment, character.avatar === option.id && styles.segmentActive]}
                        >
                            <Image source={AVATAR_IMAGES[option.id]} style={styles.segmentAvatar} />
                            <Text style={[styles.segmentText, character.avatar === option.id && styles.segmentTextActive]}>
                                {option.label}
                            </Text>
                        </Pressable>
                    ))}
                </View>

                {/* XP進捗 */}
                <View
                    accessibilityRole="progressbar"
                    accessibilityLabel={`経験値 ${character.totalXp} / 次のレベルまで ${Math.max(0, nextLevelXp - character.totalXp)}`}
                    style={styles.progressTrack}
                >
                    <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
                </View>
                <Text style={styles.progressText}>XP {character.totalXp} / {nextLevelXp}</Text>

                {/* ステータス */}
                <View style={styles.statsRow}>
                    <StatCell label="攻撃" base={character.baseAttack} effective={stats.attack} styles={styles} />
                    <StatCell label="防御" base={character.baseDefense} effective={stats.defense} styles={styles} />
                    <StatCell label="HP" base={character.baseMaxHp} effective={stats.maxHp} styles={styles} />
                </View>
            </View>

            {/* 宝箱 */}
            {unopenedChests.length > 0 && (
                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>宝箱（{unopenedChests.length}）</Text>
                    {unopenedChests.map((chest) => (
                        <View key={chest.id} style={styles.chestRow}>
                            {getChestImage(chest.chestType) ? (
                                <Image source={getChestImage(chest.chestType)!} style={styles.chestImage} />
                            ) : (
                                <View style={[styles.chestImage, styles.imageFallback]}>
                                    <Text style={styles.imageFallbackText}>?</Text>
                                </View>
                            )}
                            <Text style={styles.chestLabel}>{chest.label}</Text>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`${chest.label}を開封する`}
                                onPress={() => handleOpenChest(chest.id, chest.label)}
                                style={({ pressed }) => [styles.primaryButton, pressed && styles.muted]}
                            >
                                <Text style={styles.primaryButtonText}>開封</Text>
                            </Pressable>
                        </View>
                    ))}
                </View>
            )}

            {/* 装備中 */}
            <View style={styles.card}>
                <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>装備中</Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="各部位の最強装備を自動で装着する"
                        onPress={() => { autoEquipBest(); }}
                        style={({ pressed }) => [styles.secondaryButton, pressed && styles.muted]}
                    >
                        <Text style={styles.secondaryButtonText}>自動装備</Text>
                    </Pressable>
                </View>
                {EQUIPMENT_SLOTS.map((slot) => {
                    const item = equippedBySlot.get(slot);
                    return (
                        <View key={slot} style={styles.slotRow}>
                            <Text style={styles.slotLabel}>{SLOT_LABELS[slot]}</Text>
                            {item ? (
                                <>
                                    <ItemIcon templateId={item.templateId} rarity={item.rarity} styles={styles} palette={palette} />
                                    <Text style={[styles.slotItemName, { color: rarityColors[item.rarity] }]} numberOfLines={1}>
                                        {item.name}
                                    </Text>
                                </>
                            ) : (
                                <Text style={styles.slotEmpty}>なし</Text>
                            )}
                        </View>
                    );
                })}
            </View>

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
                    accessibilityState={{ disabled: !canSynthesize }}
                    accessibilityLabel={`選択した${SYNTHESIS_CONFIG.REQUIRED_COUNT}個の装備を合成する`}
                    disabled={!canSynthesize}
                    onPress={handleSynthesize}
                    style={({ pressed }) => [styles.secondaryButton, (!canSynthesize || pressed) && styles.muted]}
                >
                    <Text style={styles.secondaryButtonText}>合成（{selectedItems.length}/{SYNTHESIS_CONFIG.REQUIRED_COUNT}）</Text>
                </Pressable>
            </View>
            <Text style={styles.hint}>同じレアリティの未装備品{SYNTHESIS_CONFIG.REQUIRED_COUNT}個を選ぶと上位レアリティへ合成できます。</Text>
        </View>
    );

    return (
        <SafeAreaView style={styles.safeArea}>
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

function StatCell({ label, base, effective, styles }: { label: string; base: number; effective: number; styles: Styles }) {
    const bonus = effective - base;
    return (
        <View style={styles.statCell}>
            <Text style={styles.statLabel}>{label}</Text>
            <Text style={styles.statValue}>{effective}</Text>
            {bonus > 0 && <Text style={styles.statBonus}>+{bonus}</Text>}
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
    listContent: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 32, gap: 8 },
    headerContent: { gap: 14, marginBottom: 6 },
    title: { color: palette.text.primary, fontSize: 28, fontWeight: '800' },
    titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 20 },
    banner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.bg.tertiary, borderColor: palette.accent.emerald, borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
    bannerText: { flex: 1, color: palette.text.primary, fontSize: 13, fontWeight: '600', lineHeight: 19 },
    bannerClose: { color: palette.text.secondary, fontSize: 21, lineHeight: 23 },
    card: { backgroundColor: palette.bg.card, borderColor: palette.border.default, borderWidth: 1, borderRadius: 10, padding: 16, gap: 10 },
    profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    avatarCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: palette.bg.cardHover, alignItems: 'center', justifyContent: 'center' },
    avatarImage: { width: 56, height: 56, borderRadius: 28 },
    segmentAvatar: { width: 20, height: 20, borderRadius: 10, marginRight: 6 },
    chestImage: { width: 36, height: 36, borderRadius: 6 },
    itemIcon: { width: 34, height: 34, borderRadius: 6, borderWidth: 2, backgroundColor: palette.bg.cardHover },
    imageFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: palette.border.default, backgroundColor: palette.bg.cardHover },
    imageFallbackText: { color: palette.text.muted, fontSize: 15, fontWeight: '800' },
    nameInput: { color: palette.text.primary, fontSize: 18, fontWeight: '700', borderBottomWidth: 1, borderBottomColor: palette.border.default, paddingVertical: 4, paddingHorizontal: 0 },
    levelText: { color: palette.accent.gold, fontSize: 13, fontWeight: '800', marginTop: 4 },
    activeTitleText: { color: palette.accent.gold, fontSize: 11, fontWeight: '700', marginTop: 2 },
    avatarSwitch: { flexDirection: 'row', backgroundColor: palette.bg.secondary, borderRadius: 8, padding: 3 },
    segment: { flex: 1, height: 34, borderRadius: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    segmentActive: { backgroundColor: palette.border.default },
    segmentText: { color: palette.text.muted, fontSize: 12, fontWeight: '700' },
    segmentTextActive: { color: palette.text.primary },
    progressTrack: { height: 10, borderRadius: 5, backgroundColor: palette.bg.cardHover, overflow: 'hidden' },
    progressFill: { height: '100%', borderRadius: 5, backgroundColor: palette.accent.emerald },
    progressText: { color: palette.text.secondary, fontSize: 12 },
    statsRow: { flexDirection: 'row', gap: 8 },
    statCell: { flex: 1, backgroundColor: palette.bg.secondary, borderRadius: 8, paddingVertical: 10, alignItems: 'center', gap: 2 },
    statLabel: { color: palette.text.muted, fontSize: 11, fontWeight: '700' },
    statValue: { color: palette.text.primary, fontSize: 18, fontWeight: '800' },
    statBonus: { color: palette.accent.emerald, fontSize: 11, fontWeight: '700' },
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
    chestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    chestLabel: { flex: 1, color: palette.text.primary, fontSize: 14, fontWeight: '600' },
    slotRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    slotLabel: { width: 44, color: palette.text.muted, fontSize: 12, fontWeight: '700' },
    slotItemName: { flex: 1, fontSize: 14, fontWeight: '700' },
    slotEmpty: { flex: 1, color: palette.text.muted, fontSize: 14 },
    itemRow: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: palette.bg.secondary, borderColor: palette.border.default, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9 },
    itemRowSelected: { borderColor: palette.accent.emerald },
    selectBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: palette.text.muted, alignItems: 'center', justifyContent: 'center' },
    selectBoxActive: { backgroundColor: palette.accent.emerald, borderColor: palette.accent.emerald },
    selectMark: { color: palette.bg.primary, fontSize: 13, fontWeight: '900' },
    itemName: { fontSize: 14, fontWeight: '700' },
    itemMeta: { color: palette.text.muted, fontSize: 11, marginTop: 2 },
    primaryButton: { height: 34, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.accent.emerald },
    primaryButtonText: { color: palette.bg.primary, fontSize: 13, fontWeight: '800' },
    secondaryButton: { height: 32, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.border.default },
    secondaryButtonText: { color: palette.text.primary, fontSize: 12, fontWeight: '700' },
    dangerButton: { height: 32, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg.tertiary, borderWidth: 1, borderColor: palette.text.danger },
    dangerButtonText: { color: palette.text.danger, fontSize: 12, fontWeight: '700' },
    muted: { opacity: 0.45 },
    });
}
