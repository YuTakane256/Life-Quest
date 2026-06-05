import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from './useGameStore';
import { XP_CONFIG, CHARACTER_CONFIG } from '../config/gameConfig';

const INITIAL = CHARACTER_CONFIG.INITIAL_STATS;

function resetStore() {
    localStorage.clear();
    useGameStore.setState({
        character: {
            name: INITIAL.name,
            avatar: INITIAL.avatar,
            level: INITIAL.level,
            totalXp: INITIAL.totalXp,
            baseAttack: INITIAL.attack,
            baseDefense: INITIAL.defense,
            baseMaxHp: INITIAL.maxHp,
        },
        debuff: { active: false, expiresAt: null, multiplier: 1 },
        levelUpEvent: null,
    });
}

describe('useGameStore.addXp', () => {
    beforeEach(() => {
        resetStore();
    });

    it('レベルアップしない範囲: totalXp が増え、level / levelUpEvent は変化なし', () => {
        // Lv1 から Lv2 まで 30 XP 必要。20 XP なら未達
        useGameStore.getState().addXp(20);
        const state = useGameStore.getState();
        expect(state.character.totalXp).toBe(20);
        expect(state.character.level).toBe(1);
        expect(state.levelUpEvent).toBeNull();
    });

    it('レベルアップ: level と base ステータスが上がり、levelUpEvent が発火', () => {
        useGameStore.getState().addXp(30);
        const state = useGameStore.getState();
        expect(state.character.totalXp).toBe(30);
        expect(state.character.level).toBe(2);
        expect(state.character.baseAttack).toBe(INITIAL.attack + CHARACTER_CONFIG.STAT_PER_LEVEL.attack);
        expect(state.character.baseDefense).toBe(INITIAL.defense + CHARACTER_CONFIG.STAT_PER_LEVEL.defense);
        expect(state.character.baseMaxHp).toBe(INITIAL.maxHp + CHARACTER_CONFIG.STAT_PER_LEVEL.maxHp);
        expect(state.levelUpEvent).toMatchObject({
            fromLevel: 1,
            toLevel: 2,
            attackGain: CHARACTER_CONFIG.STAT_PER_LEVEL.attack,
            defenseGain: CHARACTER_CONFIG.STAT_PER_LEVEL.defense,
            hpGain: CHARACTER_CONFIG.STAT_PER_LEVEL.maxHp,
        });
    });

    it('2 レベル一気にアップ: ステータスが levelDiff 分上昇', () => {
        // Lv1 から Lv3 まで 80 XP
        useGameStore.getState().addXp(80);
        const state = useGameStore.getState();
        expect(state.character.level).toBe(3);
        expect(state.character.baseAttack).toBe(INITIAL.attack + 2 * CHARACTER_CONFIG.STAT_PER_LEVEL.attack);
        expect(state.levelUpEvent?.toLevel).toBe(3);
        expect(state.levelUpEvent?.fromLevel).toBe(1);
        expect(state.levelUpEvent?.attackGain).toBe(2 * CHARACTER_CONFIG.STAT_PER_LEVEL.attack);
    });

    it('デバフ中: actualXp = floor(baseXp * DEBUFF_XP_MULTIPLIER)', () => {
        // 1日後の expiresAt を設定（fake timers なしで未来時刻を渡せばOK）
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        useGameStore.setState({
            debuff: { active: true, expiresAt, multiplier: XP_CONFIG.DEBUFF_XP_MULTIPLIER },
        });
        useGameStore.getState().addXp(50);
        // 50 * 0.8 = 40
        expect(useGameStore.getState().character.totalXp).toBe(Math.floor(50 * XP_CONFIG.DEBUFF_XP_MULTIPLIER));
    });

    it('デバフ期限切れ: 解除されつつ通常レートで加算', () => {
        // 過去の expiresAt
        const expiresAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        useGameStore.setState({
            debuff: { active: true, expiresAt, multiplier: XP_CONFIG.DEBUFF_XP_MULTIPLIER },
        });
        useGameStore.getState().addXp(50);
        const state = useGameStore.getState();
        // 通常レート 50 が加算され、デバフは解除
        expect(state.character.totalXp).toBe(50);
        expect(state.debuff.active).toBe(false);
    });

    it('0 XP 加算でクラッシュしない', () => {
        expect(() => useGameStore.getState().addXp(0)).not.toThrow();
        expect(useGameStore.getState().character.totalXp).toBe(0);
    });
});

describe('useGameStore.applyDebuff / clearExpiredDebuffs', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-03-15T00:00:00Z'));
        resetStore();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('applyDebuff: active=true, expiresAt が DEBUFF_DURATION_MS 後, multiplier セット', () => {
        useGameStore.getState().applyDebuff();
        const { debuff } = useGameStore.getState();
        expect(debuff.active).toBe(true);
        expect(debuff.multiplier).toBe(XP_CONFIG.DEBUFF_XP_MULTIPLIER);
        const expiresAtMs = new Date(debuff.expiresAt!).getTime();
        const expectedMs = Date.now() + XP_CONFIG.DEBUFF_DURATION_MS;
        expect(expiresAtMs).toBe(expectedMs);
    });

    it('clearExpiredDebuffs: 期限内なら何もしない', () => {
        useGameStore.getState().applyDebuff();
        const before = useGameStore.getState().debuff;
        useGameStore.getState().clearExpiredDebuffs();
        expect(useGameStore.getState().debuff).toEqual(before);
    });

    it('clearExpiredDebuffs: 期限切れなら解除', () => {
        useGameStore.getState().applyDebuff();
        // 期限を過ぎる時刻に進める
        vi.advanceTimersByTime(XP_CONFIG.DEBUFF_DURATION_MS + 1000);
        useGameStore.getState().clearExpiredDebuffs();
        const { debuff } = useGameStore.getState();
        expect(debuff.active).toBe(false);
        expect(debuff.expiresAt).toBeNull();
    });

    it('clearExpiredDebuffs: そもそもデバフ無しなら何もしない', () => {
        useGameStore.getState().clearExpiredDebuffs();
        expect(useGameStore.getState().debuff.active).toBe(false);
    });
});
