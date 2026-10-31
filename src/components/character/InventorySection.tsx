import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { createInventoryConfirmation, filterAndSortInventory, INVENTORY_SELECTION_CHANGED, reconcileSynthesisSelection, toggleSynthesisSelection, type InventoryRarityFilter, type InventorySlotFilter, type InventorySortMode } from '../../core/inventory';
import { useInventorySynthesis } from '../../hooks/useInventorySynthesis';
import { getEquipmentRowA11y } from './equipmentRowA11y';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useInteractionScope } from '../../hooks/useInteractionScope';
import { captureLoadoutActions } from '@life-quest/core/equipment';

type InventoryMode = 'normal' | 'sell' | 'synthesize';

export function InventoryPage() {
    const navigate = useNavigate();

    return (
        <div className="app-page max-w-lg mx-auto px-5 pt-6 pb-28">
            <div className="flex items-center gap-3 mb-4">
                <button
                    onClick={() => navigate('/character')}
                    aria-label="キャラクター画面に戻る"
                    className="min-w-11 min-h-11 rounded-xl flex items-center justify-center transition-colors"
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
    const sellItem = useGameStore((state) => state.sellItem);
    const { isSynthesizing, hasError: synthHasError, synthesize, retry: retrySynthesize } = useInventorySynthesis();
    const [inventoryMode, setInventoryMode] = useState<InventoryMode>('normal');
    const [selectedForSynth, setSelectedForSynth] = useState<readonly Equipment[]>([]);
    const [selectionNotice, setSelectionNotice] = useState('');
    const [sellFeedback, setSellFeedback] = useState<{ id: string; xp: number } | null>(null);
    const [sellConfirmation, setSellConfirmation] = useState<{ item: Equipment; confirm: () => void } | null>(null);
    const [synthResult, setSynthResult] = useState<Equipment | null>(null);
    const [slotFilter, setSlotFilter] = useState<InventorySlotFilter>('all');
    const [rarityFilter, setRarityFilter] = useState<InventoryRarityFilter>('all');
    const [sortMode, setSortMode] = useState<InventorySortMode>('rarity');
    const pendingConfirmation = useRef<object | null>(null);
    const viewRef = useRef({});
    const selectionRef = useRef({});
    const invalidateView = useCallback(() => {
        viewRef.current = {}; selectionRef.current = {}; pendingConfirmation.current = null;
        setSellConfirmation(null); setSelectedForSynth([]); setSelectionNotice('');
    }, []);
    const interactions = useInteractionScope(() => {
        invalidateView(); setSellFeedback(null); setSynthResult(null); setInventoryMode('normal');
        setSlotFilter('all'); setRarityFilter('all'); setSortMode('rarity');
    });
    const view = viewRef.current; const renderedScope = interactions.capture();
    const isCurrentView = useCallback(() => viewRef.current === view && renderedScope(), [view, renderedScope]);
    const selectionVersion = selectionRef.current;
    const isCurrentSelection = () => isCurrentView() && selectionRef.current === selectionVersion;
    const loadoutAction = captureLoadoutActions(equipment, () => useGameStore.getState().equipment, isCurrentView);
    const validSelected = useMemo(() => reconcileSynthesisSelection(selectedForSynth, equipment), [selectedForSynth, equipment]);
    useEffect(() => {
        if (validSelected === selectedForSynth || !isCurrentView()) return;
        selectionRef.current = {}; setSelectedForSynth(validSelected); setSelectionNotice(INVENTORY_SELECTION_CHANGED);
    }, [validSelected, selectedForSynth, isCurrentView]);
    const changeView = (update: () => void) => { if (isCurrentView()) { invalidateView(); update(); } };
    const resetFilters = () => changeView(() => { setSlotFilter('all'); setRarityFilter('all'); setSortMode('rarity'); });
    const filtersActive = slotFilter !== 'all' || rarityFilter !== 'all' || sortMode !== 'rarity';

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
    const synthTargetRarity = validSelected[0]?.rarity ?? null;

    const confirmSell = (itemId: string) => {
        const xp = sellItem(itemId);
        if (xp <= 0) return;
        const feedback = { id: itemId, xp };
        setSellFeedback(feedback);
        setSelectedForSynth((current) => current.filter((item) => item.id !== itemId));
        interactions.schedule(() => setSellFeedback((current) => current === feedback ? null : current), 1500);
    };

    const requestSell = (item: Equipment) => {
        const isCurrent = isCurrentView;
        if (!isCurrent()) return;
        const token = {};
        pendingConfirmation.current = token;
        const confirm = createInventoryConfirmation([item], () => useGameStore.getState().equipment,
            () => isCurrent() && pendingConfirmation.current === token, () => confirmSell(item.id));
        const confirmation = { item, confirm: () => {
            confirm();
            if (pendingConfirmation.current === token) {
                pendingConfirmation.current = null;
                setSellConfirmation((current) => current === confirmation ? null : current);
            }
        } };
        setSellConfirmation(confirmation);
    };

    const toggleSynthSelect = (item: Equipment) => {
        if (!isCurrentView()) return;
        selectionRef.current = {};
        setSelectionNotice('');
        setSelectedForSynth((current) => toggleSynthesisSelection(current, item, useGameStore.getState().equipment, SYNTHESIS_CONFIG.REQUIRED_COUNT));
    };

    const runSynthesis = (invoke: () => Promise<Equipment | null>, selectionToClear?: readonly Equipment[]) => {
        const isCurrent = isCurrentView;
        if (!isCurrent()) return;
        void invoke().then((result) => {
            if (!isCurrent() || !result) return;
            const notification = { ...result };
            setSynthResult(notification);
            setSelectedForSynth((current) => current === selectionToClear ? [] : current);
            interactions.schedule(() => setSynthResult((current) => current === notification ? null : current), 3000);
        });
    };
    const handleSynthesize = loadoutAction(() => {
        if (!isCurrentSelection() || validSelected.length !== SYNTHESIS_CONFIG.REQUIRED_COUNT) return;
        const ids = validSelected.map((item) => item.id);
        createInventoryConfirmation(validSelected, () => useGameStore.getState().equipment, isCurrentSelection,
            () => runSynthesis(() => synthesize(ids), selectedForSynth))();
    });

    return (
        <div>
            <div className="flex flex-wrap gap-2 items-center justify-between mb-2">
                <h2 className="text-base font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                    インベントリ ({filteredItems.length}/{unequippedItems.length})
                </h2>
                {unequippedItems.length > 0 && (
                    <div className="flex gap-1.5">
                        <button
                            onClick={() => changeView(() => setInventoryMode(inventoryMode === 'sell' ? 'normal' : 'sell'))}
                            aria-pressed={inventoryMode === 'sell'}
                            className="min-h-11 min-w-11 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                            style={{ backgroundColor: inventoryMode === 'sell' ? 'var(--color-accent-gold)' : 'var(--color-bg-secondary)', color: inventoryMode === 'sell' ? '#000' : 'var(--color-accent-gold)' }}
                        >
                            <Coins size={14} /> 売却
                        </button>
                        <button
                            onClick={() => changeView(() => setInventoryMode(inventoryMode === 'synthesize' ? 'normal' : 'synthesize'))}
                            aria-pressed={inventoryMode === 'synthesize'}
                            className="min-h-11 min-w-11 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                            style={{ backgroundColor: inventoryMode === 'synthesize' ? 'var(--color-accent-primary)' : 'var(--color-bg-secondary)', color: inventoryMode === 'synthesize' ? 'white' : 'var(--color-accent-primary)' }}
                        >
                            <Merge size={14} /> 合成
                        </button>
                    </div>
                )}
            </div>

            {(unequippedItems.length > 0 || filtersActive) && (
                <InventoryFilters
                    slotFilter={slotFilter}
                    rarityFilter={rarityFilter}
                    sortMode={sortMode}
                    onSlotChange={(value) => { if (value !== slotFilter) changeView(() => setSlotFilter(value)); }}
                    onRarityChange={(value) => { if (value !== rarityFilter) changeView(() => setRarityFilter(value)); }}
                    onSortChange={(value) => { if (value !== sortMode) changeView(() => setSortMode(value)); }}
                    onReset={filtersActive ? resetFilters : undefined}
                />
            )}

            {inventoryMode === 'synthesize' && (
                <div className="mb-3 px-3 py-2 rounded-xl text-xs flex items-center gap-2" style={{ backgroundColor: 'var(--color-accent-primary)22', color: 'var(--color-accent-secondary)', border: '1px solid var(--color-accent-primary)44' }}>
                    <Sparkles size={14} />
                    <span>同レアリティ{SYNTHESIS_CONFIG.REQUIRED_COUNT}個 → 多い装備種別の上位装備に合成 ({validSelected.length}/{SYNTHESIS_CONFIG.REQUIRED_COUNT})</span>
                </div>
            )}
            {inventoryMode === 'synthesize' && <p className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>表示条件を変更すると素材の選択を解除します。</p>}
            {validSelected.length > 0 && <button onClick={() => changeView(() => {})} className="min-h-11 px-3 mb-2 rounded-lg text-sm" style={{ color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg-secondary)' }}>素材の選択を解除</button>}
            {selectionNotice && <p role="status" className="text-sm mb-2" style={{ color: 'var(--color-text-secondary)' }}>{selectionNotice}</p>}
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

            <ConfirmDialog
                open={sellConfirmation !== null}
                title="装備を売却しますか？"
                message={sellConfirmation ? `「${sellConfirmation.item.name}」を売却して +${SELL_XP_BY_RARITY[sellConfirmation.item.rarity]} XP を獲得します。この操作は取り消せません。` : ''}
                confirmLabel="売却する"
                confirmColor="var(--color-accent-gold)"
                onConfirm={() => sellConfirmation?.confirm()}
                onClose={() => { pendingConfirmation.current = null; setSellConfirmation(null); }}
            />

            {unequippedItems.length === 0 ? (
                <InventoryEmpty icon={<Star size={28} />} message="未装備の装備がありません" />
            ) : filteredItems.length === 0 ? (
                <InventoryEmpty icon={<Package size={28} />} message="条件に合う装備がありません" />
            ) : (
                <div className="flex flex-col gap-2">
                    {visibleItems.map((item) => (
                        <EquipmentRow
                            key={item.id}
                            item={item}
                            mode={inventoryMode}
                            isSelected={validSelected.some((candidate) => candidate.id === item.id)}
                            synthTargetRarity={synthTargetRarity}
                            selectionFull={validSelected.length >= SYNTHESIS_CONFIG.REQUIRED_COUNT}
                            onEquip={loadoutAction(() => useGameStore.getState().equipItem(item.id))}
                            onSell={() => requestSell(item)}
                            onToggleSynth={loadoutAction(() => toggleSynthSelect(item))}
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

            {inventoryMode === 'synthesize' && validSelected.length === SYNTHESIS_CONFIG.REQUIRED_COUNT && (
                <button
                    onClick={handleSynthesize}
                    disabled={isSynthesizing}
                    className="w-full mt-3 py-3 rounded-xl text-base font-bold flex items-center justify-center gap-2 transition-transform active:scale-95 animate-fade-in disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, var(--color-accent-primary), var(--color-accent-secondary))', color: 'white' }}
                >
                    <Sparkles size={18} /> {isSynthesizing ? '合成中…' : '合成する'}
                </button>
            )}

            {synthHasError && (
                <div className="mt-2 text-xs text-center" style={{ color: 'var(--color-text-danger)' }}>
                    合成の同期に失敗しました。
                    <button onClick={() => runSynthesis(retrySynthesize)} className="underline ml-1" style={{ color: 'var(--color-accent-primary)' }}>再送</button>
                </div>
            )}
        </div>
    );
}

function InventoryFilters({ slotFilter, rarityFilter, sortMode, onSlotChange, onRarityChange, onSortChange, onReset }: {
    slotFilter: InventorySlotFilter;
    rarityFilter: InventoryRarityFilter;
    sortMode: InventorySortMode;
    onSlotChange: (value: InventorySlotFilter) => void;
    onRarityChange: (value: InventoryRarityFilter) => void;
    onSortChange: (value: InventorySortMode) => void;
    onReset?: () => void;
}) {
    return (
        <div className="mb-3 rounded-xl p-3" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
            <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                <SlidersHorizontal size={14} />
                <span>表示</span>
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(6.5rem, 100%), 1fr))' }}>
                <InventorySelect label="種類" value={slotFilter} onChange={(value) => onSlotChange(value as InventorySlotFilter)} options={[
                    ['all', 'すべて'], ['weapon', '武器'], ['armor', '防具'], ['accessory', 'アクセサリー'],
                ]} />
                <InventorySelect label="レア" value={rarityFilter} onChange={(value) => onRarityChange(value as InventoryRarityFilter)} options={[
                    ['all', 'すべて'],
                    ...RARITY_ORDER.map((rarity) => [rarity, RARITY_LABELS[rarity]] as [string, string]),
                ]} />
                <InventorySelect label="並び" value={sortMode} onChange={(value) => onSortChange(value as InventorySortMode)} options={[
                    ['rarity', 'レア順'], ['slot', '種類順'], ['name', '名前順'],
                ]} />
            </div>
            {onReset && <button onClick={onReset} className="min-h-11 mt-2 px-3 rounded-lg text-sm" style={{ color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg-secondary)' }}>表示条件をリセット</button>}
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
                aria-label={label}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                className="w-full min-h-11 rounded-lg px-2 text-xs outline-none"
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

function EquipmentRow({ item, mode, isSelected, synthTargetRarity, selectionFull, onEquip, onSell, onToggleSynth }: {
    item: Equipment;
    mode: InventoryMode;
    isSelected: boolean;
    synthTargetRarity: Rarity | null;
    selectionFull: boolean;
    onEquip: () => void;
    onSell: () => void;
    onToggleSynth: () => void;
}) {
    const isLegendary = RARITY_ORDER.indexOf(item.rarity) >= RARITY_ORDER.length - 1;
    const isSynthDisabled = mode === 'synthesize' && (
        isLegendary || (!isSelected && (selectionFull || (synthTargetRarity !== null && item.rarity !== synthTargetRarity)))
    );

    const handleClick = () => {
        if (mode === 'sell') onSell();
        if (mode === 'synthesize' && !isSynthDisabled) onToggleSynth();
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (mode === 'normal') return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault(); // Spaceキーによるページスクロールを抑止（ネイティブbutton/checkboxではないため自前対応が必要）
        handleClick();
    };

    const a11y = getEquipmentRowA11y({
        mode,
        itemName: item.name,
        isSelected,
        isSynthDisabled,
        sellXp: SELL_XP_BY_RARITY[item.rarity],
    });

    return (
        <div
            className={`min-h-11 flex flex-wrap items-center gap-3 px-3 py-3 rounded-xl transition-all ${mode !== 'normal' ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2' : ''}`}
            style={{
                backgroundColor: isSelected ? `${RARITY_COLORS[item.rarity]}15` : 'var(--color-bg-card)',
                border: `1px solid ${isSelected ? RARITY_COLORS[item.rarity] : `${RARITY_COLORS[item.rarity]}33`}`,
                opacity: isSynthDisabled ? 0.4 : 1,
                ...(mode !== 'normal' ? { '--tw-ring-color': 'var(--color-accent-primary)', '--tw-ring-offset-color': 'var(--color-bg-primary)' } as React.CSSProperties : {}),
            }}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            {...a11y}
        >
            {mode === 'synthesize' && (
                <div aria-hidden="true" className="w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all" style={{
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
            <div className="flex-1 basis-[8rem] min-w-0" style={{ overflowWrap: 'anywhere' }}>
                <div className="text-sm font-medium" style={{ color: RARITY_COLORS[item.rarity] }}>{item.name}</div>
                <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {RARITY_LABELS[item.rarity]} · {SLOT_LABELS[item.slot]}
                    {item.attackBonus > 0 && ` · 攻+${item.attackBonus}`}
                    {item.defenseBonus > 0 && ` · 防+${item.defenseBonus}`}
                    {item.hpBonus > 0 && ` · HP+${item.hpBonus}`}
                </div>
            </div>
            {mode === 'normal' && (
                <button onClick={onEquip} aria-label={`${item.name}を装備する`} className="min-h-11 min-w-11 shrink-0 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors" style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>装備</button>
            )}
            {mode === 'sell' && (
                <div aria-hidden="true" className="flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-bold" style={{ backgroundColor: 'var(--color-accent-gold)', color: '#000' }}>
                    <Coins size={14} /> +{SELL_XP_BY_RARITY[item.rarity]} XP
                </div>
            )}
        </div>
    );
}
