import { useMemo, useState } from 'react';
import { Check, Edit2, History, Milestone, Package, Sparkles, X } from 'lucide-react';
import { useGameStore, calculateXpProgress, calculateNextLevelXp } from '../stores/useGameStore';
import { GACHA_CONFIG } from '../config/gameConfig';
import { ITEM_IMAGES, CHEST_IMAGES, CHEST_FALLBACK_IMAGE, RARITY_COLORS } from '../config/equipmentAssets';
import type { Equipment, EquipmentSlot } from '../types';
import heroImg from '../assets/images/hero.png';
import heroMaleImg from '../assets/images/hero_male.png';
import { useModalEscape } from '../hooks/useModalEscape';
import { useTitleStore } from '../stores/useTitleStore';
import { InventorySection } from '../components/character/InventorySection';
import { SLOT_ICONS, SLOT_LABELS } from '../components/character/equipmentPresentation';

export { InventoryPage } from '../components/character/InventorySection';

function getUpcomingMilestones(currentCount: number, limit: number = 3) {
    const upcoming: { count: number; chestType: string; label: string }[] = [];
    let checkCount = currentCount + 1;

    while (upcoming.length < limit && checkCount < currentCount + 1000) {
        const specialKeys = Object.keys(GACHA_CONFIG.SPECIAL_MILESTONES).map(Number);
        if (specialKeys.includes(checkCount)) {
            const special = GACHA_CONFIG.SPECIAL_MILESTONES[checkCount as keyof typeof GACHA_CONFIG.SPECIAL_MILESTONES];
            upcoming.push({ count: checkCount, chestType: special.chestType, label: special.label });
            checkCount += 1;
            continue;
        }

        const posInCycle = checkCount <= 100 ? checkCount : ((checkCount - 1) % GACHA_CONFIG.CYCLE_LENGTH) + 1;
        const milestone = GACHA_CONFIG.MILESTONES.find((candidate) => candidate.count === posInCycle);
        if (milestone) {
            upcoming.push({ count: checkCount, chestType: milestone.chestType, label: milestone.label });
        }
        checkCount += 1;
    }
    return upcoming;
}

function calculateEffectiveStats(
    character: { baseAttack: number; baseDefense: number; baseMaxHp: number },
    equipment: Equipment[],
) {
    const equippedItems = equipment.filter((item) => item.equipped);
    return {
        attack: character.baseAttack + equippedItems.reduce((sum, item) => sum + item.attackBonus, 0),
        defense: character.baseDefense + equippedItems.reduce((sum, item) => sum + item.defenseBonus, 0),
        maxHp: character.baseMaxHp + equippedItems.reduce((sum, item) => sum + item.hpBonus, 0),
    };
}

