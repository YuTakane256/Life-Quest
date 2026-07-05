import { describe, expect, it } from 'vitest';
import {
    applyBattleAction,
    BATTLE_CONFIG,
    BATTLE_REPLAY_MAX_ACTIONS,
    calculateDamage,
    createBattleEngineState,
    ENEMY_IMAGE_KEYS,
    getGuardReduction,
    getStageDefinition,
    MAP_CONFIG,
    MAX_STAGE,
    replayBattle,
    tickSkillCooldowns,
    type BattleActors,
} from './battle.ts';
import { BATTLE_SKILL_CONFIG, BATTLE_SKILLS } from './battleSkills.ts';

function makeActors(overrides: Partial<BattleActors> = {}): BattleActors {
    return {
        player: { attack: 10, defense: 4, maxHp: 100 },
        enemy: { stage: 1, name: 'スライム', maxHp: 30, attack: 3, defense: 1, xpReward: 5 },
        playerLevel: 5,
        playerName: '勇者',
        ...overrides,
    };
}

describe('BATTLE_CONFIG / MAP_CONFIG / ENEMY_IMAGE_KEYS の整合性', () => {
    it('ステージは1〜40の連番で、全ステージが正のxpRewardを持つ', () => {
        expect(BATTLE_CONFIG.STAGES).toHaveLength(40);
        expect(MAX_STAGE).toBe(40);
        BATTLE_CONFIG.STAGES.forEach((stage, index) => {
            expect(stage.stage).toBe(index + 1);
            expect(stage.hp).toBeGreaterThan(0);
            expect(stage.xpReward).toBeGreaterThan(0);
        });
    });

    it('MAP_CONFIGの4エリアがステージ1〜40を隙間なく分割している', () => {
        expect(MAP_CONFIG).toHaveLength(4);
        let expectedStart = 1;
        for (const map of MAP_CONFIG) {
            expect(map.stageRange[0]).toBe(expectedStart);
            expectedStart = map.stageRange[1] + 1;
        }
        expect(expectedStart).toBe(MAX_STAGE + 1);
    });

    it('全ステージに敵画像キーが割り当てられている', () => {
        for (const stage of BATTLE_CONFIG.STAGES) {
            expect(ENEMY_IMAGE_KEYS[stage.stage], `stage ${stage.stage}`).toBeTruthy();
        }
    });

    it('getStageDefinitionはステージ番号で敵データを返す', () => {
        expect(getStageDefinition(1)?.name).toBe('スライム');
        expect(getStageDefinition(40)?.name).toBe('リヴァイアサン');
        expect(getStageDefinition(41)).toBeUndefined();
    });
});

describe('基礎計算', () => {
    it('calculateDamage: attack - defense * 0.5 の切り捨て、最低1', () => {
        expect(calculateDamage(10, 4)).toBe(8);
        expect(calculateDamage(10, 5)).toBe(7); // floor(7.5)
        expect(calculateDamage(1, 100)).toBe(BATTLE_CONFIG.MIN_DAMAGE);
    });

    it('tickSkillCooldowns: 1ずつ減らし0以下は取り除く', () => {
        expect(tickSkillCooldowns({ a: 2, b: 1 })).toEqual({ a: 1 });
    });

    it('getGuardReduction: 残ターンがなければ0、上限でクランプ', () => {
        expect(getGuardReduction({ guardTurnsRemaining: 0, guardDamageReduction: 0.5 }, 0.9)).toBe(0);
        expect(getGuardReduction({ guardTurnsRemaining: 1, guardDamageReduction: 0.95 }, 0.9)).toBe(0.9);
    });
});

describe('applyBattleAction: 通常攻撃', () => {
    it('プレイヤー攻撃→敵反撃の1ターンでHPとログが期待値どおり', () => {
        const actors = makeActors();
        const first = applyBattleAction(createBattleEngineState(actors), { type: 'attack' }, actors);
        expect(first.valid).toBe(true);
        const s = first.state;
        // 勇者: floor(10 - 1*0.5) = 9ダメージ → 敵HP 21
        expect(s.enemyHp).toBe(21);
        // スライム: floor(3 - 4*0.5) = 1ダメージ → プレイヤーHP 99
        expect(s.playerHp).toBe(99);
        expect(s.outcome).toBe('ongoing');
        expect(s.logs).toHaveLength(2);
        expect(s.logs[0].message).toBe('勇者の攻撃！ スライムに9ダメージ！');
        expect(s.logs[1].message).toBe('スライムの攻撃！ 勇者に1ダメージ！');
    });

    it('敵のHPが0になったターンは反撃なしで勝利し、状態は変化しない', () => {
        const actors = makeActors({ player: { attack: 1000, defense: 4, maxHp: 100 } });
        const result = applyBattleAction(createBattleEngineState(actors), { type: 'attack' }, actors);
        expect(result.state.outcome).toBe('victory');
        expect(result.state.enemyHp).toBe(0);
        expect(result.state.playerHp).toBe(100); // 反撃を受けない
        expect(result.state.logs).toHaveLength(1);
    });

    it('プレイヤーのHPが0になると敗北', () => {
        const actors = makeActors({
            player: { attack: 1, defense: 0, maxHp: 5 },
            enemy: { stage: 10, name: 'ミノタウロス', maxHp: 350, attack: 28, defense: 15, xpReward: 80 },
        });
        const result = applyBattleAction(createBattleEngineState(actors), { type: 'attack' }, actors);
        expect(result.state.outcome).toBe('defeat');
        expect(result.state.playerHp).toBe(0);
    });

    it('決着後の行動は無効', () => {
        const actors = makeActors({ player: { attack: 1000, defense: 4, maxHp: 100 } });
        const victory = applyBattleAction(createBattleEngineState(actors), { type: 'attack' }, actors).state;
        const after = applyBattleAction(victory, { type: 'attack' }, actors);
        expect(after.valid).toBe(false);
        expect(after.state).toBe(victory);
    });
});

