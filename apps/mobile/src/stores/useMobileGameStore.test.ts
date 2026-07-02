import AsyncStorage from '@react-native-async-storage/async-storage';
import { createEquipmentFromTemplate, type Equipment } from '@life-quest/core/equipment';
import { createInitialGameStateSnapshot, GAME_STATE_LIMITS } from '@life-quest/core/gameState';
import { CHARACTER_CONFIG, XP_CONFIG } from '@life-quest/core/progression';
import { EQUIPMENT_POOL, SELL_XP_BY_RARITY } from '@life-quest/core/rewards';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMobileGameStore } from './useMobileGameStore';

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => undefined),
        removeItem: vi.fn(async () => undefined),
    },
}));

const storage = vi.mocked(AsyncStorage);

function template(id: string) {
    const found = EQUIPMENT_POOL.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`Unknown template: ${id}`);
    return found;
}

function item(id: string, templateId: string, equipped = false): Equipment {
    return { ...createEquipmentFromTemplate(id, template(templateId)), equipped };
}

function resetStore() {
    useMobileGameStore.setState({
        ...createInitialGameStateSnapshot(),
        hasHydrated: true,
        lastLevelUp: null,
    });
}

describe('useMobileGameStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStore();
    });

    describe('addXp', () => {
        it('XPを加算し、レベルアップでステータスが成長する', () => {
            const result = useMobileGameStore.getState().addXp(30); // レベル2到達
            expect(result?.appliedXp).toBe(30);
            expect(result?.levelGain).toBe(1);

            const { character, lastLevelUp } = useMobileGameStore.getState();
            expect(character.level).toBe(2);
            expect(character.baseAttack).toBe(CHARACTER_CONFIG.INITIAL_STATS.attack + CHARACTER_CONFIG.STAT_PER_LEVEL.attack);
            expect(lastLevelUp).toMatchObject({ fromLevel: 1, toLevel: 2 });
        });

        it('0以下・非有限のXPでは状態を変えない', () => {
            expect(useMobileGameStore.getState().addXp(0)).toBeNull();
            expect(useMobileGameStore.getState().addXp(-10)).toBeNull();
            expect(useMobileGameStore.getState().addXp(Number.NaN)).toBeNull();
            expect(useMobileGameStore.getState().character.totalXp).toBe(0);
        });
    });

    describe('updateCharacter', () => {
        it('名前を上限で切り詰め、アバターを更新する', () => {
            useMobileGameStore.getState().updateCharacter({ name: 'あ'.repeat(50), avatar: 'male' });
            const { character } = useMobileGameStore.getState();
            expect(character.name).toHaveLength(GAME_STATE_LIMITS.maxCharacterNameLength);
            expect(character.avatar).toBe('male');
        });
    });

    describe('ガチャ進行', () => {
        it('マイルストーン到達で宝箱がキューに追加される', () => {
            for (let i = 0; i < 5; i++) {
                useMobileGameStore.getState().incrementGachaCount();
                useMobileGameStore.getState().checkGachaMilestones();
            }
            const { gachaCount, chestQueue } = useMobileGameStore.getState();
            expect(gachaCount).toBe(5);
            expect(chestQueue).toHaveLength(1);
            expect(chestQueue[0]).toMatchObject({ chestType: 'blue', opened: false, isStarterCharacter: true });
        });

        it('マイルストーン以外では宝箱が増えない', () => {
            useMobileGameStore.getState().incrementGachaCount(); // 1
            useMobileGameStore.getState().checkGachaMilestones();
            expect(useMobileGameStore.getState().chestQueue).toHaveLength(0);
        });
    });

    describe('openChest', () => {
        it('木の宝箱の開封で装備を入手し、宝箱が開封済みになる', () => {
            useMobileGameStore.setState({
                chestQueue: [{ id: 'chest-1', chestType: 'wood', label: '木の宝箱', opened: false, equipment: null }],
            });
            const equipment = useMobileGameStore.getState().openChest('chest-1');
            expect(equipment).not.toBeNull();
            expect(EQUIPMENT_POOL.some((candidate) => candidate.id === equipment?.templateId)).toBe(true);

            const state = useMobileGameStore.getState();
            expect(state.chestQueue[0]).toMatchObject({ opened: true, equipment });
            expect(state.equipment).toContainEqual(equipment);
        });

        it('開封済み・不明IDでは何も起きない', () => {
            useMobileGameStore.setState({
                chestQueue: [{ id: 'chest-1', chestType: 'wood', label: 'x', opened: true, equipment: null }],
            });
            expect(useMobileGameStore.getState().openChest('chest-1')).toBeNull();
            expect(useMobileGameStore.getState().openChest('nope')).toBeNull();
            expect(useMobileGameStore.getState().equipment).toHaveLength(0);
        });

        it('スターター宝箱（blue）は装備を排出しないが開封済みになる', () => {
            useMobileGameStore.setState({
                chestQueue: [{ id: 'chest-1', chestType: 'blue', label: '青色の宝箱', opened: false, equipment: null, isStarterCharacter: true }],
            });
            expect(useMobileGameStore.getState().openChest('chest-1')).toBeNull();
            expect(useMobileGameStore.getState().chestQueue[0].opened).toBe(true);
        });
    });

    describe('装備管理', () => {
        it('equipItem は同スロットの既存装備を外して装着する', () => {
            useMobileGameStore.setState({
                equipment: [item('a', 'wooden_sword', true), item('b', 'iron_sword')],
            });
            useMobileGameStore.getState().equipItem('b');
            const equipment = useMobileGameStore.getState().equipment;
            expect(equipment.find((candidate) => candidate.id === 'a')?.equipped).toBe(false);
            expect(equipment.find((candidate) => candidate.id === 'b')?.equipped).toBe(true);
        });

        it('unequipItem は装備を外す', () => {
            useMobileGameStore.setState({ equipment: [item('a', 'wooden_sword', true)] });
            useMobileGameStore.getState().unequipItem('a');
            expect(useMobileGameStore.getState().equipment[0].equipped).toBe(false);
        });

        it('autoEquipBest は各スロット最強を装着し、既に最適なら false', () => {
            useMobileGameStore.setState({
                equipment: [
                    item('weak', 'wooden_sword', true),
                    item('strong', 'excalibur'),
                    item('armor', 'leather_armor'),
                ],
            });
            expect(useMobileGameStore.getState().autoEquipBest()).toBe(true);

            const equipment = useMobileGameStore.getState().equipment;
            expect(equipment.find((candidate) => candidate.id === 'strong')?.equipped).toBe(true);
            expect(equipment.find((candidate) => candidate.id === 'weak')?.equipped).toBe(false);
            expect(equipment.find((candidate) => candidate.id === 'armor')?.equipped).toBe(true);

            expect(useMobileGameStore.getState().autoEquipBest()).toBe(false);
        });

        it('getEffectiveStats は装備ボーナスを合算する', () => {
            useMobileGameStore.setState({ equipment: [item('a', 'excalibur', true), item('b', 'iron_sword')] });
            const stats = useMobileGameStore.getState().getEffectiveStats();
            expect(stats.attack).toBe(CHARACTER_CONFIG.INITIAL_STATS.attack + 30);
            expect(stats.defense).toBe(CHARACTER_CONFIG.INITIAL_STATS.defense + 5);
            expect(stats.maxHp).toBe(CHARACTER_CONFIG.INITIAL_STATS.maxHp + 10);
        });
    });

    describe('sellItem', () => {
        it('未装備アイテムを売却してXPを得る', () => {
            useMobileGameStore.setState({ equipment: [item('a', 'excalibur')] });
            const xp = useMobileGameStore.getState().sellItem('a');
            expect(xp).toBe(SELL_XP_BY_RARITY.legendary);
            expect(useMobileGameStore.getState().equipment).toHaveLength(0);
            expect(useMobileGameStore.getState().character.totalXp).toBe(SELL_XP_BY_RARITY.legendary);
        });

        it('装備中のアイテムは売却できない', () => {
            useMobileGameStore.setState({ equipment: [item('a', 'excalibur', true)] });
            expect(useMobileGameStore.getState().sellItem('a')).toBe(0);
            expect(useMobileGameStore.getState().equipment).toHaveLength(1);
        });
    });

    describe('synthesizeItems', () => {
        it('同レアリティ3個から上位レアリティ装備を生成し、素材を消費する', () => {
            useMobileGameStore.setState({
                equipment: [
                    item('a', 'wooden_sword'),
                    item('b', 'wooden_sword'),
                    item('c', 'wooden_sword'),
                ],
            });
            const result = useMobileGameStore.getState().synthesizeItems(['a', 'b', 'c']);
            expect(result?.rarity).toBe('uncommon');
            expect(result?.slot).toBe('weapon'); // 素材が全てweaponなので支配スロットもweapon

            const equipment = useMobileGameStore.getState().equipment;
            expect(equipment).toHaveLength(1);
            expect(equipment[0]).toEqual(result);
        });

        it('装備中素材・レアリティ混在・個数不足は拒否する', () => {
            useMobileGameStore.setState({
                equipment: [
                    item('a', 'wooden_sword', true),
                    item('b', 'wooden_sword'),
                    item('c', 'iron_sword'),
                ],
            });
            expect(useMobileGameStore.getState().synthesizeItems(['a', 'b', 'c'])).toBeNull();
            expect(useMobileGameStore.getState().synthesizeItems(['b', 'c'])).toBeNull();
            expect(useMobileGameStore.getState().equipment).toHaveLength(3);
        });
    });

    describe('永続化', () => {
        it('一時状態（hasHydrated / lastLevelUp）を保存しない', async () => {
            useMobileGameStore.getState().addXp(30);

            await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalled());
            const [, serialized] = storage.setItem.mock.calls.at(-1) ?? [];
            const envelope = JSON.parse(serialized as string) as { state: Record<string, unknown>; version: number };
            expect(envelope.version).toBe(1);
            expect(envelope.state).not.toHaveProperty('hasHydrated');
            expect(envelope.state).not.toHaveProperty('lastLevelUp');
            expect(envelope.state).toHaveProperty('rewardLedger');
        });

        it('破損した永続データからは初期状態へ復元する（merge経由のsanitize）', () => {
            const persistOptions = useMobileGameStore.persist.getOptions();
            const merged = persistOptions.merge?.(
                { character: { totalXp: 'hack' }, equipment: 'garbage', gachaCount: -5 },
                useMobileGameStore.getState(),
            );
            expect(merged?.character.totalXp).toBe(0);
            expect(merged?.character.level).toBe(1);
            expect(merged?.equipment).toEqual([]);
            expect(merged?.gachaCount).toBe(0);
            expect(merged?.lastLevelUp).toBeNull();
        });

        it('細工されたレベル・ステータスはtotalXpから再計算される', () => {
            const persistOptions = useMobileGameStore.persist.getOptions();
            const merged = persistOptions.merge?.(
                { character: { totalXp: XP_CONFIG.LEVEL_XP_TABLE[3], level: 99, baseAttack: 99999 } },
                useMobileGameStore.getState(),
            );
            expect(merged?.character.level).toBe(3);
            expect(merged?.character.baseAttack).toBe(
                CHARACTER_CONFIG.INITIAL_STATS.attack + 2 * CHARACTER_CONFIG.STAT_PER_LEVEL.attack,
            );
        });
    });
});

