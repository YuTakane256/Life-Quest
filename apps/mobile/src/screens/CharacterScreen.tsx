import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EQUIPMENT_SLOTS, type Equipment, type EquipmentSlot, type Rarity } from '@life-quest/core/equipment';
import { calculateNextLevelXp, calculateXpProgress } from '@life-quest/core/progression';
import { SELL_XP_BY_RARITY, SYNTHESIS_CONFIG } from '@life-quest/core/rewards';
import { useMobileGameStore } from '../stores/useMobileGameStore';

const RARITY_LABELS: Record<Rarity, string> = {
    common: 'コモン',
    uncommon: 'アンコモン',
    rare: 'レア',
    epic: 'エピック',
    legendary: 'レジェンダリー',
};

const RARITY_COLORS: Record<Rarity, string> = {
    common: '#9aa4b5',
    uncommon: '#43d6a2',
    rare: '#4aa3e8',
    epic: '#b06ce8',
    legendary: '#e5b85c',
};

const SLOT_LABELS: Record<EquipmentSlot, string> = {
    weapon: '武器',
    armor: '防具',
    accessory: '装飾',
};

const AVATAR_OPTIONS = [
    { id: 'female', label: '女性', symbol: '👩' },
    { id: 'male', label: '男性', symbol: '👨' },
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

    const [nameDraft, setNameDraft] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
    const [lastRevealText, setLastRevealText] = useState<string | null>(null);

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
        () => [...equipment].sort((a, b) => a.slot.localeCompare(b.slot) || a.name.localeCompare(b.name)),
        [equipment],
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
            <Text style={styles.title}>キャラクター</Text>

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
                        <Text style={styles.avatarSymbol}>
                            {AVATAR_OPTIONS.find((option) => option.id === character.avatar)?.symbol ?? '👩'}
                        </Text>
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
                            <Text style={[styles.segmentText, character.avatar === option.id && styles.segmentTextActive]}>
                                {option.symbol} {option.label}
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
                    <StatCell label="攻撃" base={character.baseAttack} effective={stats.attack} />
                    <StatCell label="防御" base={character.baseDefense} effective={stats.defense} />
                    <StatCell label="HP" base={character.baseMaxHp} effective={stats.maxHp} />
                </View>
            </View>

            {/* 宝箱 */}
            {unopenedChests.length > 0 && (
                <View style={styles.card}>
                    <Text style={styles.sectionTitle}>宝箱（{unopenedChests.length}）</Text>
                    {unopenedChests.map((chest) => (
                        <View key={chest.id} style={styles.chestRow}>
                            <Text style={styles.chestLabel}>🎁 {chest.label}</Text>
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
                                <Text style={[styles.slotItemName, { color: RARITY_COLORS[item.rarity] }]} numberOfLines={1}>
                                    {item.name}
                                </Text>
                            ) : (
                                <Text style={styles.slotEmpty}>なし</Text>
                            )}
                        </View>
                    );
                })}
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
                    />
                )}
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
            />
        </SafeAreaView>
    );
}

