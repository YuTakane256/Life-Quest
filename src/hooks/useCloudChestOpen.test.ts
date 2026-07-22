/**
 * `runCloudChestOpen`（`useCloudChestOpen`から抽出した判断ロジック本体）の
 * 直接テスト。`useModalEscape.test.ts`と同じ「純粋関数抽出」方針。
 * ヘッダーコメントで定義されたエラー分岐方針（null→フォールバック、
 * 404→フォールバック、409→discard、その他→error）を実際のEdgeFunctionError
 * インスタンスを投げて検証する（表面的なモックにしない）。
 */
import { describe, expect, it, vi } from 'vitest';
import { runCloudChestOpen } from './useCloudChestOpen';
import { EdgeFunctionError } from '@life-quest/core/edgeFunctions';

function makeDeps(overrides: Partial<Parameters<typeof runCloudChestOpen>[2]> = {}) {
    return {
        openCloudChest: vi.fn(async () => null),
        applyCloudChestResult: vi.fn(),
        discardSyncedChest: vi.fn(),
        localOpenChest: vi.fn(),
        ...overrides,
    };
}

describe('runCloudChestOpen', () => {
    it('クラウドが結果を返せばapplyCloudChestResultへ適用し、appliedを返す', async () => {
        const deps = makeDeps({
            openCloudChest: vi.fn(async () => ({ itemId: 'item-1', templateId: 'wooden_sword', starterCharacter: false })),
        });

        const outcome = await runCloudChestOpen('chest-1', 'key-1', deps);

        expect(deps.openCloudChest).toHaveBeenCalledWith('chest-1', 'key-1');
        expect(deps.applyCloudChestResult).toHaveBeenCalledWith('chest-1', 'item-1', 'wooden_sword', false);
        expect(deps.localOpenChest).not.toHaveBeenCalled();
        expect(outcome).toBe('applied');
    });

    it('nullが返る（未接続）ならローカルopenChestへフォールバックする（冪等キーは温存対象）', async () => {
        const deps = makeDeps();

        const outcome = await runCloudChestOpen('chest-1', 'key-1', deps);

        expect(deps.localOpenChest).toHaveBeenCalledWith('chest-1');
        expect(deps.applyCloudChestResult).not.toHaveBeenCalled();
        expect(outcome).toBe('unconfigured-fallback');
    });

    it('404（サーバーが未同期のchestIdを知らない）ならローカルopenChestへフォールバックする（冪等キーは削除対象）', async () => {
        const deps = makeDeps({
            openCloudChest: vi.fn(async () => { throw new EdgeFunctionError('http-error', 'not found', 404); }),
        });

        const outcome = await runCloudChestOpen('chest-1', 'key-1', deps);

        expect(deps.localOpenChest).toHaveBeenCalledWith('chest-1');
        expect(deps.discardSyncedChest).not.toHaveBeenCalled();
        expect(outcome).toBe('not-found-fallback');
    });

    it('409（既に開封済み）ならdiscardSyncedChestを呼び、演出は出さない', async () => {
        const deps = makeDeps({
            openCloudChest: vi.fn(async () => { throw new EdgeFunctionError('http-error', 'chest_already_opened', 409); }),
        });

        const outcome = await runCloudChestOpen('chest-1', 'key-1', deps);

        expect(deps.discardSyncedChest).toHaveBeenCalledWith('chest-1');
        expect(deps.localOpenChest).not.toHaveBeenCalled();
        expect(outcome).toBe('discarded');
    });

    it('5xx等それ以外のエラーはフォールバックせずerrorを返す', async () => {
        const deps = makeDeps({
            openCloudChest: vi.fn(async () => { throw new EdgeFunctionError('http-error', 'internal error', 500); }),
        });

        const outcome = await runCloudChestOpen('chest-1', 'key-1', deps);

        expect(deps.localOpenChest).not.toHaveBeenCalled();
        expect(deps.discardSyncedChest).not.toHaveBeenCalled();
        expect(outcome).toBe('error');
    });

    it('ネットワーク断（status=null）等の非EdgeFunctionErrorもerrorを返す', async () => {
        const deps = makeDeps({
            openCloudChest: vi.fn(async () => { throw new TypeError('Failed to fetch'); }),
        });

        const outcome = await runCloudChestOpen('chest-1', 'key-1', deps);

        expect(outcome).toBe('error');
    });
});
