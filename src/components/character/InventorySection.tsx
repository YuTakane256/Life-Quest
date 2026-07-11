import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
    ArrowLeft,
    Check,
    ChevronRight,
    Coins,
    Merge,
    Package,
    SlidersHorizontal,
    Sparkles,
    Star,
} from 'lucide-react';
import { RARITY_ORDER, SELL_XP_BY_RARITY, SYNTHESIS_CONFIG } from '../../config/gameConfig';
import { ITEM_IMAGES, RARITY_COLORS, RARITY_LABELS } from '../../config/equipmentAssets';
import { useGameStore } from '../../stores/useGameStore';
import type { Equipment, Rarity } from '../../types';
import { SLOT_ICONS, SLOT_LABELS } from './equipmentPresentation';
import { filterAndSortInventory, type InventoryRarityFilter, type InventorySlotFilter, type InventorySortMode } from '../../core/inventory';

type InventoryMode = 'normal' | 'sell' | 'synthesize';

export function InventoryPage() {
    const navigate = useNavigate();

    return (
        <div className="app-page max-w-lg mx-auto px-5 pt-6 pb-28">
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

export function InventorySection({ visibleLimit, showViewAll = false }: { visibleLimit?: number; showViewAll?: boolean }) {
    const equipment = useGameStore((state) => state.equipment);
    const equipItem = useGameStore((state) => state.equipItem);
    const sellItem = useGameStore((state) => state.sellItem);
    const synthesizeItems = useGameStore((state) => state.synthesizeItems);
    const [inventoryMode, setInventoryMode] = useState<InventoryMode>('normal');
    const [selectedForSynth, setSelectedForSynth] = useState<string[]>([]);
    const [sellFeedback, setSellFeedback] = useState<{ id: string; xp: number } | null>(null);
    const [synthResult, setSynthResult] = useState<Equipment | null>(null);
    const [slotFilter, setSlotFilter] = useState<InventorySlotFilter>('all');
    const [rarityFilter, setRarityFilter] = useState<InventoryRarityFilter>('all');
    const [sortMode, setSortMode] = useState<InventorySortMode>('rarity');

    const unequippedItems = useMemo(() => equipment.filter((item) => !item.equipped), [equipment]);
    const filteredItems = useMemo(
        () => filterAndSortInventory(unequippedItems, { slotFilter, rarityFilter, sortMode, slotLabels: SLOT_LABELS }),
        [rarityFilter, slotFilter, sortMode, unequippedItems]
    );
    const hasOverflow = showViewAll && visibleLimit !== undefined && filteredItems.length > visibleLimit;
    const visibleItems = useMemo(
        () => hasOverflow ? filteredItems.slice(0, visibleLimit) : filteredItems,
        [filteredItems, hasOverflow, visibleLimit]
    );
    const hiddenCount = filteredItems.length - visibleItems.length;
    const synthTargetRarity = useMemo(
        () => selectedForSynth.length > 0
            ? unequippedItems.find((item) => item.id === selectedForSynth[0])?.rarity ?? null
            : null,
        [selectedForSynth, unequippedItems]
    );

    const handleSell = useCallback((itemId: string) => {
        const xp = sellItem(itemId);
        if (xp <= 0) return;
        setSellFeedback({ id: itemId, xp });
        setSelectedForSynth((current) => current.filter((id) => id !== itemId));
        setTimeout(() => setSellFeedback(null), 1500);
    }, [sellItem]);

    const toggleSynthSelect = useCallback((itemId: string) => {
        setSelectedForSynth((current) => {
            if (current.includes(itemId)) return current.filter((id) => id !== itemId);
            if (current.length >= SYNTHESIS_CONFIG.REQUIRED_COUNT) return current;
            const item = unequippedItems.find((candidate) => candidate.id === itemId);
            if (!item) return current;
            if (current.length > 0 && item.rarity !== synthTargetRarity) return current;
            if (RARITY_ORDER.indexOf(item.rarity) >= RARITY_ORDER.length - 1) return current;
            return [...current, itemId];
        });
    }, [synthTargetRarity, unequippedItems]);

    const handleSynthesize = useCallback(() => {
        const result = synthesizeItems(selectedForSynth);
        if (!result) return;
        setSynthResult(result);
        setSelectedForSynth([]);
        setTimeout(() => setSynthResult(null), 3000);
    }, [selectedForSynth, synthesizeItems]);

    const resetMode = useCallback(() => {
        setInventoryMode('normal');
        setSelectedForSynth([]);
    }, []);

    return (
        <div>
            <div className="flex items-center justify-between mb-2">
                <h2 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    インベントリ ({filteredItems.length}/{unequippedItems.length})
                </h2>
                {unequippedItems.length > 0 && (
                    <div className="flex gap-1.5">
                        <button
                            onClick={() => inventoryMode === 'sell' ? resetMode() : (setInventoryMode('sell'), setSelectedForSynth([]))}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                            style={{ backgroundColor: inventoryMode === 'sell' ? 'var(--color-accent-gold)' : 'var(--color-bg-secondary)', color: inventoryMode === 'sell' ? '#000' : 'var(--color-accent-gold)' }}
                        >
                            <Coins size={14} /> 売却
                        </button>
                        <button
                            onClick={() => inventoryMode === 'synthesize' ? resetMode() : (setInventoryMode('synthesize'), setSelectedForSynth([]))}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                            style={{ backgroundColor: inventoryMode === 'synthesize' ? 'var(--color-accent-primary)' : 'var(--color-bg-secondary)', color: inventoryMode === 'synthesize' ? 'white' : 'var(--color-accent-primary)' }}
                        >
                            <Merge size={14} /> 合成
                        </button>
                    </div>
                )}
            </div>

            {unequippedItems.length > 0 && (
                <InventoryFilters
                    slotFilter={slotFilter}
                    rarityFilter={rarityFilter}
                    sortMode={sortMode}
                    onSlotChange={setSlotFilter}
                    onRarityChange={setRarityFilter}
                    onSortChange={setSortMode}
                />
            )}

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
                <InventoryEmpty icon={<Star size={28} />} message="装備がありません" />
            ) : filteredItems.length === 0 ? (
                <InventoryEmpty icon={<Package size={28} />} message="条件に合う装備がありません" />
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
                        残り{hiddenCount}件 <ChevronRight size={16} />
                    </span>
                </Link>
            )}

            {inventoryMode === 'synthesize' && selectedForSynth.length === SYNTHESIS_CONFIG.REQUIRED_COUNT && (
                <button
                    onClick={handleSynthesize}
                    className="w-full mt-3 py-3 rounded-xl text-base font-bold flex items-center justify-center gap-2 transition-transform active:scale-95 animate-fade-in"
                    style={{ background: 'linear-gradient(135deg, var(--color-accent-primary), var(--color-accent-secondary))', color: 'white' }}
                >
                    <Sparkles size={18} /> 合成する
                </button>
            )}
        </div>
    );
}

