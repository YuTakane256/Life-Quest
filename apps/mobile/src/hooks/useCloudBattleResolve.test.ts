/**
 * `runCloudBattleResolve`と`shouldResolveBattle`（`useCloudBattleResolve`
 * から抽出した判断ロジック本体）の直接テスト。Web
 * `src/hooks/useCloudBattleResolve.test.ts`と同じ「純粋関数抽出」方針。
 * `shouldResolveBattle`はMobile固有（Webの`battle.status`と異なり
 * `activeBattle.state.outcome`を監視するため）の二重発火防止ガードを
 * レンダラー無しで直接検証する。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
        removeItem: vi.fn(async () => {}),
    },
}));

// フック本体（未使用パスも含め）が`../platform/battleCloud`経由でexpo-secure-store等の
// ネイティブ依存を読み込むため、jsdom環境で解決できないようモックする
// （純粋関数のテストではこれらは呼ばれない）
vi.mock('../platform/edgeFunctions', () => ({
    getMobileEdgeFunctionInvoker: () => vi.fn(),
}));

import { runCloudBattleResolve, shouldResolveBattle } from './useCloudBattleResolve';
import type { ActiveMobileBattle } from '../stores/useMobileGameStore';

function makeBattle(overrides: Partial<ActiveMobileBattle> = {}): ActiveMobileBattle {
    return {
        stage: 1,
        actors: {} as ActiveMobileBattle['actors'],
        state: {
            enemyHp: 0, playerHp: 10, skillCooldowns: {},
            guardTurnsRemaining: 0, guardDamageReduction: 0, logs: [], outcome: 'victory',
        },
        actions: [],
        battleAttemptId: 'attempt-1',
        rewardMode: 'cloud',
        ...overrides,
    };
}

describe('runCloudBattleResolve', () => {
    it('成功時、applyResolvedCloudBattleを適用してからdone/grantedを返す', async () => {
        const resolveCloudBattleAttempt = vi.fn(async () => ({ outcome: 'victory' as const, granted: true }));
        const applyResolvedCloudBattle = vi.fn();

        const outcome = await runCloudBattleResolve(
            'attempt-1',
            [{ type: 'attack' }],
            { resolveCloudBattleAttempt, applyResolvedCloudBattle },
        );

        expect(resolveCloudBattleAttempt).toHaveBeenCalledWith('attempt-1', [{ type: 'attack' }]);
        expect(applyResolvedCloudBattle).toHaveBeenCalledWith('attempt-1', 'victory', true);
        expect(outcome).toEqual({ status: 'done', granted: true });
    });

    it('grantedがfalse（既に付与済み）でもdoneとして反映する', async () => {
        const resolveCloudBattleAttempt = vi.fn(async () => ({ outcome: 'defeat' as const, granted: false }));
        const applyResolvedCloudBattle = vi.fn();

        const outcome = await runCloudBattleResolve(
            'attempt-2',
            [],
            { resolveCloudBattleAttempt, applyResolvedCloudBattle },
        );

        expect(applyResolvedCloudBattle).toHaveBeenCalledWith('attempt-2', 'defeat', false);
        expect(outcome).toEqual({ status: 'done', granted: false });
    });

    it('例外（ネットワークエラー等）はerrorを返し、applyResolvedCloudBattleは呼ばない', async () => {
        const resolveCloudBattleAttempt = vi.fn(async () => { throw new Error('network error'); });
        const applyResolvedCloudBattle = vi.fn();

        const outcome = await runCloudBattleResolve(
            'attempt-3',
            [{ type: 'attack' }],
            { resolveCloudBattleAttempt, applyResolvedCloudBattle },
        );

        expect(applyResolvedCloudBattle).not.toHaveBeenCalled();
        expect(outcome).toEqual({ status: 'error' });
    });
});

describe('shouldResolveBattle', () => {
    it('activeBattleが無ければfalse', () => {
        expect(shouldResolveBattle(null, null)).toBe(false);
    });

    it('決着がongoingならfalse', () => {
        const battle = makeBattle({ state: { ...makeBattle().state, outcome: 'ongoing' } });
        expect(shouldResolveBattle(battle, null)).toBe(false);
    });

    it('rewardModeがlocalならfalse', () => {
        const battle = makeBattle({ rewardMode: 'local' });
        expect(shouldResolveBattle(battle, null)).toBe(false);
    });

    it('battleAttemptIdが無ければfalse', () => {
        const battle = makeBattle({ battleAttemptId: null });
        expect(shouldResolveBattle(battle, null)).toBe(false);
    });

    it('既に同じattemptIdを処理済みならfalse（二重発火防止）', () => {
        const battle = makeBattle({ battleAttemptId: 'attempt-1' });
        expect(shouldResolveBattle(battle, 'attempt-1')).toBe(false);
    });

    it('victory/defeat・cloud・未処理attemptIdならtrue', () => {
        expect(shouldResolveBattle(makeBattle({ battleAttemptId: 'attempt-1' }), null)).toBe(true);
        expect(shouldResolveBattle(makeBattle({ battleAttemptId: 'attempt-1' }), 'attempt-0')).toBe(true);
        const defeatBattle = makeBattle({ state: { ...makeBattle().state, outcome: 'defeat' } });
        expect(shouldResolveBattle(defeatBattle, null)).toBe(true);
    });
});
