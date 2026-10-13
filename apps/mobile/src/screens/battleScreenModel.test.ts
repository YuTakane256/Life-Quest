import { describe, expect, it } from 'vitest';
import { getBattleResultView } from './battleScreenModel';

const base = { outcome: 'victory' as const, rewardMode: 'local' as const, attemptId: null, resolveState: 'idle' as const, granted: null, xpReward: 15, stage: 3, busy: false };
describe('battle result presentation, not reward grants', () => {
    it('permits local victory/defeat continuation and caps the last stage', () => {
        expect(getBattleResultView(base)).toMatchObject({ message: '15 XP を獲得！', canContinue: true, nextStage: 4, nextLabel: '次へ' });
        expect(getBattleResultView({ ...base, stage: 40 })).toMatchObject({ nextStage: 40, nextLabel: '再挑戦' });
        expect(getBattleResultView({ ...base, outcome: 'defeat' }).message).not.toContain('XP');
        expect(getBattleResultView({ ...base, outcome: 'ongoing' }).canContinue).toBe(false);
    });
    it.each(['idle', 'syncing', 'error'] as const)('retains a terminal cloud attempt in %s', (resolveState) => {
        const view = getBattleResultView({ ...base, rewardMode: 'cloud', attemptId: 'same-attempt', resolveState });
        expect(view.canContinue).toBe(false);
        expect(view.message).not.toContain('15 XP');
        expect(view.canResend).toBe(resolveState === 'error');
    });
    it('shows a grant only after success, without fabricating one for an already-applied result', () => {
        expect(getBattleResultView({ ...base, rewardMode: 'cloud', resolveState: 'done', granted: true }).message).toBe('15 XP を獲得！');
        expect(getBattleResultView({ ...base, rewardMode: 'cloud', resolveState: 'done', granted: false }).message).toContain('既に付与済み');
        expect(getBattleResultView({ ...base, rewardMode: 'cloud' })).toMatchObject({ message: '同期済み', canContinue: true });
        expect(getBattleResultView({ ...base, busy: true }).canContinue).toBe(false);
    });
});