describe('applyBattleAction: スキル', () => {
    it('power_strike: attack×1.6のダメージを与え、クールダウンが設定される', () => {
        const actors = makeActors();
        const result = applyBattleAction(createBattleEngineState(actors), { type: 'skill', skillId: 'power_strike' }, actors);
        expect(result.valid).toBe(true);
        // floor(10 * 1.6) = 16 → 敵HP 30-16=14
        expect(result.state.enemyHp).toBe(14);
        // クールダウン: cooldownTurns(2)+1 をtick → 2
        expect(result.state.skillCooldowns.power_strike).toBe(2);
    });

    it('クールダウン中のスキルは無効で状態が変化しない', () => {
        const actors = makeActors();
        const first = applyBattleAction(createBattleEngineState(actors), { type: 'skill', skillId: 'power_strike' }, actors).state;
        const second = applyBattleAction(first, { type: 'skill', skillId: 'power_strike' }, actors);
        expect(second.valid).toBe(false);
        expect(second.state).toBe(first);
    });

    it('未解放レベルのスキルは無効', () => {
        const actors = makeActors({ playerLevel: 1 });
        const result = applyBattleAction(createBattleEngineState(actors), { type: 'skill', skillId: 'guard_stance' }, actors);
        expect(result.valid).toBe(false);
    });

    it('HP満タンでのfirst_aidは無効（回復量0）', () => {
        const actors = makeActors();
        const result = applyBattleAction(createBattleEngineState(actors), { type: 'skill', skillId: 'first_aid' }, actors);
        expect(result.valid).toBe(false);
    });

    it('guard_stance: 発動ターンから被ダメージが軽減され、残ターンが減衰する', () => {
        const actors = makeActors({
            enemy: { stage: 2, name: 'ゴブリン', maxHp: 50, attack: 20, defense: 2, xpReward: 10 },
        });
        const guarded = applyBattleAction(createBattleEngineState(actors), { type: 'skill', skillId: 'guard_stance' }, actors).state;
        // 素のダメージ: floor(20 - 4*0.5) = 18 → 50%軽減 floor(18*0.5) = 9
        expect(guarded.playerHp).toBe(100 - 9);
        expect(guarded.logs[1].message).toContain('防御効果で軽減！');
        // durationTurns=2、発動ターンで1消費 → 残1
        expect(guarded.guardTurnsRemaining).toBe(1);

        const next = applyBattleAction(guarded, { type: 'attack' }, actors).state;
        expect(next.guardTurnsRemaining).toBe(0);
        expect(next.guardDamageReduction).toBe(0);
    });
});

describe('replayBattle（ADR-010: サーバー側の勝敗再計算）', () => {
    it('行動列から勝敗を独立に確定する（通常攻撃の連打で勝利）', () => {
        const actors = makeActors();
        // スライムHP30、毎ターン9ダメージ → 4回で撃破
        const result = replayBattle(actors, [
            { type: 'attack' }, { type: 'attack' }, { type: 'attack' }, { type: 'attack' },
        ]);
        expect(result.outcome).toBe('victory');
        expect(result.hadInvalidAction).toBe(false);
    });

    it('決着に足りない行動列はongoingのまま（勝利と判定しない）', () => {
        const actors = makeActors();
        const result = replayBattle(actors, [{ type: 'attack' }]);
        expect(result.outcome).toBe('ongoing');
    });

    it('虚偽の行動列（クールダウン無視の連続スキル）はinvalidとして検出される', () => {
        const actors = makeActors();
        const result = replayBattle(actors, [
            { type: 'skill', skillId: 'power_strike' },
            { type: 'skill', skillId: 'power_strike' }, // クールダウン中 → 不正
        ]);
        expect(result.hadInvalidAction).toBe(true);
        expect(result.outcome).not.toBe('victory');
    });

    it('上限を超える行動列は計算せず拒否する', () => {
        const actors = makeActors();
        const actions = Array.from({ length: BATTLE_REPLAY_MAX_ACTIONS + 1 }, () => ({ type: 'attack' as const }));
        const result = replayBattle(actors, actions);
        expect(result.hadInvalidAction).toBe(true);
        expect(result.state.logs).toHaveLength(0);
    });

    it('決着後の余分な行動は無視される（二重送信耐性）', () => {
        const actors = makeActors({ player: { attack: 1000, defense: 4, maxHp: 100 } });
        const result = replayBattle(actors, [{ type: 'attack' }, { type: 'attack' }, { type: 'attack' }]);
        expect(result.outcome).toBe('victory');
        expect(result.hadInvalidAction).toBe(false);
        expect(result.state.logs).toHaveLength(1);
    });
});

describe('スキル定義との整合性', () => {
    it('エンジンが参照するスキルIDが定義に存在する', () => {
        const ids = BATTLE_SKILLS.map((skill) => skill.id);
        expect(ids).toEqual(['power_strike', 'first_aid', 'guard_stance']);
        expect(BATTLE_SKILL_CONFIG.MAX_DAMAGE_REDUCTION).toBe(0.9);
    });
});