function InventoryFilters({ slotFilter, rarityFilter, sortMode, onSlotChange, onRarityChange, onSortChange }: {
    slotFilter: InventorySlotFilter;
    rarityFilter: InventoryRarityFilter;
    sortMode: InventorySortMode;
    onSlotChange: (value: InventorySlotFilter) => void;
    onRarityChange: (value: InventoryRarityFilter) => void;
    onSortChange: (value: InventorySortMode) => void;
}) {
    return (
        <div className="mb-3 rounded-xl p-3" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
            <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                <SlidersHorizontal size={14} />
                <span>表示</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
                <InventorySelect label="種類" value={slotFilter} onChange={(value) => onSlotChange(value as InventorySlotFilter)} options={[
                    ['all', 'すべて'], ['weapon', '武器'], ['armor', '防具'], ['accessory', 'アクセサリ'],
                ]} />
                <InventorySelect label="レア" value={rarityFilter} onChange={(value) => onRarityChange(value as InventoryRarityFilter)} options={[
                    ['all', 'すべて'],
                    ...RARITY_ORDER.map((rarity) => [rarity, RARITY_LABELS[rarity]] as [string, string]),
                ]} />
                <InventorySelect label="並び" value={sortMode} onChange={(value) => onSortChange(value as InventorySortMode)} options={[
                    ['rarity', 'レア順'], ['slot', '種類順'], ['name', '名前順'],
                ]} />
            </div>
        </div>
    );
}

function InventorySelect({ label, value, options, onChange }: {
    label: string;
    value: string;
    options: [string, string][];
    onChange: (value: string) => void;
}) {
    return (
        <label className="min-w-0">
            <span className="block text-[10px] mb-1" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
            <select
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="w-full h-9 rounded-lg px-2 text-xs outline-none"
                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}
            >
                {options.map(([optionValue, optionLabel]) => (
                    <option key={optionValue} value={optionValue}>{optionLabel}</option>
                ))}
            </select>
        </label>
    );
}

function InventoryEmpty({ icon, message }: { icon: React.ReactNode; message: string }) {
    return (
        <div className="text-center py-8 opacity-50" style={{ color: 'var(--color-text-muted)' }}>
            <div className="flex justify-center">{icon}</div>
            <p className="text-sm mt-2">{message}</p>
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
                <div className="w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all" style={{
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
