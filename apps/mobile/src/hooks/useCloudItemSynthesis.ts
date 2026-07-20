/**
 * 装備合成をクラウド権威で行う（可能な場合）。Web `src/hooks/useCloudItemSynthesis.ts`
 * の移植（エラー分岐の設計・理由もそちらのコメント参照）。
 *
 * - `synthesizeCloudItems`が`null`を返す（未ログイン・Edge Function未設定）
 *   → 無条件でローカル`synthesizeItems`へフォールバック
 * - 4xx（400/404/409）→ ローカル`synthesizeItems`へフォールバック。
 *   synthesize_itemsのEdge Functionは`callApply`（DB関数呼び出し・素材消費）
 *   より前に素材検証を行い4xxを返すため、素材未消費が保証されている
 * - それ以外（ネットワーク断・5xx等）→ フォールバックせずエラー状態にし、
 *   呼び出し元に再送させる（サーバーのidempotency_keysが二重消費を防ぐ）
 *
 * 冪等キーは素材ID集合（ソート済み）ごとに保持し、再送時も同じキーを使う。
 * Web版と異なり`crypto.randomUUID`がHermesで保証されないため`createMobileId`を使う。
 */
import { useRef, useState } from 'react';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { synthesizeCloudItems } from '../platform/battleCloud';
import { createMobileId } from '../utils/createMobileId';
import { EdgeFunctionError } from '@life-quest/core/edgeFunctions';
import type { Equipment } from '@life-quest/core/equipment';

export interface UseCloudItemSynthesisResult {
    isSynthesizing: boolean;
    /** ネットワークエラー等で失敗し再送待ちなら`true`。 */
    hasError: boolean;
    synthesize: (itemIds: string[]) => Promise<Equipment | null>;
    /** 直前に失敗した合成を同一キーで再送する。失敗が無ければ何もしない。 */
    retry: () => Promise<Equipment | null>;
}

function synthKeyOf(itemIds: string[]): string {
    return [...itemIds].sort().join(',');
}

export function useCloudItemSynthesis(): UseCloudItemSynthesisResult {
    const localSynthesizeItems = useMobileGameStore((state) => state.synthesizeItems);
    const applyCloudSynthesisResult = useMobileGameStore((state) => state.applyCloudSynthesisResult);
    const [isSynthesizing, setIsSynthesizing] = useState(false);
    const [hasError, setHasError] = useState(false);
    const idempotencyKeysRef = useRef(new Map<string, string>());
    const lastItemIdsRef = useRef<string[] | null>(null);

    const runSynthesize = async (itemIds: string[]): Promise<Equipment | null> => {
        setIsSynthesizing(true);
        setHasError(false);
        lastItemIdsRef.current = itemIds;
        const synthKey = synthKeyOf(itemIds);
        let key = idempotencyKeysRef.current.get(synthKey);
        if (!key) {
            key = createMobileId();
            idempotencyKeysRef.current.set(synthKey, key);
        }
        try {
            const result = await synthesizeCloudItems(itemIds, key);
            if (!result) {
                return localSynthesizeItems(itemIds);
            }
            idempotencyKeysRef.current.delete(synthKey);
            return applyCloudSynthesisResult(itemIds, result.resultId, result.templateId);
        } catch (error) {
            if (error instanceof EdgeFunctionError && error.status !== null && error.status < 500) {
                idempotencyKeysRef.current.delete(synthKey);
                return localSynthesizeItems(itemIds);
            }
            setHasError(true);
            return null;
        } finally {
            setIsSynthesizing(false);
        }
    };

    const synthesize = async (itemIds: string[]): Promise<Equipment | null> => {
        if (isSynthesizing) return null;
        return runSynthesize(itemIds);
    };

    const retry = async (): Promise<Equipment | null> => {
        if (!hasError || isSynthesizing || !lastItemIdsRef.current) return null;
        return runSynthesize(lastItemIdsRef.current);
    };

    return { isSynthesizing, hasError, synthesize, retry };
}