describe('報酬付与（二重付与防止）', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStore();
    });

    it('タスク完了報酬はXP・ガチャカウント・台帳を同時に更新する', () => {
        const granted = useMobileGameStore.getState().grantTaskCompletionReward('task-1', 'high');
        expect(granted).toBe(true);

        const state = useMobileGameStore.getState();
        expect(state.character.totalXp).toBe(XP_CONFIG.REWARD_BY_PRIORITY.high);
        expect(state.gachaCount).toBe(1);
        expect(state.rewardLedger.rewardedTaskIds).toEqual(['task-1']);
    });

    it('同じタスクIDには二度と付与しない', () => {
        useMobileGameStore.getState().grantTaskCompletionReward('task-1', 'high');
        const second = useMobileGameStore.getState().grantTaskCompletionReward('task-1', 'high');
        expect(second).toBe(false);

        const state = useMobileGameStore.getState();
        expect(state.character.totalXp).toBe(XP_CONFIG.REWARD_BY_PRIORITY.high);
        expect(state.gachaCount).toBe(1);
    });

    it('5タスク目の完了でマイルストーン宝箱が付与される', () => {
        for (let i = 0; i < 5; i++) {
            useMobileGameStore.getState().grantTaskCompletionReward(`task-${i}`, 'low');
        }
        const state = useMobileGameStore.getState();
        expect(state.gachaCount).toBe(5);
        expect(state.chestQueue).toHaveLength(1);
        expect(state.chestQueue[0]).toMatchObject({ chestType: 'blue', isStarterCharacter: true });
    });

    it('習慣全達成ボーナスは同じ日付に一度だけ付与される', () => {
        expect(useMobileGameStore.getState().grantHabitAllCompleteBonus('2026-07-02')).toBe(true);
        expect(useMobileGameStore.getState().grantHabitAllCompleteBonus('2026-07-02')).toBe(false);
        expect(useMobileGameStore.getState().character.totalXp).toBe(XP_CONFIG.HABIT_ALL_COMPLETE_BONUS);

        expect(useMobileGameStore.getState().grantHabitAllCompleteBonus('2026-07-03')).toBe(true);
        expect(useMobileGameStore.getState().character.totalXp).toBe(XP_CONFIG.HABIT_ALL_COMPLETE_BONUS * 2);
    });

    it('rehydration相当のmergeを経ても台帳が保持され重複しない', () => {
        useMobileGameStore.getState().grantTaskCompletionReward('task-1', 'medium');

        // 永続化された状態を merge で復元するシミュレーション
        const persistOptions = useMobileGameStore.persist.getOptions();
        const persisted = persistOptions.partialize?.(useMobileGameStore.getState());
        const merged = persistOptions.merge?.(persisted, useMobileGameStore.getState());
        useMobileGameStore.setState(merged as Parameters<typeof useMobileGameStore.setState>[0]);

        expect(useMobileGameStore.getState().grantTaskCompletionReward('task-1', 'medium')).toBe(false);
        expect(useMobileGameStore.getState().character.totalXp).toBe(XP_CONFIG.REWARD_BY_PRIORITY.medium);
    });

    it('報酬付与はXPと台帳を単一のset（永続化1回分）で書き込む', async () => {
        storage.setItem.mockClear();
        useMobileGameStore.getState().grantTaskCompletionReward('task-atomic', 'low');

        await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalled());
        const [, serialized] = storage.setItem.mock.calls.at(-1) ?? [];
        const envelope = JSON.parse(serialized as string) as {
            state: { character: { totalXp: number }; rewardLedger: { rewardedTaskIds: string[] } };
        };
        expect(envelope.state.character.totalXp).toBe(XP_CONFIG.REWARD_BY_PRIORITY.low);
        expect(envelope.state.rewardLedger.rewardedTaskIds).toContain('task-atomic');
    });
});
