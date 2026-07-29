/**
 * `runCloudChestOpen`（`useCloudChestOpen`から抽出した判断ロジック本体）の
 * 直接テスト。Web `src/hooks/useCloudChestOpen.test.ts`と同じ「純粋関数抽出」
 * 方針。ヘッダーコメントで定義されたエラー分岐方針（null→フォールバック、
 * 404→フォールバック、409→discard、その他→error）を実際のEdgeFunctionError
 * インスタンスを投げて検証する（表面的なモックにしない）。
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

import { runCloudChestOpen } from './useCloudChestOpen';
import { EdgeFunctionError } from '@life-quest/core/edgeFunctions';
import type { Equipment } from '@life-quest/core/equipment';

const dummyEquipment: Equipment = {
    id: 'item-1', templateId: 'wooden_sword', name: '木の剣', slot: 'weapon', rarity: 'common',
    attackBonus: 1, defenseBonus: 0, hpBonus: 0, equipped: false,
};

function makeDeps(overrides: Partial<Parameters<typeof runCloudChestOpen>[2]> = {}) {
    return {
        openCloudChest: vi.fn(async () => null),
        applyCloudChestResult: vi.fn(() => dummyEquipment),
        discardSyncedChest: vi.fn(),
        localOpenChest: vi.fn(() => dummyEquipment),
        ...overrides,
    };
}

describe('runCloudChestOpen', () => {
    it('クラウドが結果を返せばapplyCloudChestResultへ適用し、appliedを返す', async () => {
        const deps = makeDeps({
            openCloudChest: vi.fn(async () => ({ itemId: 'item-1', templateId: 'wooden_sword', starterCharacter: false })),
        });

        const result = await runCloudChestOpen('chest-1', 'key-1', deps);

        expect(deps.openCloudChest).toHaveBeenCalledWith('chest-1', 'key-1');
        expect(deps.applyCloudChestResult).toHaveBeenCalledWith('chest-1', 'item-1', 'wooden_sword', false);
        expect(deps.localOpenChest).not.toHaveBeenCalled();
        expect(result).toEqual({ tag: 'applied', equipment: dummyEquipment });
    });

    it('nullが返る（未接続）ならローカルopenChestへフォールバックする（冪等キーは温存対象）', async () => {
        const deps = makeDeps();

        const result = await runCloudChestOpen('chest-1', 'key-1', deps);

        expect(deps.localOpenChest).toHaveBeenCalledWith('chest-1');
        expect(deps.applyCloudChestResult).not.toHaveBeenCalled();
        expect(result).toEqual({ tag: 'unconfigured-fallback', equipment: dummyEquipment });
    });

    it('404（サーバーが未同期のchestIdを知らない）ならローカルopenChestへフォールバックする（冪等キーは削除対象）', async () => {
        const deps = makeDeps({
            openCloudChest: vi.fn(async () => { throw new EdgeFunctionError('http-error', 'not found', 404); }),
        });

        const result = await runCloudChestOpen('chest-1', 'key-1', deps);

        expect(deps.localOpenChest).toHaveBeenCalledWith('chest-1');
        expect(deps.discardSyncedChest).not.toHaveBeenCalled();
        expect(result).toEqual({ tag: 'not-found-fallback', equipment: dummyEquipment });
    });

    it('クラウド由来の宝箱が404でもローカル抽選へフォールバックしない', async () => {
        const deps = makeDeps({
            allowLocalFallback: false,
            openCloudChest: vi.fn(async () => { throw new EdgeFunctionError('http-error', 'not found', 404); }),
        });

        await expect(runCloudChestOpen('chest-1', 'key-1', deps)).resolves.toEqual({ tag: 'error', equipment: null });
        expect(deps.localOpenChest).not.toHaveBeenCalled();
    });

    it('409（既に開封済み）ならdiscardSyncedChestを呼び、equipmentはnull', async () => {
        const deps = makeDeps({
            openCloudChest: vi.fn(async () => { throw new EdgeFunctionError('http-error', 'chest_already_opened', 409); }),
        });

        const result = await runCloudChestOpen('chest-1', 'key-1', deps);

        expect(deps.discardSyncedChest).toHaveBeenCalledWith('chest-1');
        expect(deps.localOpenChest).not.toHaveBeenCalled();
        expect(result).toEqual({ tag: 'discarded', equipment: null });
    });

    it('5xx等それ以外のエラーはフォールバックせずerrorを返す', async () => {
        const deps = makeDeps({
            openCloudChest: vi.fn(async () => { throw new EdgeFunctionError('http-error', 'internal error', 500); }),
        });

        const result = await runCloudChestOpen('chest-1', 'key-1', deps);

        expect(deps.localOpenChest).not.toHaveBeenCalled();
        expect(deps.discardSyncedChest).not.toHaveBeenCalled();
        expect(result).toEqual({ tag: 'error', equipment: null });
    });

    it('ネットワーク断（status=null）等の非EdgeFunctionErrorもerrorを返す', async () => {
        const deps = makeDeps({
            openCloudChest: vi.fn(async () => { throw new TypeError('Failed to fetch'); }),
        });

        const result = await runCloudChestOpen('chest-1', 'key-1', deps);

        expect(result).toEqual({ tag: 'error', equipment: null });
    });

    it('スターター宝箱等でequipmentがnullでもappliedとして扱う', async () => {
        const deps = makeDeps({
            openCloudChest: vi.fn(async () => ({ itemId: null, templateId: null, starterCharacter: true })),
            applyCloudChestResult: vi.fn(() => null),
        });

        const result = await runCloudChestOpen('chest-1', 'key-1', deps);

        expect(deps.applyCloudChestResult).toHaveBeenCalledWith('chest-1', null, null, true);
        expect(result).toEqual({ tag: 'applied', equipment: null });
    });
});
