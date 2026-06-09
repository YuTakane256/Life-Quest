import { useGameStore, calculateXpProgress, calculateNextLevelXp } from '../stores/useGameStore';
import { SELL_XP_BY_RARITY, RARITY_ORDER, SYNTHESIS_CONFIG, GACHA_CONFIG } from '../config/gameConfig';
import { ITEM_IMAGES, CHEST_IMAGES, CHEST_FALLBACK_IMAGE, RARITY_COLORS, RARITY_LABELS } from '../config/equipmentAssets';
import type { Equipment, Rarity, EquipmentSlot } from '../types';
import { Shield, Sword, Gem, Package, Star, Edit2, X, Check, Coins, Merge, Sparkles, Milestone, ChevronRight, ArrowLeft, History } from 'lucide-react';
import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import heroImg from '../assets/images/hero.png';
import heroMaleImg from '../assets/images/hero_male.png';
import { useModalEscape } from '../hooks/useModalEscape';

const SLOT_LABELS: Record<EquipmentSlot, string> = { weapon: '武器', armor: '防具', accessory: 'アクセサリー' };
const SLOT_ICONS: Record<EquipmentSlot, React.ReactNode> = { weapon: <Sword size={18} />, armor: <Shield size={18} />, accessory: <Gem size={18} /> };

function getUpcomingMilestones(currentCount: number, limit: number = 3) {
    const upcoming: { count: number; chestType: string; label: string }[] = [];
    let checkCount = currentCount + 1;
    
    while (upcoming.length < limit && checkCount < currentCount + 1000) {
        const specialKeys = Object.keys(GACHA_CONFIG.SPECIAL_MILESTONES).map(Number);
        if (specialKeys.includes(checkCount)) {
            const special = GACHA_CONFIG.SPECIAL_MILESTONES[checkCount as keyof typeof GACHA_CONFIG.SPECIAL_MILESTONES];
            upcoming.push({ count: checkCount, chestType: special.chestType, label: special.label });
            checkCount++;
            continue;
        }
        
        const posInCycle = checkCount <= 100 ? checkCount : ((checkCount - 1) % GACHA_CONFIG.CYCLE_LENGTH) + 1;
        const milestone = GACHA_CONFIG.MILESTONES.find((m) => m.count === posInCycle);
        if (milestone) {
            upcoming.push({ count: checkCount, chestType: milestone.chestType, label: milestone.label });
        }
        
        checkCount++;
    }
    return upcoming;
}

type InventoryMode = 'normal' | 'sell' | 'synthesize';

