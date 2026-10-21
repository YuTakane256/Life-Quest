import { useRef, useState } from 'react';
import { Image, Keyboard, Pressable, Text, useWindowDimensions, View } from 'react-native';
import {
    Edit2,
    Gem,
    Milestone,
    Package,
    Shield,
    Sparkles,
    Sword,
} from 'lucide-react-native';
import { captureLoadoutActions, EQUIPMENT_SLOTS } from '@life-quest/core/equipment';
import { buildCharacterProfileUpdate, captureCharacterProfile, PROFILE_CHANGED_MESSAGE, type CharacterProfile } from '@life-quest/core/characterProfile';
import {
    calculateNextLevelXp,
    calculateXpProgress,
} from '@life-quest/core/progression';
import { getProgressBarA11y } from '@life-quest/core/progressA11y';
import { getUpcomingMilestones } from '@life-quest/core/rewards';
import { AVATAR_IMAGES, getChestImage, getItemImage } from '../assets/images';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { useMobileTitleStore } from '../stores/useMobileTitleStore';
import { characterOverviewStyles } from '../theme/characterOverviewStyles';
import { usePalette } from '../theme/usePalette';
import { CharacterProfileEditor } from './CharacterProfileEditor';
import { useInteractionScope } from '../hooks/useInteractionScope';

const slots = {
    weapon: { label: '武器', Icon: Sword },
    armor: { label: '防具', Icon: Shield },
    accessory: { label: 'アクセサリー', Icon: Gem },
};

