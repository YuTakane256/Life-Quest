/**
 * 装備合成をクラウド権威で行う（可能な場合）。Web `src/hooks/useCloudItemSynthesis.ts`
 * の移植（エラー分岐の設計・理由もそちらのコメント参照）。
 *
 * - 匿名確定時だけローカル合成を許可し、クラウドへは送信しない
 * - 認証済み/判定不能時はnull・4xxも含め端末内合成へ切り替えない
 * - 純粋な判断関数も明示的なallowLocalFallbackなしでは端末内合成を許可しない
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
import { captureAuthSessionGuard } from '@life-quest/core/authLifecycle';
import { getGameAuthState } from '../platform/auth';
import { useGameOperationScope } from './useGameOperationScope';

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

export interface CloudSynthesisDeps {
    synthesizeCloudItems: (itemIds: string[], idempotencyKey: string) => Promise<{ resultId: string; templateId: string } | null>;
    applyCloudSynthesisResult: (itemIds: string[], resultId: string, templateId: string) => Equipment | null;
    localSynthesizeItems: (itemIds: string[]) => Equipment | null;
    /** 匿名確定時だけtrue。省略時は許可しない。 */
    allowLocalFallback?: boolean;
    isActive?: () => boolean;
}

/**
 * 'unconfigured-fallback'（未接続=null）と'error'（5xx・ネットワーク断・
 * status=null等）は冪等キーを温存、'applied'と'client-error-fallback'（4xx）
 * は削除対象（元実装の分岐を踏襲）。
 */
export type CloudSynthesisTag = 'applied' | 'unconfigured-fallback' | 'client-error-fallback' | 'error';

/**
 * 装備合成の判断ロジック本体（ヘッダーコメントのエラー分岐方針を実装する）。
 * Reactの状態管理から切り離した純粋な非同期関数として抽出し、
 * `useCloudItemSynthesis.test.ts`から直接テストできるようにする。
 */
export async function runCloudSynthesis(
    itemIds: string[],
    idempotencyKey: string,
    deps: CloudSynthesisDeps,
): Promise<{ tag: CloudSynthesisTag; equipment: Equipment | null }> {
    const isActive = deps.isActive ?? captureAuthSessionGuard();
    if (!isActive()) return { tag: 'error', equipment: null };
    try {
        const result = await deps.synthesizeCloudItems(itemIds, idempotencyKey);
        if (!isActive()) return { tag: 'error', equipment: null };
        if (!result) {
            if (deps.allowLocalFallback !== true) return { tag: 'error', equipment: null };
            return { tag: 'unconfigured-fallback', equipment: deps.localSynthesizeItems(itemIds) };
        }
        const equipment = deps.applyCloudSynthesisResult(itemIds, result.resultId, result.templateId);
        return { tag: 'applied', equipment };
    } catch (error) {
        if (!isActive()) return { tag: 'error', equipment: null };
        // status===nullを`<500`に含めないこと（null<500はtrueに評価されるため、
        // 明示的な!==nullガードが無いとネットワーク断がclient-error扱いに
        // 誤分類され、本来温存すべき冪等キーが誤って削除されてしまう）
        if (deps.allowLocalFallback === true && error instanceof EdgeFunctionError
            && [400, 404, 409].includes(error.status ?? 0)) {
            return { tag: 'client-error-fallback', equipment: deps.localSynthesizeItems(itemIds) };
        }
        return { tag: 'error', equipment: null };
    }
}

export function useCloudItemSynthesis(): UseCloudItemSynthesisResult {
    const localSynthesizeItems = useMobileGameStore((state) => state.synthesizeItems);
    const applyCloudSynthesisResult = useMobileGameStore((state) => state.applyCloudSynthesisResult);
    const [isSynthesizing, setIsSynthesizing] = useState(false);
    const [hasError, setHasError] = useState(false);
    const idempotencyKeysRef = useRef(new Map<string, string>());
    const lastItemIdsRef = useRef<string[] | null>(null);
    const operationScope = useGameOperationScope(() => {
        idempotencyKeysRef.current.clear(); lastItemIdsRef.current = null;
        setIsSynthesizing(false); setHasError(false);
    });

    const runSynthesize = async (itemIds: string[]): Promise<Equipment | null> => {
        const operation = operationScope.begin();
        if (!operation) return null;
        itemIds = [...itemIds];
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
            const auth = await getGameAuthState();
            if (!operation.isActive()) return null;
            if (auth.kind === 'unavailable' || operation.userId !== (auth.kind === 'authenticated' ? auth.userId : null)) {
                setHasError(true); return null;
            }
            const { tag, equipment } = await runCloudSynthesis(itemIds, key, {
                synthesizeCloudItems: auth.kind === 'anonymous' ? async () => null
                    : (ids, retryKey) => synthesizeCloudItems(ids, retryKey, { isActive: operation.isActive, expectedUserId: auth.userId }),
                applyCloudSynthesisResult, localSynthesizeItems,
                allowLocalFallback: auth.kind === 'anonymous', isActive: operation.isActive,
            });
            if (!operation.isActive()) return null;
            if (tag === 'error') {
                setHasError(true);
                return null;
            }
            if (tag !== 'unconfigured-fallback') {
                idempotencyKeysRef.current.delete(synthKey);
            }
            lastItemIdsRef.current = null;
            return equipment;
        } catch {
            if (operation.isActive()) setHasError(true);
            return null;
        } finally {
            if (operation.isActive()) setIsSynthesizing(false);
            operation.finish();
        }
    };

    const synthesize = async (itemIds: string[]): Promise<Equipment | null> => {
        return runSynthesize(itemIds);
    };

    const retry = async (): Promise<Equipment | null> => {
        if (!lastItemIdsRef.current) return null;
        return runSynthesize(lastItemIdsRef.current);
    };

    return { isSynthesizing, hasError, synthesize, retry };
}
