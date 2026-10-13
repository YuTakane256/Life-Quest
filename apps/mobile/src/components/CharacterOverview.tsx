import { useState } from 'react';
import { Image, Keyboard, Pressable, Text, View } from 'react-native';
import {
    Check,
    Edit2,
    Gem,
    Milestone,
    Package,
    Shield,
    Sparkles,
    Sword,
} from 'lucide-react-native';
import { EQUIPMENT_SLOTS } from '@life-quest/core/equipment';
import { GAME_STATE_LIMITS, type AvatarId } from '@life-quest/core/gameState';
import {
    calculateNextLevelXp,
    calculateXpProgress,
} from '@life-quest/core/progression';
import { getProgressBarA11y } from '@life-quest/core/progressA11y';
import { getUpcomingMilestones } from '@life-quest/core/rewards';
import { AVATAR_IMAGES, getChestImage, getItemImage } from '../assets/images';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { useMobileTitleStore } from '../stores/useMobileTitleStore';
import { buildCharacterProfileUpdate } from '../screens/characterScreenModel';
import { characterOverviewStyles } from '../theme/characterOverviewStyles';
import { usePalette } from '../theme/usePalette';
import { Dialog, Field } from './DailyScreenUI';

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
        autoEquipBest,
        unequipItem,
    } = useMobileGameStore();
    const activeTitle = useMobileTitleStore((state) => state.activeTitle);
    const { palette: p } = usePalette();
    const s = characterOverviewStyles(p);
    const [editing, setEditing] = useState(false);
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
        Keyboard.dismiss();
        setEditing(false);
    };

    return (
        <View>
            <View style={s.profile}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="プロフィールを編集"
                    onPress={() => setEditing(true)}
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
                        disabled={!equipment.length}
                        onPress={autoEquipBest}
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
                                            numberOfLines={1}
                                        >
                                            {item.name}
                                        </Text>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel={`${label}の${item.name}を外す`}
                                            onPress={() => unequipItem(item.id)}
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
            {editing && (
                <ProfileEditor
                    name={character.name}
                    avatar={character.avatar}
                    onClose={closeEditor}
                />
            )}
        </View>
    );
}

function ProfileEditor({
    name,
    avatar,
    onClose,
}: {
    name: string;
    avatar: AvatarId;
    onClose: () => void;
}) {
    const [draftName, setDraftName] = useState(name);
    const [draftAvatar, setDraftAvatar] = useState(avatar);
    const { palette: p } = usePalette();
    const s = characterOverviewStyles(p);
    const save = () => {
        useMobileGameStore
            .getState()
            .updateCharacter(
                buildCharacterProfileUpdate(draftName, draftAvatar),
            );
        onClose();
    };
    return (
        <Dialog title="プロフィール編集" onClose={onClose}>
            <Text style={s.editorLabel}>名前</Text>
            <Field
                accessibilityLabel="キャラクター名"
                value={draftName}
                onChangeText={setDraftName}
                maxLength={GAME_STATE_LIMITS.maxCharacterNameLength}
                placeholder="名前を入力"
                style={s.editorInput}
            />
            <Text style={s.editorLabel}>アバター</Text>
            <View style={s.avatarOptions}>
                {(['female', 'male'] as const).map((option) => {
                    const selected = draftAvatar === option;
                    const label = option === 'female' ? '女性' : '男性';
                    return (
                        <Pressable
                            key={option}
                            accessibilityRole="radio"
                            accessibilityLabel={`アバターを${label}にする`}
                            accessibilityState={{ selected }}
                            onPress={() => setDraftAvatar(option)}
                            style={[
                                s.avatarOption,
                                {
                                    borderColor: selected
                                        ? p.accent.primary
                                        : p.border.default,
                                    backgroundColor: selected
                                        ? p.bg.secondary
                                        : 'transparent',
                                },
                            ]}
                        >
                            <View style={[s.avatar, s.editorAvatar]}>
                                <Image
                                    source={AVATAR_IMAGES[option]}
                                    style={s.avatarImage}
                                    accessible={false}
                                />
                            </View>
                            <Text style={s.countLabel}>{label}</Text>
                            {selected && (
                                <Check
                                    size={14}
                                    color={p.accent.primary}
                                    style={{
                                        position: 'absolute',
                                        top: 8,
                                        right: 8,
                                    }}
                                    accessible={false}
                                />
                            )}
                        </Pressable>
                    );
                })}
            </View>
            <Pressable
                accessibilityRole="button"
                onPress={save}
                style={s.editorSave}
            >
                <Text style={s.editorSaveText}>保存する</Text>
            </Pressable>
        </Dialog>
    );
}
