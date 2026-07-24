import { describe, expect, it } from 'vitest';
import {
    BATTLE_SKILL_CONFIG,
    findBattleSkill,
    getUnlockedBattleSkills,
    resolveBattleSkill,
    type BattleSkillDefinition,
} from './battleSkills.ts';

describe('getUnlockedBattleSkills', () => {
    it('level=1では強撃のみ解放される', () => {
        expect(getUnlockedBattleSkills(1).map((s) => s.id)).toEqual(['power_strike']);
    });

    it('level=3では応急手当も解放される', () => {
        expect(getUnlockedBattleSkills(3).map((s) => s.id)).toEqual(['power_strike', 'first_aid']);
    });

    it('level=5では全スキルが解放される', () => {
        expect(getUnlockedBattleSkills(5).map((s) => s.id)).toEqual(['power_strike', 'first_aid', 'guard_stance']);
    });

    it('非有限値（NaN・Infinity・-Infinity）は全てlevel=1として扱う（Infinityも安全側にフォールバック）', () => {
        expect(getUnlockedBattleSkills(Number.NaN).map((s) => s.id)).toEqual(['power_strike']);
        expect(getUnlockedBattleSkills(Number.POSITIVE_INFINITY).map((s) => s.id)).toEqual(['power_strike']);
        expect(getUnlockedBattleSkills(Number.NEGATIVE_INFINITY).map((s) => s.id)).toEqual(['power_strike']);
    });

    it('小数のlevelは切り捨てる', () => {
        expect(getUnlockedBattleSkills(2.9).map((s) => s.id)).toEqual(['power_strike']);
    });

    it('負の値やゼロはlevel=1にクランプする', () => {
        expect(getUnlockedBattleSkills(-5).map((s) => s.id)).toEqual(['power_strike']);
        expect(getUnlockedBattleSkills(0).map((s) => s.id)).toEqual(['power_strike']);
    });
});

describe('findBattleSkill', () => {
    it('既知のIDに一致するスキルを返す', () => {
        expect(findBattleSkill('first_aid')?.name).toBe('応急手当');
    });

    it('未知のIDはundefinedを返す', () => {
        expect(findBattleSkill('unknown_skill')).toBeUndefined();
    });
});

describe('resolveBattleSkill', () => {
    describe('damageタイプ（power_strike）', () => {
        it('attack*powerの切り捨てダメージを返す', () => {
            const result = resolveBattleSkill('power_strike', { attack: 10, currentHp: 50, maxHp: 100 });
            expect(result).toEqual({ type: 'damage', skill: expect.objectContaining({ id: 'power_strike' }), damage: 16 });
        });

        it('attack=0でも最低ダメージ1を保証する', () => {
            const result = resolveBattleSkill('power_strike', { attack: 0, currentHp: 50, maxHp: 100 });
            expect(result).toMatchObject({ type: 'damage', damage: 1 });
        });
    });

    describe('healタイプ（first_aid）', () => {
        it('maxHpの25%を上限に、不足分だけ回復する', () => {
            const result = resolveBattleSkill('first_aid', { attack: 10, currentHp: 50, maxHp: 100 });
            expect(result).toMatchObject({ type: 'heal', heal: 25 });
        });

        it('HPが満タンなら回復量は0を返す（nullにはならない）', () => {
            const result = resolveBattleSkill('first_aid', { attack: 10, currentHp: 100, maxHp: 100 });
            expect(result).toEqual({ type: 'heal', skill: expect.objectContaining({ id: 'first_aid' }), heal: 0 });
        });

        it('不足分がmaxHpの25%未満なら不足分だけ回復する', () => {
            const result = resolveBattleSkill('first_aid', { attack: 10, currentHp: 95, maxHp: 100 });
            expect(result).toMatchObject({ type: 'heal', heal: 5 });
        });

        it('currentHpがmaxHpを超えていてもクランプされ回復量は0になる', () => {
            const result = resolveBattleSkill('first_aid', { attack: 10, currentHp: 150, maxHp: 100 });
            expect(result).toMatchObject({ type: 'heal', heal: 0 });
        });

        it('maxHp=0の境界では回復量0を返す', () => {
            const result = resolveBattleSkill('first_aid', { attack: 10, currentHp: 0, maxHp: 0 });
            expect(result).toMatchObject({ type: 'heal', heal: 0 });
        });
    });

    describe('guardタイプ（guard_stance、および仮想スキルでのMAX_DAMAGE_REDUCTIONクランプ検証）', () => {
        it('現行のguard_stance（power=0.5）はクランプ未発火のまま0.5を返す', () => {
            const result = resolveBattleSkill('guard_stance', { attack: 10, currentHp: 50, maxHp: 100 });
            expect(result).toEqual({
                type: 'guard',
                skill: expect.objectContaining({ id: 'guard_stance' }),
                damageReduction: 0.5,
                durationTurns: 2,
            });
        });

        it('power=1.0（上限超過）はMAX_DAMAGE_REDUCTION(0.9)でクランプされる', () => {
            const catalog: readonly BattleSkillDefinition[] = [
                { id: 'test_guard_over', name: 'テスト防御', description: '', type: 'guard', unlockLevel: 1, power: 1.0, cooldownTurns: 1, durationTurns: 3 },
            ];
            const result = resolveBattleSkill('test_guard_over', { attack: 10, currentHp: 50, maxHp: 100 }, catalog);
            expect(result).toMatchObject({ type: 'guard', damageReduction: BATTLE_SKILL_CONFIG.MAX_DAMAGE_REDUCTION });
        });

        it('power=0.9（境界値ちょうど）はクランプされずそのまま0.9になる', () => {
            const catalog: readonly BattleSkillDefinition[] = [
                { id: 'test_guard_boundary', name: 'テスト防御', description: '', type: 'guard', unlockLevel: 1, power: 0.9, cooldownTurns: 1, durationTurns: 3 },
            ];
            const result = resolveBattleSkill('test_guard_boundary', { attack: 10, currentHp: 50, maxHp: 100 }, catalog);
            expect(result).toMatchObject({ type: 'guard', damageReduction: 0.9 });
        });

        it('durationTurns省略時は1ターンにフォールバックする', () => {
            const catalog: readonly BattleSkillDefinition[] = [
                { id: 'test_guard_no_duration', name: 'テスト防御', description: '', type: 'guard', unlockLevel: 1, power: 0.3, cooldownTurns: 1 },
            ];
            const result = resolveBattleSkill('test_guard_no_duration', { attack: 10, currentHp: 50, maxHp: 100 }, catalog);
            expect(result).toMatchObject({ type: 'guard', durationTurns: 1 });
        });
    });

    it('未知のskillIdはnullを返す', () => {
        expect(resolveBattleSkill('unknown_skill', { attack: 10, currentHp: 50, maxHp: 100 })).toBeNull();
    });

    it('未解放レベルのスキルでも解決できる（レベルチェックは呼び出し元battle.tsの責務）', () => {
        // resolveBattleSkill自体はunlockLevelを見ないため、getUnlockedBattleSkillsで
        // 弾かれるはずのguard_stance（unlockLevel:5）も直接指定すれば解決してしまう。
        const result = resolveBattleSkill('guard_stance', { attack: 10, currentHp: 50, maxHp: 100 });
        expect(result).not.toBeNull();
    });
});