export function CharacterPage() {
    const character = useGameStore((state) => state.character);
    const debuff = useGameStore((state) => state.debuff);
    const equipment = useGameStore((state) => state.equipment);
    const gachaCount = useGameStore((state) => state.gachaCount);
    const chestQueue = useGameStore((state) => state.chestQueue);
    const unequipItem = useGameStore((state) => state.unequipItem);
    const openChest = useGameStore((state) => state.openChest);
    const updateCharacter = useGameStore((state) => state.updateCharacter);
    const autoEquipBest = useGameStore((state) => state.autoEquipBest);
    const activeTitle = useTitleStore((state) => state.activeTitle);

    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [editName, setEditName] = useState(character.name);
    const [editAvatar, setEditAvatar] = useState(character.avatar);

    const effectiveStats = useMemo(() => calculateEffectiveStats(character, equipment), [character, equipment]);
    const xpProgress = useMemo(() => calculateXpProgress(character.totalXp, character.level), [character.totalXp, character.level]);
    const nextLevelXp = useMemo(() => calculateNextLevelXp(character.level), [character.level]);
    const equippedItems = useMemo(() => equipment.filter((item) => item.equipped), [equipment]);
    const unopenedChests = useMemo(() => chestQueue.filter((chest) => !chest.opened), [chestQueue]);
    const openedChests = useMemo(() => [...chestQueue].filter((chest) => chest.opened).reverse(), [chestQueue]);
    const upcomingMilestones = useMemo(() => getUpcomingMilestones(gachaCount, 3), [gachaCount]);

    useModalEscape(isEditingProfile, () => setIsEditingProfile(false));

    return (
        <div className="app-page max-w-lg mx-auto px-5 pt-6 pb-28">
            <div className="rounded-2xl p-5 mb-4 relative" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', filter: debuff.active ? 'brightness(0.7)' : undefined }}>
                <button
                    onClick={() => { setEditName(character.name); setEditAvatar(character.avatar); setIsEditingProfile(true); }}
                    aria-label="プロフィールを編集"
                    className="absolute top-4 right-4 p-2 rounded-lg transition-colors z-10"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}
                >
                    <Edit2 size={16} />
                </button>
                <div className="flex items-start gap-4">
                    <div className="w-24 h-24 rounded-xl flex items-center justify-center flex-shrink-0 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, var(--color-accent-primary), var(--color-accent-secondary))' }}>
                        <img src={character.avatar === 'male' ? heroMaleImg : heroImg} alt="Hero" className="w-full h-full object-cover" />
                        {debuff.active && <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-xs" style={{ backgroundColor: 'var(--color-text-danger)' }}>💀</div>}
                    </div>
                    <div className="flex-1 pr-6">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="text-base font-bold truncate" style={{ color: 'var(--color-text-primary)' }}>{character.name}</span>
                            <span className="text-sm font-bold" style={{ color: 'var(--color-accent-gold)' }}>Lv.{character.level}</span>
                            {debuff.active && <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-text-danger)', color: 'white' }}>デバフ中</span>}
                        </div>
                        {activeTitle && <div className="text-[11px] font-semibold mb-1 truncate" style={{ color: 'var(--color-accent-gold)' }}>{activeTitle}</div>}
                        <div className="mb-2">
                            <div className="flex justify-between text-xs mb-0.5" style={{ color: 'var(--color-text-muted)' }}>
                                <span>XP</span><span>{character.totalXp} / {nextLevelXp}</span>
                            </div>
                            <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${xpProgress * 100}%`, background: 'linear-gradient(90deg, var(--color-accent-primary), var(--color-accent-gold))' }} />
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <StatBadge label="攻撃" value={effectiveStats.attack} icon="⚔️" />
                            <StatBadge label="防御" value={effectiveStats.defense} icon="🛡️" />
                            <StatBadge label="HP" value={effectiveStats.maxHp} icon="❤️" />
                        </div>
                    </div>
                </div>
                <div className="mt-4 pt-3 flex items-center justify-between" style={{ borderTop: '1px solid var(--color-border-default)' }}>
                    <span className="text-sm" style={{ color: 'var(--color-text-muted)' }}>タスク消化数</span>
                    <span className="text-base font-bold" style={{ color: 'var(--color-accent-gold)' }}>{gachaCount}</span>
                </div>
            </div>

            <div className="mb-6">
                <h2 className="text-base font-semibold mb-3 flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}>
                    <Milestone size={18} style={{ color: 'var(--color-accent-primary)' }} /> 宝箱ロードマップ
                </h2>
                <div className="flex justify-between items-end relative px-2">
                    <div className="absolute left-6 right-6 top-6 h-0.5" style={{ backgroundColor: 'var(--color-border-default)', zIndex: 0 }} />
                    {upcomingMilestones.map((milestone, index) => (
                        <div key={milestone.count} className="relative z-10 flex flex-col items-center flex-1">
                            <div className="text-[10px] font-bold mb-1 px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}>
                                残り {milestone.count - gachaCount}
                            </div>
                            <div className="w-12 h-12 rounded-full flex items-center justify-center mb-1 shadow-md transition-transform hover:scale-110" style={{ backgroundColor: 'var(--color-bg-card)', border: `2px solid ${index === 0 ? 'var(--color-accent-gold)' : 'var(--color-border-default)'}` }}>
                                <img src={CHEST_IMAGES[milestone.chestType as keyof typeof CHEST_IMAGES] || CHEST_FALLBACK_IMAGE} alt={milestone.label} className="w-8 h-8 object-contain" />
                            </div>
                            <div className="text-[10px] text-center leading-tight font-medium" style={{ color: index === 0 ? 'var(--color-accent-gold)' : 'var(--color-text-secondary)' }}>
                                {milestone.count}個目<br />{milestone.label}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {unopenedChests.length > 0 && (
                <div className="mb-4">
                    <h2 className="text-base font-semibold mb-2 flex items-center gap-1" style={{ color: 'var(--color-text-primary)' }}>
                        <Package size={18} />未開封の宝箱 ({unopenedChests.length})
                    </h2>
                    <div className="flex flex-wrap gap-2">
                        {unopenedChests.map((chest) => (
                            <button key={chest.id} onClick={() => openChest(chest.id)} className="px-4 py-3 rounded-xl animate-pulse-glow transition-all hover:scale-105 flex flex-col items-center" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-accent-gold)', minWidth: '120px' }}>
                                <img src={CHEST_IMAGES[chest.chestType] || CHEST_FALLBACK_IMAGE} alt={chest.label} className="w-14 h-14 object-contain mb-1" />
                                <div className="text-xs font-medium" style={{ color: 'var(--color-accent-gold)' }}>{chest.label}</div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                    <h2 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>装備中</h2>
                    <button onClick={autoEquipBest} disabled={equipment.length === 0} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg transition-opacity hover:opacity-80 disabled:opacity-40" style={{ backgroundColor: 'var(--color-bg-card)', color: 'var(--color-accent-gold)', border: '1px solid var(--color-border-default)' }} aria-label="最強装備を自動装着">
                        <Sparkles size={12} /> 最強装備
                    </button>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                    {(['weapon', 'armor', 'accessory'] as EquipmentSlot[]).map((slot) => {
                        const item = equippedItems.find((candidate) => candidate.slot === slot);
                        return (
                            <div key={slot} className="rounded-xl p-3.5 text-center" style={{ backgroundColor: 'var(--color-bg-card)', border: `1px solid ${item ? RARITY_COLORS[item.rarity] : 'var(--color-border-default)'}` }}>
                                <div className="flex justify-center mb-1 h-10 items-center">
                                    {item && ITEM_IMAGES[item.templateId] ? <img src={ITEM_IMAGES[item.templateId]} alt={item.name} className="w-10 h-10 object-contain drop-shadow" /> : <div className="opacity-70">{SLOT_ICONS[slot]}</div>}
                                </div>
                                <div className="text-xs mb-1 leading-none" style={{ color: 'var(--color-text-muted)' }}>{SLOT_LABELS[slot]}</div>
                                {item ? (
                                    <>
                                        <div className="text-sm font-medium truncate" style={{ color: RARITY_COLORS[item.rarity] }}>{item.name}</div>
                                        <button onClick={() => unequipItem(item.id)} className="text-xs mt-1 px-2 py-0.5 rounded" style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg-secondary)' }}>外す</button>
                                    </>
                                ) : <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>なし</div>}
                            </div>
                        );
                    })}
                </div>
            </div>

            <InventorySection visibleLimit={5} showViewAll />

            {openedChests.length > 0 && (
                <div className="mb-4 mt-4">
                    <h2 className="text-base font-semibold mb-2 flex items-center gap-1" style={{ color: 'var(--color-text-primary)' }}>
                        <History size={18} />獲得履歴 ({openedChests.length})
                    </h2>
                    <div className="rounded-xl" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', maxHeight: '320px', overflowY: 'auto' }}>
                        {openedChests.map((chest, index) => (
                            <div key={chest.id} className="flex items-center gap-3 px-3 py-2.5" style={{ borderTop: index === 0 ? 'none' : '1px solid var(--color-border-default)' }}>
                                <img src={CHEST_IMAGES[chest.chestType] || CHEST_FALLBACK_IMAGE} alt={chest.label} className="w-8 h-8 object-contain flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{chest.label}</div>
                                    {chest.equipment ? (
                                        <div className="text-sm font-medium truncate" style={{ color: RARITY_COLORS[chest.equipment.rarity] }}>{chest.equipment.name}</div>
                                    ) : chest.isStarterCharacter ? (
                                        <div className="text-sm font-medium" style={{ color: 'var(--color-accent-primary)' }}>キャラクター獲得</div>
                                    ) : <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>—</div>}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {isEditingProfile && (
                <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}>
                    <div role="dialog" aria-modal="true" aria-labelledby="profile-edit-title" className="w-full max-w-sm rounded-2xl p-5 animate-scale-in" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 id="profile-edit-title" className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>プロフィール編集</h3>
                            <button onClick={() => setIsEditingProfile(false)} aria-label="プロフィール編集を閉じる" className="p-1 rounded-lg" style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg-secondary)' }}><X size={20} /></button>
                        </div>
                        <div className="mb-4">
                            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>名前</label>
                            <input type="text" value={editName} onChange={(event) => setEditName(event.target.value)} className="w-full px-3 py-2.5 rounded-xl text-base outline-none" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }} placeholder="名前を入力" maxLength={12} />
                        </div>
                        <div className="mb-6">
                            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>アバター</label>
                            <div className="grid grid-cols-2 gap-3">
                                <AvatarOption avatar="female" selected={editAvatar === 'female'} image={heroImg} label="女性" onSelect={setEditAvatar} />
                                <AvatarOption avatar="male" selected={editAvatar === 'male'} image={heroMaleImg} label="男性" onSelect={setEditAvatar} />
                            </div>
                        </div>
                        <button onClick={() => { updateCharacter({ name: editName || '名無し', avatar: editAvatar }); setIsEditingProfile(false); }} className="w-full py-3 rounded-xl text-base font-bold flex flex-col items-center gap-2 transition-transform active:scale-95" style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>
                            保存する
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function AvatarOption({ avatar, selected, image, label, onSelect }: {
    avatar: 'female' | 'male';
    selected: boolean;
    image: string;
    label: string;
    onSelect: (avatar: 'female' | 'male') => void;
}) {
    return (
        <button onClick={() => onSelect(avatar)} className="p-3 rounded-xl border flex flex-col items-center gap-2 transition-all relative" style={{ backgroundColor: selected ? 'var(--color-bg-secondary)' : 'transparent', borderColor: selected ? 'var(--color-accent-primary)' : 'var(--color-border-default)' }}>
            <div className="w-14 h-14 rounded-lg overflow-hidden" style={{ background: 'linear-gradient(135deg, var(--color-accent-primary), var(--color-accent-secondary))' }}>
                <img src={image} alt={`${label} option`} className="w-full h-full object-cover" />
            </div>
            <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>{label}</span>
            {selected && <Check size={14} className="absolute top-2 right-2" style={{ color: 'var(--color-accent-primary)' }} />}
        </button>
    );
}

function StatBadge({ label, value, icon }: { label: string; value: number; icon: string }) {
    return (
        <div className="rounded-lg px-2 py-2" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
            <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{icon} {label}</div>
            <div className="text-base font-bold" style={{ color: 'var(--color-text-primary)' }}>{value}</div>
        </div>
    );
}