function InventoryRow({
    item,
    selected,
    onToggleSelect,
    onEquipToggle,
    onSell,
}: {
    item: Equipment;
    selected: boolean;
    onToggleSelect: (item: Equipment) => void;
    onEquipToggle: (item: Equipment) => void;
    onSell: (item: Equipment) => void;
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
            <View style={styles.flex}>
                <Text style={[styles.itemName, { color: RARITY_COLORS[item.rarity] }]} numberOfLines={1}>
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

function StatCell({ label, base, effective }: { label: string; base: number; effective: number }) {
    const bonus = effective - base;
    return (
        <View style={styles.statCell}>
            <Text style={styles.statLabel}>{label}</Text>
            <Text style={styles.statValue}>{effective}</Text>
            {bonus > 0 && <Text style={styles.statBonus}>+{bonus}</Text>}
        </View>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    safeArea: { flex: 1, backgroundColor: '#0e1017' },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    loadingText: { color: '#737d90', fontSize: 14, fontWeight: '600' },
    // タブレット幅でも読みやすいよう本文幅を制限して中央寄せする
    listContent: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 20, paddingBottom: 32, gap: 8 },
    headerContent: { gap: 14, marginBottom: 6 },
    title: { color: '#f6f7fb', fontSize: 28, fontWeight: '800', paddingTop: 20 },
    banner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#22301f', borderColor: '#3f6e35', borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
    bannerText: { flex: 1, color: '#bfe8a8', fontSize: 13, fontWeight: '600', lineHeight: 19 },
    bannerClose: { color: '#8fae7f', fontSize: 21, lineHeight: 23 },
    card: { backgroundColor: '#1a1e28', borderColor: '#303746', borderWidth: 1, borderRadius: 10, padding: 16, gap: 10 },
    profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    avatarCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#292e3a', alignItems: 'center', justifyContent: 'center' },
    avatarSymbol: { fontSize: 30 },
    nameInput: { color: '#f6f7fb', fontSize: 18, fontWeight: '700', borderBottomWidth: 1, borderBottomColor: '#343b49', paddingVertical: 4, paddingHorizontal: 0 },
    levelText: { color: '#e5b85c', fontSize: 13, fontWeight: '800', marginTop: 4 },
    avatarSwitch: { flexDirection: 'row', backgroundColor: '#181b24', borderRadius: 8, padding: 3 },
    segment: { flex: 1, height: 34, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
    segmentActive: { backgroundColor: '#303746' },
    segmentText: { color: '#7e8799', fontSize: 12, fontWeight: '700' },
    segmentTextActive: { color: '#f6f7fb' },
    progressTrack: { height: 10, borderRadius: 5, backgroundColor: '#292e3a', overflow: 'hidden' },
    progressFill: { height: '100%', borderRadius: 5, backgroundColor: '#28b987' },
    progressText: { color: '#929bad', fontSize: 12 },
    statsRow: { flexDirection: 'row', gap: 8 },
    statCell: { flex: 1, backgroundColor: '#181b24', borderRadius: 8, paddingVertical: 10, alignItems: 'center', gap: 2 },
    statLabel: { color: '#7e8799', fontSize: 11, fontWeight: '700' },
    statValue: { color: '#f6f7fb', fontSize: 18, fontWeight: '800' },
    statBonus: { color: '#43d6a2', fontSize: 11, fontWeight: '700' },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    sectionTitle: { color: '#f6f7fb', fontSize: 16, fontWeight: '800' },
    hint: { color: '#737d90', fontSize: 11, lineHeight: 16 },
    emptyText: { color: '#737d90', fontSize: 13, paddingVertical: 8 },
    chestRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    chestLabel: { flex: 1, color: '#e5e8ef', fontSize: 14, fontWeight: '600' },
    slotRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    slotLabel: { width: 44, color: '#7e8799', fontSize: 12, fontWeight: '700' },
    slotItemName: { flex: 1, fontSize: 14, fontWeight: '700' },
    slotEmpty: { flex: 1, color: '#4d5568', fontSize: 14 },
    itemRow: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#181b24', borderColor: '#303746', borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9 },
    itemRowSelected: { borderColor: '#28b987' },
    selectBox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: '#6d778a', alignItems: 'center', justifyContent: 'center' },
    selectBoxActive: { backgroundColor: '#28b987', borderColor: '#28b987' },
    selectMark: { color: '#07150f', fontSize: 13, fontWeight: '900' },
    itemName: { fontSize: 14, fontWeight: '700' },
    itemMeta: { color: '#737d90', fontSize: 11, marginTop: 2 },
    primaryButton: { height: 34, paddingHorizontal: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#28b987' },
    primaryButtonText: { color: '#07150f', fontSize: 13, fontWeight: '800' },
    secondaryButton: { height: 32, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#303746' },
    secondaryButtonText: { color: '#e5e8ef', fontSize: 12, fontWeight: '700' },
    dangerButton: { height: 32, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3a2328', borderWidth: 1, borderColor: '#5c333b' },
    dangerButtonText: { color: '#e07178', fontSize: 12, fontWeight: '700' },
    muted: { opacity: 0.45 },
});