export function CharacterPage() {
    // 個別 selector で必要なフィールドのみ subscribe → バトル中の不要な再レンダリングを防ぐ
    const character = useGameStore((s) => s.character);
    const debuff = useGameStore((s) => s.debuff);
    const equipment = useGameStore((s) => s.equipment);
    const gachaCount = useGameStore((s) => s.gachaCount);
    const chestQueue = useGameStore((s) => s.chestQueue);
    const unequipItem = useGameStore((s) => s.unequipItem);
    const openChest = useGameStore((s) => s.openChest);
    const getEffectiveStats = useGameStore((s) => s.getEffectiveStats);
    const updateCharacter = useGameStore((s) => s.updateCharacter);
    const autoEquipBest = useGameStore((s) => s.autoEquipBest);

    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [editName, setEditName] = useState(character.name);
    const [editAvatar, setEditAvatar] = useState(character.avatar);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const effectiveStats = useMemo(() => getEffectiveStats(), [getEffectiveStats, equipment, character, debuff]);
    const xpProgress = useMemo(() => calculateXpProgress(character.totalXp, character.level), [character.totalXp, character.level]);
    const nextLevelXp = useMemo(() => calculateNextLevelXp(character.level), [character.level]);
    const equippedItems = useMemo(() => equipment.filter((e) => e.equipped), [equipment]);
    const unopenedChests = useMemo(() => chestQueue.filter((c) => !c.opened), [chestQueue]);
    // 開封済みの宝箱を新しい順に並べた獲得履歴（chestQueue は古い順に追加されている）
    const openedChests = useMemo(() => [...chestQueue].filter((c) => c.opened).reverse(), [chestQueue]);
    const upcomingMilestones = useMemo(() => getUpcomingMilestones(gachaCount, 3), [gachaCount]);

    useModalEscape(isEditingProfile, () => setIsEditingProfile(false));

    return (
        <div className="max-w-lg mx-auto px-5 pt-6 pb-28">
            {/* キャラクターカード */}
            <div className="rounded-2xl p-5 mb-4 relative" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', filter: debuff.active ? 'brightness(0.7)' : undefined }}>
                <button onClick={() => { setEditName(character.name); setEditAvatar(character.avatar); setIsEditingProfile(true); }}
                    aria-label="プロフィールを編集"
                    className="absolute top-4 right-4 p-2 rounded-lg transition-colors z-10"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}>
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

            {/* 宝箱ロードマップ */}
            <div className="mb-6">
                <h2 className="text-base font-semibold mb-3 flex items-center gap-1.5" style={{ color: 'var(--color-text-primary)' }}>
                    <Milestone size={18} style={{ color: 'var(--color-accent-primary)' }} /> 宝箱ロードマップ
                </h2>
                <div className="flex justify-between items-end relative px-2">
                    {/* 背景の線 */}
                    <div className="absolute left-6 right-6 top-6 h-0.5" style={{ backgroundColor: 'var(--color-border-default)', zIndex: 0 }}></div>
                    
                    {upcomingMilestones.map((m, idx) => {
                        const remaining = m.count - gachaCount;
                        return (
                            <div key={m.count} className="relative z-10 flex flex-col items-center flex-1">
                                <div className="text-[10px] font-bold mb-1 px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}>
                                    残り {remaining}
                                </div>
                                <div className="w-12 h-12 rounded-full flex items-center justify-center mb-1 shadow-md transition-transform hover:scale-110" style={{ backgroundColor: 'var(--color-bg-card)', border: `2px solid ${idx === 0 ? 'var(--color-accent-gold)' : 'var(--color-border-default)'}` }}>
                                    <img src={CHEST_IMAGES[m.chestType as keyof typeof CHEST_IMAGES] || CHEST_FALLBACK_IMAGE} alt={m.label} className="w-8 h-8 object-contain" />
                                </div>
                                <div className="text-[10px] text-center leading-tight font-medium" style={{ color: idx === 0 ? 'var(--color-accent-gold)' : 'var(--color-text-secondary)' }}>
                                    {m.count}個目<br />{m.label}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 未開封の宝箱 */}
            {unopenedChests.length > 0 && (
                <div className="mb-4">
                    <h2 className="text-base font-semibold mb-2 flex items-center gap-1" style={{ color: 'var(--color-text-primary)' }}>
                        <Package size={18} />未開封の宝箱 ({unopenedChests.length})
                    </h2>
                    <div className="flex flex-wrap gap-2">
                        {unopenedChests.map((chest) => (
                            <button key={chest.id} onClick={() => openChest(chest.id)}
                                className="px-4 py-3 rounded-xl animate-pulse-glow transition-all hover:scale-105 flex flex-col items-center"
                                style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-accent-gold)', minWidth: '120px' }}>
                                <img src={CHEST_IMAGES[chest.chestType] || CHEST_FALLBACK_IMAGE} alt={chest.label} className="w-14 h-14 object-contain mb-1" />
                                <div className="text-xs font-medium" style={{ color: 'var(--color-accent-gold)' }}>{chest.label}</div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* 装備中 */}
            <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                    <h2 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>装備中</h2>
                    <button
                        onClick={autoEquipBest}
                        disabled={equipment.length === 0}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg transition-opacity hover:opacity-80 disabled:opacity-40"
                        style={{ backgroundColor: 'var(--color-bg-card)', color: 'var(--color-accent-gold)', border: '1px solid var(--color-border-default)' }}
                        aria-label="最強装備を自動装着"
                    >
                        <Sparkles size={12} /> 最強装備
                    </button>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                    {(['weapon', 'armor', 'accessory'] as EquipmentSlot[]).map((slot) => {
                        const item = equippedItems.find((e) => e.slot === slot);
                        return (
                            <div key={slot} className="rounded-xl p-3.5 text-center" style={{ backgroundColor: 'var(--color-bg-card)', border: `1px solid ${item ? RARITY_COLORS[item.rarity] : 'var(--color-border-default)'}` }}>
                                <div className="flex justify-center mb-1 h-10 items-center">
                                    {item && ITEM_IMAGES[item.templateId] ? (
                                        <img src={ITEM_IMAGES[item.templateId]} alt={item.name} className="w-10 h-10 object-contain drop-shadow" />
                                    ) : (
                                        <div className="opacity-70">{SLOT_ICONS[slot]}</div>
                                    )}
                                </div>
                                <div className="text-xs mb-1 leading-none" style={{ color: 'var(--color-text-muted)' }}>{SLOT_LABELS[slot]}</div>
                                {item ? (
                                    <>
                                        <div className="text-sm font-medium truncate" style={{ color: RARITY_COLORS[item.rarity] }}>{item.name}</div>
                                        <button onClick={() => unequipItem(item.id)} className="text-xs mt-1 px-2 py-0.5 rounded" style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg-secondary)' }}>外す</button>
                                    </>
                                ) : (
                                    <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>なし</div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            <InventorySection visibleLimit={5} showViewAll />

            {/* 獲得履歴 */}
            {openedChests.length > 0 && (
                <div className="mb-4 mt-4">
                    <h2 className="text-base font-semibold mb-2 flex items-center gap-1" style={{ color: 'var(--color-text-primary)' }}>
                        <History size={18} />獲得履歴 ({openedChests.length})
                    </h2>
                    <div className="rounded-xl" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', maxHeight: '320px', overflowY: 'auto' }}>
                        {openedChests.map((chest, idx) => (
                            <div
                                key={chest.id}
                                className="flex items-center gap-3 px-3 py-2.5"
                                style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--color-border-default)' }}
                            >
                                <img src={CHEST_IMAGES[chest.chestType] || CHEST_FALLBACK_IMAGE} alt={chest.label} className="w-8 h-8 object-contain flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{chest.label}</div>
                                    {chest.equipment ? (
                                        <div className="text-sm font-medium truncate" style={{ color: RARITY_COLORS[chest.equipment.rarity] }}>
                                            {chest.equipment.name}
                                        </div>
                                    ) : chest.isStarterCharacter ? (
                                        <div className="text-sm font-medium" style={{ color: 'var(--color-accent-primary)' }}>キャラクター獲得</div>
                                    ) : (
                                        <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>—</div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* プロフィール編集モーダル */}
            {isEditingProfile && (
                <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}>
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="profile-edit-title"
                        className="w-full max-w-sm rounded-2xl p-5 animate-scale-in"
                        style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
                    >
                        <div className="flex items-center justify-between mb-4">
                            <h3 id="profile-edit-title" className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>プロフィール編集</h3>
                            <button onClick={() => setIsEditingProfile(false)} aria-label="プロフィール編集を閉じる" className="p-1 rounded-lg" style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-bg-secondary)' }}>
                                <X size={20} />
                            </button>
                        </div>

                        <div className="mb-4">
                            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>名前</label>
                            <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="w-full px-3 py-2.5 rounded-xl text-base outline-none"
                                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}
                                placeholder="名前を入力"
                                maxLength={12}
                            />
                        </div>

                        <div className="mb-6">
                            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>アバター</label>
                            <div className="grid grid-cols-2 gap-3">
                                <button onClick={() => setEditAvatar('female')}
                                    className="p-3 rounded-xl border flex flex-col items-center gap-2 transition-all relative"
                                    style={{
                                        backgroundColor: editAvatar === 'female' ? 'var(--color-bg-secondary)' : 'transparent',
                                        borderColor: editAvatar === 'female' ? 'var(--color-accent-primary)' : 'var(--color-border-default)',
                                    }}>
                                    <div className="w-14 h-14 rounded-lg overflow-hidden" style={{ background: 'linear-gradient(135deg, var(--color-accent-primary), var(--color-accent-secondary))' }}>
                                        <img src={heroImg} alt="Female option" className="w-full h-full object-cover" />
                                    </div>
                                    <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>女性</span>
                                    {editAvatar === 'female' && <Check size={14} className="absolute top-2 right-2" style={{ color: 'var(--color-accent-primary)' }} />}
                                </button>

                                <button onClick={() => setEditAvatar('male')}
                                    className="p-3 rounded-xl border flex flex-col items-center gap-2 transition-all relative"
                                    style={{
                                        backgroundColor: editAvatar === 'male' ? 'var(--color-bg-secondary)' : 'transparent',
                                        borderColor: editAvatar === 'male' ? 'var(--color-accent-primary)' : 'var(--color-border-default)',
                                    }}>
                                    <div className="w-14 h-14 rounded-lg overflow-hidden" style={{ background: 'linear-gradient(135deg, var(--color-accent-primary), var(--color-accent-secondary))' }}>
                                        <img src={heroMaleImg} alt="Male option" className="w-full h-full object-cover" />
                                    </div>
                                    <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>男性</span>
                                    {editAvatar === 'male' && <Check size={14} className="absolute top-2 right-2" style={{ color: 'var(--color-accent-primary)' }} />}
                                </button>
                            </div>
                        </div>

                        <button
                            onClick={() => {
                                updateCharacter({ name: editName || '名無し', avatar: editAvatar });
                                setIsEditingProfile(false);
                            }}
                            className="w-full py-3 rounded-xl text-base font-bold flex flex-col items-center gap-2 transition-transform active:scale-95"
                            style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>
                            保存する
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export function InventoryPage() {
    const navigate = useNavigate();

    return (
        <div className="max-w-lg mx-auto px-5 pt-6 pb-28">
            <div className="flex items-center gap-3 mb-4">
                <button
                    onClick={() => navigate('/character')}
                    aria-label="キャラクター画面に戻る"
                    className="w-10 h-10 rounded-xl flex items-center justify-center transition-colors"
                    style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', color: 'var(--color-text-secondary)' }}
                >
                    <ArrowLeft size={20} />
                </button>
                <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>インベントリ</h1>
            </div>
            <InventorySection />
        </div>
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

function InventorySection({ visibleLimit, showViewAll = false }: { visibleLimit?: number; showViewAll?: boolean }) {
    const { equipment, equipItem, sellItem, synthesizeItems } = useGameStore();
    const [inventoryMode, setInventoryMode] = useState<InventoryMode>('normal');
    const [selectedForSynth, setSelectedForSynth] = useState<string[]>([]);
    const [sellFeedback, setSellFeedback] = useState<{ id: string; xp: number } | null>(null);
    const [synthResult, setSynthResult] = useState<Equipment | null>(null);

    const unequippedItems = equipment.filter((e) => !e.equipped);
    const hasOverflow = showViewAll && visibleLimit !== undefined && unequippedItems.length >= visibleLimit + 1;
    const visibleItems = hasOverflow ? unequippedItems.slice(0, visibleLimit) : unequippedItems;

    // 合成: 選択中アイテムのレアリティ(最初の選択に合わせる)
    const synthTargetRarity = selectedForSynth.length > 0
        ? unequippedItems.find(e => e.id === selectedForSynth[0])?.rarity ?? null
        : null;

    const handleSell = (itemId: string) => {
        const xp = sellItem(itemId);
        if (xp > 0) {
            setSellFeedback({ id: itemId, xp });
            setSelectedForSynth((prev) => prev.filter((id) => id !== itemId));
            setTimeout(() => setSellFeedback(null), 1500);
        }
    };

    const toggleSynthSelect = (itemId: string) => {
        setSelectedForSynth(prev => {
            if (prev.includes(itemId)) return prev.filter(id => id !== itemId);
            if (prev.length >= SYNTHESIS_CONFIG.REQUIRED_COUNT) return prev;
            const item = unequippedItems.find(e => e.id === itemId);
            if (!item) return prev;
            if (prev.length > 0 && item.rarity !== synthTargetRarity) return prev;
            if (RARITY_ORDER.indexOf(item.rarity) >= RARITY_ORDER.length - 1) return prev;
            return [...prev, itemId];
        });
    };

    const handleSynthesize = () => {
        const result = synthesizeItems(selectedForSynth);
        if (result) {
            setSynthResult(result);
            setSelectedForSynth([]);
            setTimeout(() => setSynthResult(null), 3000);
        }
    };

    const resetMode = () => {
        setInventoryMode('normal');
        setSelectedForSynth([]);
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                <h2 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>インベントリ ({unequippedItems.length})</h2>
                {unequippedItems.length > 0 && (
                    <div className="flex gap-1.5">
                        <button onClick={() => inventoryMode === 'sell' ? resetMode() : (setInventoryMode('sell'), setSelectedForSynth([]))}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                            style={{ backgroundColor: inventoryMode === 'sell' ? 'var(--color-accent-gold)' : 'var(--color-bg-secondary)', color: inventoryMode === 'sell' ? '#000' : 'var(--color-accent-gold)' }}>
                            <Coins size={14} /> 売却
                        </button>
                        <button onClick={() => inventoryMode === 'synthesize' ? resetMode() : (setInventoryMode('synthesize'), setSelectedForSynth([]))}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                            style={{ backgroundColor: inventoryMode === 'synthesize' ? 'var(--color-accent-primary)' : 'var(--color-bg-secondary)', color: inventoryMode === 'synthesize' ? 'white' : 'var(--color-accent-primary)' }}>
                            <Merge size={14} /> 合成
                        </button>
                    </div>
                )}
            </div>

            {inventoryMode === 'synthesize' && (
                <div className="mb-3 px-3 py-2 rounded-xl text-xs flex items-center gap-2" style={{ backgroundColor: 'var(--color-accent-primary)22', color: 'var(--color-accent-secondary)', border: '1px solid var(--color-accent-primary)44' }}>
                    <Sparkles size={14} />
                    <span>同レアリティ{SYNTHESIS_CONFIG.REQUIRED_COUNT}個 → 多い装備種別の上位装備に合成 ({selectedForSynth.length}/{SYNTHESIS_CONFIG.REQUIRED_COUNT})</span>
                </div>
            )}
            {inventoryMode === 'sell' && (
                <div className="mb-3 px-3 py-2 rounded-xl text-xs flex items-center gap-2" style={{ backgroundColor: 'var(--color-accent-gold)22', color: 'var(--color-accent-gold)', border: '1px solid var(--color-accent-gold)44' }}>
                    <Coins size={14} />
                    <span>タップでアイテムを売却しXPに変換</span>
                </div>
            )}

            {synthResult && (
                <div className="mb-3 px-4 py-3 rounded-xl animate-fade-in flex items-center gap-3" style={{ backgroundColor: `${RARITY_COLORS[synthResult.rarity]}22`, border: `1px solid ${RARITY_COLORS[synthResult.rarity]}` }}>
                    <Sparkles size={20} style={{ color: RARITY_COLORS[synthResult.rarity] }} />
                    <div>
                        <div className="text-sm font-bold" style={{ color: RARITY_COLORS[synthResult.rarity] }}>{synthResult.name} を入手！</div>
                        <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{RARITY_LABELS[synthResult.rarity]}ランクの装備を合成しました</div>
                    </div>
                </div>
            )}

            {sellFeedback && (
                <div className="mb-3 px-4 py-2 rounded-xl animate-fade-in text-center" style={{ backgroundColor: 'var(--color-accent-gold)22', border: '1px solid var(--color-accent-gold)44' }}>
                    <span className="text-sm font-bold" style={{ color: 'var(--color-accent-gold)' }}>+{sellFeedback.xp} XP 獲得！</span>
                </div>
            )}

            {unequippedItems.length === 0 ? (
                <div className="text-center py-8 opacity-50">
                    <Star size={28} style={{ margin: '0 auto', color: 'var(--color-text-muted)' }} />
                    <p className="text-sm mt-2" style={{ color: 'var(--color-text-muted)' }}>装備がありません</p>
                </div>
            ) : (
                <div className="flex flex-col gap-2">
                    {visibleItems.map((item) => (
                        <EquipmentRow
                            key={item.id}
                            item={item}
                            mode={inventoryMode}
                            isSelected={selectedForSynth.includes(item.id)}
                            synthTargetRarity={synthTargetRarity}
                            onEquip={() => equipItem(item.id)}
                            onSell={() => handleSell(item.id)}
                            onToggleSynth={() => toggleSynthSelect(item.id)}
                        />
                    ))}
                </div>
            )}

            {hasOverflow && (
                <Link
                    to="/character/inventory"
                    className="w-full mt-3 px-4 py-3 rounded-xl flex items-center justify-between transition-colors"
                    style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)', color: 'var(--color-text-primary)' }}
                >
                    <span className="text-sm font-semibold">もっと見る</span>
                    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                        残り{unequippedItems.length - visibleItems.length}件 <ChevronRight size={16} />
                    </span>
                </Link>
            )}

            {inventoryMode === 'synthesize' && selectedForSynth.length === SYNTHESIS_CONFIG.REQUIRED_COUNT && (
                <button onClick={handleSynthesize}
                    className="w-full mt-3 py-3 rounded-xl text-base font-bold flex items-center justify-center gap-2 transition-transform active:scale-95 animate-fade-in"
                    style={{ background: 'linear-gradient(135deg, var(--color-accent-primary), var(--color-accent-secondary))', color: 'white' }}>
                    <Sparkles size={18} /> 合成する
                </button>
            )}
        </div>
    );
}

function EquipmentRow({ item, mode, isSelected, synthTargetRarity, onEquip, onSell, onToggleSynth }: {
    item: Equipment;
    mode: InventoryMode;
    isSelected: boolean;
    synthTargetRarity: Rarity | null;
    onEquip: () => void;
    onSell: () => void;
    onToggleSynth: () => void;
}) {
    const isLegendary = RARITY_ORDER.indexOf(item.rarity) >= RARITY_ORDER.length - 1;
    const isSynthDisabled = mode === 'synthesize' && (
        isLegendary || (synthTargetRarity !== null && item.rarity !== synthTargetRarity && !isSelected)
    );

    const handleClick = () => {
        if (mode === 'sell') onSell();
        if (mode === 'synthesize' && !isSynthDisabled) onToggleSynth();
    };

    return (
        <div
            className={`flex items-center gap-3 px-3 py-3 rounded-xl transition-all ${mode !== 'normal' ? 'cursor-pointer' : ''}`}
            style={{
                backgroundColor: isSelected ? `${RARITY_COLORS[item.rarity]}15` : 'var(--color-bg-card)',
                border: `1px solid ${isSelected ? RARITY_COLORS[item.rarity] : `${RARITY_COLORS[item.rarity]}33`}`,
                opacity: isSynthDisabled ? 0.4 : 1,
            }}
            onClick={handleClick}
        >
            {mode === 'synthesize' && (
                <div className="w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all"
                    style={{
                        borderColor: isSelected ? RARITY_COLORS[item.rarity] : 'var(--color-text-muted)',
                        backgroundColor: isSelected ? RARITY_COLORS[item.rarity] : 'transparent',
                    }}>
                    {isSelected && <Check size={12} style={{ color: '#000' }} />}
                </div>
            )}
            <div className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${RARITY_COLORS[item.rarity]}22` }}>
                {ITEM_IMAGES[item.templateId] ? (
                    <img src={ITEM_IMAGES[item.templateId]} alt={item.name} className="w-10 h-10 object-contain drop-shadow" />
                ) : (
                    <div className="opacity-70">{SLOT_ICONS[item.slot]}</div>
                )}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium" style={{ color: RARITY_COLORS[item.rarity] }}>{item.name}</div>
                <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {RARITY_LABELS[item.rarity]} · {SLOT_LABELS[item.slot]}
                    {item.attackBonus > 0 && ` · 攻+${item.attackBonus}`}
                    {item.defenseBonus > 0 && ` · 防+${item.defenseBonus}`}
                    {item.hpBonus > 0 && ` · HP+${item.hpBonus}`}
                </div>
            </div>
            {mode === 'normal' && (
                <button onClick={onEquip} className="px-3.5 py-2 rounded-lg text-sm font-medium transition-colors" style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>装備</button>
            )}
            {mode === 'sell' && (
                <div className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold" style={{ backgroundColor: 'var(--color-accent-gold)', color: '#000' }}>
                    <Coins size={14} /> +{SELL_XP_BY_RARITY[item.rarity]} XP
                </div>
            )}
        </div>
    );
}
