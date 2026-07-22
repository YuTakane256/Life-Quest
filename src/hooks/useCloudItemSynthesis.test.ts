/**
 * `runCloudItemSynthesis`（`useCloudItemSynthesis`から抽出した判断ロジック
 * 本体）の直接テスト。`useModalEscape.test.ts`と同じ「純粋関数抽出」方針。
 * ヘッダーコメントで定義されたエラー分岐方針（null/4xx→フォールバック、
 * 5xx等→error）を実際のEdgeFunctionErrorインスタンスを投げて検証する。
 */
import { describe, expect, it, vi } from 'vitest';
import { runCloudItemSynthesis, synthKeyOf } from './useCloudItemSynthesis';
import { EdgeFunctionError } from '@life-quest/core/edgeFunctions';
import type { Equipment } from '../types';

const dummyEquipment: Equipment = {
    id: 'result-1', templateId: 'iron_sword', name: '鉄の剣', slot: 'weapon', rarity: 'uncommon',
    attackBonus: 5, defenseBonus: 0, hpBonus: 0, equipped: false,
};

function makeDeps(overrides: Partial<Parameters<typeof runCloudItemSynthesis>[2]> = {}) {
    return {
        synthesizeCloudItems: vi.fn(async () => null),
        applyCloudSynthesisResult: vi.fn(() => dummyEquipment),
        localSynthesizeItems: vi.fn(() => dummyEquipment),
        ...overrides,
    };
}

describe('synthKeyOf', () => {
    it('素材IDをソートして結合する（順序が違っても同じキーになる）', () => {
        expect(synthKeyOf(['b', 'a', 'c'])).toBe('a,b,c');
        expect(synthKeyOf(['c', 'a', 'b'])).toBe(synthKeyOf(['a', 'b', 'c']));
    });
});

describe('runCloudItemSynthesis', () => {
    it('クラウドが結果を返せばapplyCloudSynthesisResultへ適用し、appliedを返す', async () => {
        const deps = makeDeps({
            synthesizeCloudItems: vi.fn(async () => ({ resultId: 'result-1', templateId: 'iron_sword' })),
        });

        const outcome = await runCloudItemSynthesis(['a', 'b', 'c'], 'key-1', deps);

        expect(deps.synthesizeCloudItems).toHaveBeenCalledWith(['a', 'b', 'c'], 'key-1');
        expect(deps.applyCloudSynthesisResult).toHaveBeenCalledWith(['a', 'b', 'c'], 'result-1', 'iron_sword');
        expect(deps.localSynthesizeItems).not.toHaveBeenCalled();
        expect(outcome).toEqual({ status: 'applied', equipment: dummyEquipment });
    });

    it('nullが返る（未接続）ならローカル合成へフォールバックする（冪等キーは温存対象）', async () => {
        const deps = makeDeps();

        const outcome = await runCloudItemSynthesis(['a', 'b', 'c'], 'key-1', deps);

        expect(deps.localSynthesizeItems).toHaveBeenCalledWith(['a', 'b', 'c']);
        expect(deps.applyCloudSynthesisResult).not.toHaveBeenCalled();
        expect(outcome).toEqual({ status: 'unconfigured-fallback', equipment: dummyEquipment });
    });

    it('400（素材数不正）等4xxは全てローカル合成へフォールバックする（DB到達前のためsafe、冪等キーは削除対象）', async () => {
        const deps = makeDeps({
            synthesizeCloudItems: vi.fn(async () => { throw new EdgeFunctionError('http-error', 'invalid ingredients', 400); }),
        });

        const outcome = await runCloudItemSynthesis(['a', 'b', 'c'], 'key-1', deps);

        expect(deps.localSynthesizeItems).toHaveBeenCalledWith(['a', 'b', 'c']);
        expect(outcome.status).toBe('client-error-fallback');
    });

    it('409（レアリティ不一致等）もローカル合成へフォールバックする', async () => {
        const deps = makeDeps({
            synthesizeCloudItems: vi.fn(async () => { throw new EdgeFunctionError('http-error', 'synthesis rules not satisfied', 409); }),
        });

        const outcome = await runCloudItemSynthesis(['a', 'b', 'c'], 'key-1', deps);

        expect(deps.localSynthesizeItems).toHaveBeenCalledWith(['a', 'b', 'c']);
        expect(outcome.status).toBe('client-error-fallback');
    });

    it('5xxはフォールバックせずerrorを返す（DB関数に到達し得るため二重消費防止）', async () => {
        const deps = makeDeps({
            synthesizeCloudItems: vi.fn(async () => { throw new EdgeFunctionError('http-error', 'internal error', 500); }),
        });

        const outcome = await runCloudItemSynthesis(['a', 'b', 'c'], 'key-1', deps);

        expect(deps.localSynthesizeItems).not.toHaveBeenCalled();
        expect(outcome).toEqual({ status: 'error', equipment: null });
    });

    it('ネットワーク断（status=null）等の非EdgeFunctionErrorもerrorを返す', async () => {
        const deps = makeDeps({
            synthesizeCloudItems: vi.fn(async () => { throw new TypeError('Failed to fetch'); }),
        });

        const outcome = await runCloudItemSynthesis(['a', 'b', 'c'], 'key-1', deps);

        expect(outcome).toEqual({ status: 'error', equipment: null });
    });
});
