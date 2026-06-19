import { describe, expect, it } from 'vitest';
import { BATTLE_SKILLS } from '../config/battleSkills';
import {
    findBattleSkill,
    getUnlockedBattleSkills,
    resolveBattleSkill,
} from './battleSkills';

describe('battle skill utilities', () => {
    it('レベルに応じて解禁済みスキルを返す', () => {
        expect(getUnlockedBattleSkills(1).map((skill) => skill.id)).toEqual(['power_strike']);
        expect(getUnlockedBattleSkills(3).map((skill) => skill.id)).toEqual(['power_strike', 'first_aid']);
        expect(getUnlockedBattleSkills(5).map((skill) => skill.id)).toEqual([
            'power_strike',
            'first_aid',
            'guard_stance',
        ]);
        expect(getUnlockedBattleSkills(Number.NaN).map((skill) => skill.id)).toEqual(['power_strike']);
    });

    it('スキルIDで定義を検索できる', () => {
        expect(findBattleSkill('first_aid')?.name).toBe('応急手当');
        expect(findBattleSkill('missing_skill')).toBeUndefined();
    });

    it('攻撃スキルのダメージを安全に計算する', () => {
        const result = resolveBattleSkill('power_strike', {
            attack: 10,
            currentHp: 50,
            maxHp: 100,
        });

        expect(result?.type).toBe('damage');
        if (result?.type !== 'damage') throw new Error('Expected damage skill');
        expect(result.damage).toBe(16);

        const minimum = resolveBattleSkill('power_strike', {
            attack: -10,
            currentHp: 50,
            maxHp: 100,
        });
        expect(minimum?.type).toBe('damage');
        if (minimum?.type !== 'damage') throw new Error('Expected damage skill');
        expect(minimum.damage).toBe(1);
    });

    it('回復スキルは最大HPと不足HPを超えない', () => {
        const wounded = resolveBattleSkill('first_aid', {
            attack: 10,
            currentHp: 80,
            maxHp: 100,
        });

        expect(wounded?.type).toBe('heal');
        if (wounded?.type !== 'heal') throw new Error('Expected heal skill');
        expect(wounded.heal).toBe(20);

        const full = resolveBattleSkill('first_aid', {
            attack: 10,
            currentHp: 100,
            maxHp: 100,
        });
        expect(full?.type).toBe('heal');
        if (full?.type !== 'heal') throw new Error('Expected heal skill');
        expect(full.heal).toBe(0);
    });

    it('防御スキルの軽減率と継続ターンを返す', () => {
        const result = resolveBattleSkill('guard_stance', {
            attack: 10,
            currentHp: 50,
            maxHp: 100,
        });

        expect(result?.type).toBe('guard');
        if (result?.type !== 'guard') throw new Error('Expected guard skill');
        expect(result.damageReduction).toBe(0.5);
        expect(result.durationTurns).toBe(2);
    });

    it('未知のスキルIDは null を返す', () => {
        expect(resolveBattleSkill('missing_skill', {
            attack: 10,
            currentHp: 50,
            maxHp: 100,
        })).toBeNull();
    });

    it('すべてのスキルにバトルUIで必要なメタ情報がある', () => {
        expect(BATTLE_SKILLS).toHaveLength(3);
        for (const skill of BATTLE_SKILLS) {
            expect(skill.id).not.toHaveLength(0);
            expect(skill.name).not.toHaveLength(0);
            expect(skill.description).not.toHaveLength(0);
            expect(skill.unlockLevel).toBeGreaterThanOrEqual(1);
            expect(skill.cooldownTurns).toBeGreaterThanOrEqual(0);
            expect(skill.power).toBeGreaterThanOrEqual(0);
        }
    });
});
