/**
 * 宝箱開封をクラウド権威で行う（可能な場合）。Web `src/hooks/useCloudChestOpen.ts`
 * の移植（エラー分岐の設計はWebと同一。詳細な理由もそちらのコメント参照）。
 *
 * - `openCloudChest`が`null`を返す、またはstatus 404の場合は、旧ローカル
 *   宝箱だけをローカル`openChest`へフォールバック
 * - canonical pull由来（`origin: 'cloud'`）の宝箱はnull/404でもフォールバックせず
 *   再送・次回pullへ委ねる
 * - status 409（`chest_already_opened`。サーバー側は既に正常）→ エラー扱い
 *   せず`discardSyncedChest`で演出無しにローカル未開封表示だけ消す
 * - それ以外（ネットワーク断・5xx等）→ フォールバックせず`errorChestId`を
 *   セットし、呼び出し元に再送させる
 *
 * 冪等キーはchestIdごとに保持し、再送時も同じキーを使う。Web版と異なり
 * `crypto.randomUUID`がHermesで保証されないため`createMobileId`を使う。
 */
import { useRef, useState } from 'react';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { openCloudChest, type CloudChestResult } from '../platform/battleCloud';
import { createMobileId } from '../utils/createMobileId';
import { EdgeFunctionError } from '@life-quest/core/edgeFunctions';
import type { Equipment } from '@life-quest/core/equipment';

export interface CloudChestOpenOutcome {
    /** 'opened': 開封確定（equipmentはnullの場合あり＝スターター宝箱等）。'pending': 再送待ち、演出は出さない。 */
    status: 'opened' | 'pending';
    equipment: Equipment | null;
}

export interface UseCloudChestOpenResult {
    /** 開封処理中のchestId（ボタン無効化用）。開封中でなければnull。 */
    openingChestId: string | null;
    /** ネットワークエラー等で失敗し再送待ちのchestId。無ければnull。 */
    errorChestId: string | null;
    openChest: (chestId: string) => Promise<CloudChestOpenOutcome>;
    /** errorChestIdと同じキーで再送する。errorChestIdが無ければ何もしない。 */
    retry: () => Promise<CloudChestOpenOutcome>;
}

const PENDING: CloudChestOpenOutcome = { status: 'pending', equipment: null };

export interface CloudChestOpenDeps {
    openCloudChest: (chestId: string, idempotencyKey: string) => Promise<CloudChestResult | null>;
    applyCloudChestResult: (
        chestId: string,
        itemId: string | null,
        templateId: string | null,
        starterCharacter: boolean,
    ) => Equipment | null;
    discardSyncedChest: (chestId: string) => void;
    localOpenChest: (chestId: string) => Equipment | null;
    /** canonical pull由来の宝箱は、404でも端末内の抽選へ戻さない。 */
    allowLocalFallback?: boolean;
}

/**
 * 'unconfigured-fallback'（未接続=null）は冪等キーを温存（サーバーに何も
 * 送っていないため）、それ以外（applied/404/409/error）は削除対象。
 * ただしerrorは呼び出し元がsetErrorChestIdする関係で削除しない
 * （Web版と異なりMobileの元実装は5xx/network時に削除しないため踏襲する）。
 */
export type CloudChestOpenTag = 'applied' | 'unconfigured-fallback' | 'not-found-fallback' | 'discarded' | 'error';

/**
 * 宝箱開封の判断ロジック本体（ヘッダーコメントのエラー分岐方針を実装する）。
 * Reactの状態管理から切り離した純粋な非同期関数として抽出し、
 * `useCloudChestOpen.test.ts`から直接テストできるようにする。
 */
export async function runCloudChestOpen(
    chestId: string,
    idempotencyKey: string,
    deps: CloudChestOpenDeps,
): Promise<{ tag: CloudChestOpenTag; equipment: Equipment | null }> {
    try {
        const result = await deps.openCloudChest(chestId, idempotencyKey);
        if (!result) {
            if (deps.allowLocalFallback === false) return { tag: 'error', equipment: null };
            return { tag: 'unconfigured-fallback', equipment: deps.localOpenChest(chestId) };
        }
        const equipment = deps.applyCloudChestResult(chestId, result.itemId, result.templateId, result.starterCharacter);
        return { tag: 'applied', equipment };
    } catch (error) {
        if (error instanceof EdgeFunctionError && error.status === 404) {
            if (deps.allowLocalFallback === false) return { tag: 'error', equipment: null };
            return { tag: 'not-found-fallback', equipment: deps.localOpenChest(chestId) };
        }
        if (error instanceof EdgeFunctionError && error.status === 409) {
            deps.discardSyncedChest(chestId);
            return { tag: 'discarded', equipment: null };
        }
        return { tag: 'error', equipment: null };
    }
}

export function useCloudChestOpen(): UseCloudChestOpenResult {
    const localOpenChest = useMobileGameStore((state) => state.openChest);
    const applyCloudChestResult = useMobileGameStore((state) => state.applyCloudChestResult);
    const discardSyncedChest = useMobileGameStore((state) => state.discardSyncedChest);
    const chestQueue = useMobileGameStore((state) => state.chestQueue);
    const [openingChestId, setOpeningChestId] = useState<string | null>(null);
    const [errorChestId, setErrorChestId] = useState<string | null>(null);
    const idempotencyKeysRef = useRef(new Map<string, string>());

    const runOpen = async (chestId: string): Promise<CloudChestOpenOutcome> => {
        setOpeningChestId(chestId);
        setErrorChestId(null);
        let key = idempotencyKeysRef.current.get(chestId);
        if (!key) {
            key = createMobileId();
            idempotencyKeysRef.current.set(chestId, key);
        }
        try {
            const { tag, equipment } = await runCloudChestOpen(chestId, key, {
                openCloudChest,
                applyCloudChestResult,
                discardSyncedChest,
                localOpenChest,
                allowLocalFallback: chestQueue.find((chest) => chest.id === chestId)?.origin !== 'cloud',
            });
            if (tag === 'error') {
                setErrorChestId(chestId);
                return PENDING;
            }
            if (tag !== 'unconfigured-fallback') {
                idempotencyKeysRef.current.delete(chestId);
            }
            if (tag === 'discarded') return PENDING;
            return { status: 'opened', equipment };
        } finally {
            setOpeningChestId(null);
        }
    };

    const openChest = async (chestId: string): Promise<CloudChestOpenOutcome> => {
        if (openingChestId) return PENDING;
        return runOpen(chestId);
    };

    const retry = async (): Promise<CloudChestOpenOutcome> => {
        if (!errorChestId || openingChestId) return PENDING;
        return runOpen(errorChestId);
    };

    return { openingChestId, errorChestId, openChest, retry };
}