export function CharacterOverview({
    openingChestId,
    errorChestId,
    onOpenChest,
    onRetryChest,
}: {
    openingChestId: string | null;
    errorChestId: string | null;
    onOpenChest: (id: string, label: string) => void;
    onRetryChest: () => void;
}) {
    const {
        character,
        equipment,
        gachaCount,
        chestQueue,
        getEffectiveStats,
        hasHydrated,
    } = useMobileGameStore();
    const activeTitle = useMobileTitleStore((state) => state.activeTitle);
    const { palette: p } = usePalette();
    const s = characterOverviewStyles(p);
    const { fontScale } = useWindowDimensions();
    type Owner = { isCurrent: () => boolean; accepts: ReturnType<typeof captureCharacterProfile> };
    const ownerRef = useRef<Owner | null>(null);
    const [draft, setDraft] = useState<(CharacterProfile & { owner: Owner; error: string }) | null>(null);
    const interactions = useInteractionScope(() => { ownerRef.current = null; setDraft(null); Keyboard.dismiss(); });
    const isCurrentLoadout = interactions.capture();
    const loadoutAction = captureLoadoutActions(equipment,
        () => useMobileGameStore.getState().equipment,
        () => isCurrentLoadout() && useMobileGameStore.getState().hasHydrated);
    const isCurrentDraft = () => draft !== null && ownerRef.current === draft.owner && draft.owner.isCurrent();
    const openEditor = () => {
        const current = useMobileGameStore.getState(); const accepts = captureCharacterProfile(character);
        if (!interactions.capture()() || !current.hasHydrated || !accepts(current.character)) return;
        const owner = { isCurrent: interactions.capture(), accepts };
        ownerRef.current = owner; setDraft({ name: character.name, avatar: character.avatar, owner, error: '' });
    };
    const stats = getEffectiveStats();
    const progress = calculateXpProgress(character.totalXp, character.level);
    const nextXp = calculateNextLevelXp(character.level);
    const xpA11y = getProgressBarA11y(
        Math.round(progress * 100),
        100,
        () => `${character.totalXp} / ${nextXp}`,
    );
    const upcoming = getUpcomingMilestones(gachaCount);
    const chests = chestQueue.filter((chest) => !chest.opened);
    const closeEditor = () => {
        if (!isCurrentDraft()) return;
        Keyboard.dismiss();
        ownerRef.current = null; setDraft(null);
    };
    const saveProfile = () => {
        if (!draft || !isCurrentDraft()) return;
        const current = useMobileGameStore.getState();
        if (!current.hasHydrated || !draft.owner.accepts(current.character)) {
            setDraft((value) => value?.owner === draft.owner ? { ...value, error: !current.hasHydrated ? '保存データを読み込み中です。完了後にもう一度保存してください。' : PROFILE_CHANGED_MESSAGE } : value); return;
        }
        ownerRef.current = null;
        current.updateCharacter(buildCharacterProfileUpdate(draft.name, draft.avatar));
        Keyboard.dismiss(); setDraft(null);
    };

    return (
        <View>
            <View style={s.profile}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="プロフィールを編集"
                    onPress={openEditor}
                    style={s.edit}
                >
                    <Edit2 size={16} color={p.text.muted} accessible={false} />
                </Pressable>
                <View style={s.profileRow}>
                    <View style={s.avatar}>
                        <Image
                            source={AVATAR_IMAGES[character.avatar]}
                            resizeMode="cover"
                            style={s.avatarImage}
                            accessibilityLabel="キャラクターのアバター画像"
                        />
                    </View>
                    <View style={s.profileInfo}>
                        <View style={s.nameRow}>
                            <Text style={s.name} numberOfLines={1}>
                                {character.name}
                            </Text>
                            <Text style={s.level}>Lv.{character.level}</Text>
                        </View>
                        {activeTitle && (
                            <Text style={s.title} numberOfLines={1}>
                                {activeTitle}
                            </Text>
                        )}
                        <View style={s.xp}>
                            <View
                                style={s.xpLabels}
                                accessibilityElementsHidden
                                importantForAccessibility="no-hide-descendants"
                            >
                                <Text style={s.muted}>XP</Text>
                                <Text style={s.muted}>
                                    {character.totalXp} / {nextXp}
                                </Text>
                            </View>
                            <View
                                testID="character-xp-value"
                                accessibilityRole="progressbar"
                                accessibilityLabel={`${character.name} の経験値`}
                                accessibilityValue={{
                                    min: 0,
                                    max: xpA11y.max,
                                    now: xpA11y.current,
                                    text: xpA11y.text,
                                }}
                                style={s.progressTrack}
                            >
                                <View
                                    style={[
                                        s.progressFill,
                                        { width: `${progress * 100}%` },
                                    ]}
                                />
                            </View>
                        </View>
                        <View style={s.statRow}>
                            {(
                                [
                                    ['攻撃', '⚔️', stats.attack],
                                    ['防御', '🛡️', stats.defense],
                                    ['HP', '❤️', stats.maxHp],
                                ] as const
                            ).map(([label, icon, value]) => (
                                <View
                                    key={label}
                                    style={s.stat}
                                    accessible
                                    accessibilityLabel={`${label} ${value}`}
                                >
                                    <Text style={s.statLabel} numberOfLines={1}>
                                        {icon} {label}
                                    </Text>
                                    <Text style={s.statValue}>{value}</Text>
                                </View>
                            ))}
                        </View>
                    </View>
                </View>
                <View style={s.countRow}>
                    <Text style={s.countLabel}>タスク消化数</Text>
                    <Text testID="character-task-count" style={s.count}>{gachaCount}</Text>
                </View>
            </View>
            <View style={s.roadmap}>
                <View style={s.headingRow}>
                    <Milestone
                        size={18}
                        color={p.accent.primary}
                        accessible={false}
                    />
                    <Text accessibilityRole="header" style={s.heading}>
                        宝箱ロードマップ
                    </Text>
                </View>
                <View style={s.milestones}>
                    <View style={s.milestoneLine} />
                    {upcoming.map((milestone, index) => (
                        <View
                            key={milestone.count}
                            style={s.milestone}
                            accessible
                            accessibilityLabel={`${milestone.count}個目 ${milestone.label}まで残り${milestone.count - gachaCount}`}
                        >
                            <Text style={s.remaining}>
                                残り {milestone.count - gachaCount}
                            </Text>
                            <View
                                style={[
                                    s.milestoneCircle,
                                    index === 0 && {
                                        borderColor: p.accent.gold,
                                    },
                                ]}
                            >
                                <Image
                                    source={getChestImage(milestone.chestType)!}
                                    resizeMode="contain"
                                    style={s.milestoneImage}
                                    accessible={false}
                                />
                            </View>
                            <Text
                                style={[
                                    s.milestoneText,
                                    index === 0 && { color: p.accent.gold },
                                ]}
                            >
                                {milestone.count}個目{'\n'}
                                {milestone.label}
                            </Text>
                        </View>
                    ))}
                </View>
            </View>
            {chests.length > 0 && (
                <View style={s.section}>
                    <View style={[s.headingRow, { marginBottom: 8 }]}>
                        <Package
                            size={18}
                            color={p.text.primary}
                            accessible={false}
                        />
                        <Text accessibilityRole="header" style={s.heading}>
                            未開封の宝箱 ({chests.length})
                        </Text>
                    </View>
                    <View style={s.chestList}>
                        {chests.map((chest) => (
                            <View key={chest.id}>
                                <Pressable
                                    accessibilityRole="button"
                                    accessibilityLabel={`${chest.label}を開封する`}
                                    disabled={openingChestId === chest.id}
                                    accessibilityState={{
                                        disabled: openingChestId === chest.id,
                                    }}
                                    onPress={() =>
                                        onOpenChest(chest.id, chest.label)
                                    }
                                    style={({ pressed }) => [
                                        s.chest,
                                        (pressed ||
                                            openingChestId === chest.id) && {
                                            opacity: 0.5,
                                        },
                                    ]}
                                >
                                    <Image
                                        source={getChestImage(chest.chestType)!}
                                        resizeMode="contain"
                                        style={s.chestImage}
                                        accessible={false}
                                    />
                                    <Text style={s.chestLabel}>
                                        {openingChestId === chest.id
                                            ? '開封中…'
                                            : chest.label}
                                    </Text>
                                </Pressable>
                                {errorChestId === chest.id && (
                                    <View>
                                        <Text style={s.failure}>
                                            開封に失敗しました。
                                        </Text>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="宝箱開封を再送する"
                                            onPress={onRetryChest}
                                        >
                                            <Text
                                                style={[
                                                    s.retry,
                                                    { textAlign: 'center' },
                                                ]}
                                            >
                                                再送
                                            </Text>
                                        </Pressable>
                                    </View>
                                )}
                            </View>
                        ))}
                    </View>
                </View>
            )}
            <View style={s.section}>
                <View style={s.sectionHeader}>
                    <Text accessibilityRole="header" style={s.heading}>
                        装備中
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="最強装備を自動装着"
                        disabled={!equipment.length || !hasHydrated}
                        onPress={loadoutAction(() => { useMobileGameStore.getState().autoEquipBest(); })}
                        style={({ pressed }) => [
                            s.autoEquip,
                            (pressed || !equipment.length) && { opacity: 0.4 },
                        ]}
                    >
                        <Sparkles
                            size={12}
                            color={p.accent.gold}
                            accessible={false}
                        />
                        <Text style={s.autoEquipText}>最強装備</Text>
                    </Pressable>
                </View>
                <View style={s.slots}>
                    {EQUIPMENT_SLOTS.map((slot) => {
                        const item = equipment.find(
                            (candidate) =>
                                candidate.equipped && candidate.slot === slot,
                        );
                        const { Icon, label } = slots[slot];
                        const image = item && getItemImage(item.templateId);
                        return (
                            <View
                                key={slot}
                                style={[
                                    s.slot,
                                    { flexBasis: 104 * Math.max(1, fontScale) },
                                    {
                                        borderColor: item
                                            ? p.rarity[item.rarity]
                                            : p.border.default,
                                    },
                                ]}
                            >
                                {image ? (
                                    <Image
                                        source={image}
                                        resizeMode="contain"
                                        style={s.itemImage}
                                        accessibilityLabel={item!.name}
                                    />
                                ) : (
                                    <View style={s.emptyIcon}>
                                        <Icon
                                            size={18}
                                            color={p.text.muted}
                                            accessible={false}
                                        />
                                    </View>
                                )}
                                <Text style={s.slotLabel}>{label}</Text>
                                {item ? (
                                    <>
                                        <Text
                                            style={[
                                                s.itemName,
                                                {
                                                    color: p.rarity[
                                                        item.rarity
                                                    ],
                                                },
                                            ]}
                                        >
                                            {item.name}
                                        </Text>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={`${label}の${item.name}を外す`}
                                            disabled={!hasHydrated}
                                            onPress={loadoutAction(() => useMobileGameStore.getState().unequipItem(item.id))}
                                            style={s.unequip}
                                        >
                                            <Text style={s.unequipText}>
                                                外す
                                            </Text>
                                        </Pressable>
                                    </>
                                ) : (
                                    <Text style={s.noItem}>なし</Text>
                                )}
                            </View>
                        );
                    })}
                </View>
            </View>
            {draft && (
                <CharacterProfileEditor
                    name={draft.name}
                    avatar={draft.avatar}
                    error={draft.error}
                    onNameChange={(name) => { if (isCurrentDraft()) setDraft((value) => value?.owner === draft.owner ? { ...value, name } : value); }}
                    onAvatarChange={(avatar) => { if (isCurrentDraft()) setDraft((value) => value?.owner === draft.owner ? { ...value, avatar } : value); }}
                    onSave={saveProfile}
                    onClose={closeEditor}
                />
            )}
        </View>
    );
}
