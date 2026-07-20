/**
 * 宝箱開封をクラウド権威で行う（可能な場合）。Web `src/hooks/useCloudChestOpen.ts`
 * の移植（エラー分岐の設計はWebと同一。詳細な理由もそちらのコメント参照）。
 *
 * - `openCloudChest`が`null`を返す（未ログイン・Edge Function未設定）→
 *   無条件でローカル`openChest`へフォールバック
 * - `EdgeFunctionError`でstatus 404（ローカル生成IDの宝箱が未同期）→
 *   ローカル`openChest`へフォールバック
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
import { openCloudChest } from '../platform/battleCloud';
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

export function useCloudChestOpen(): UseCloudChestOpenResult {
    const localOpenChest = useMobileGameStore((state) => state.openChest);
    const applyCloudChestResult = useMobileGameStore((state) => state.applyCloudChestResult);
    const discardSyncedChest = useMobileGameStore((state) => state.discardSyncedChest);
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
            const result = await openCloudChest(chestId, key);
            if (!result) {
                return { status: 'opened', equipment: localOpenChest(chestId) };
            }
            const equipment = applyCloudChestResult(chestId, result.itemId, result.templateId, result.starterCharacter);
            idempotencyKeysRef.current.delete(chestId);
            return { status: 'opened', equipment };
        } catch (error) {
            if (error instanceof EdgeFunctionError && error.status === 404) {
                idempotencyKeysRef.current.delete(chestId);
                return { status: 'opened', equipment: localOpenChest(chestId) };
            }
            if (error instanceof EdgeFunctionError && error.status === 409) {
                discardSyncedChest(chestId);
                idempotencyKeysRef.current.delete(chestId);
                return PENDING;
            }
            setErrorChestId(chestId);
            return PENDING;
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
