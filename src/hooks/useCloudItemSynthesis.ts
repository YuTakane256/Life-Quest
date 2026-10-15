/**
 * 装備合成をクラウド権威で行う（可能な場合）。
 *
 * `synthesize_items_apply`はDB関数として排他制御され、成功すれば結果装備が
 * 実際にサーバー側で付与され素材は消費される。`useCloudChestOpen`と同じ
 * 方針でエラーを分岐するが、合成は409の意味がchestとは異なる点に注意:
 * - 匿名確定時だけローカル合成を許可し、クラウドへは送信しない
 * - 認証済み/判定不能時はnull・4xxも含め端末内合成へ切り替えない
 * - 純粋な判断関数も明示的なallowLocalFallbackなしでは端末内合成を許可しない
 * - それ以外（ネットワーク断・5xx等）→ フォールバックせずエラー状態にし、
 *   呼び出し元に再送させる（`useCloudBattleResolve`と同じretryパターン。
 *   サーバーのidempotency_keysが二重消費を防ぐ）
 *
 * 冪等キーは素材ID集合（ソート済み）ごとに保持し、再送時も同じキーを使う。
 */
import { useRef, useState } from 'react';
import { useGameStore } from '../stores/useGameStore';
import { synthesizeCloudItems, type CloudSynthesisResult } from '../platform/gameCloud';
import { EdgeFunctionError } from '@life-quest/core/edgeFunctions';
import type { Equipment } from '../types';
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

export function synthKeyOf(itemIds: string[]): string {
    return [...itemIds].sort().join(',');
}

export interface CloudItemSynthesisDeps {
    synthesizeCloudItems: (itemIds: readonly string[], idempotencyKey: string) => Promise<CloudSynthesisResult | null>;
    applyCloudSynthesisResult: (ingredientIds: string[], resultId: string, templateId: string) => Equipment | null;
    localSynthesizeItems: (itemIds: string[]) => Equipment | null;
    /** 匿名確定時だけtrue。省略時は許可しない。 */
    allowLocalFallback?: boolean;
    isActive?: () => boolean;
}

/**
 * 'unconfigured-fallback'（未接続=null）と'client-error-fallback'（4xx）は
 * どちらもローカル合成へ落ちる点は同じだが、呼び出し元の冪等キー削除可否が
 * 異なる（未接続時はサーバーに何も送っていないため、その素材集合へ最初に
 * 割り当てたキーを温存し、後で接続できたときに同じキーで送れるようにする。
 * 4xxはサーバーに実際に送って拒否されたことが確定しているため削除してよい）。
 */
export type CloudItemSynthesisOutcome =
    | { status: 'applied' | 'unconfigured-fallback' | 'client-error-fallback'; equipment: Equipment | null }
    | { status: 'error'; equipment: null };

/**
 * 装備合成の判断ロジック本体（ヘッダーコメントのエラー分岐方針を実装する）。
 * Reactの状態管理から切り離した純粋な非同期関数として抽出し、
 * `useCloudItemSynthesis.test.ts`から直接テストできるようにする。
 */
export async function runCloudItemSynthesis(
    itemIds: string[],
    idempotencyKey: string,
    deps: CloudItemSynthesisDeps,
): Promise<CloudItemSynthesisOutcome> {
    const isActive = deps.isActive ?? captureAuthSessionGuard();
    if (!isActive()) return { status: 'error', equipment: null };
    try {
        const result = await deps.synthesizeCloudItems(itemIds, idempotencyKey);
        if (!isActive()) return { status: 'error', equipment: null };
        if (!result) {
            if (deps.allowLocalFallback !== true) return { status: 'error', equipment: null };
            return { status: 'unconfigured-fallback', equipment: deps.localSynthesizeItems(itemIds) };
        }
        return {
            status: 'applied',
            equipment: deps.applyCloudSynthesisResult(itemIds, result.resultId, result.templateId),
        };
    } catch (error) {
        if (!isActive()) return { status: 'error', equipment: null };
        if (deps.allowLocalFallback === true && error instanceof EdgeFunctionError
            && [400, 404, 409].includes(error.status ?? 0)) {
            return { status: 'client-error-fallback', equipment: deps.localSynthesizeItems(itemIds) };
        }
        return { status: 'error', equipment: null };
    }
}

export function useCloudItemSynthesis(): UseCloudItemSynthesisResult {
    const localSynthesizeItems = useGameStore((state) => state.synthesizeItems);
    const applyCloudSynthesisResult = useGameStore((state) => state.applyCloudSynthesisResult);
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
            key = crypto.randomUUID();
            idempotencyKeysRef.current.set(synthKey, key);
        }
        try {
            const auth = await getGameAuthState();
            if (!operation.isActive()) return null;
            if (auth.kind === 'unavailable' || operation.userId !== (auth.kind === 'authenticated' ? auth.userId : null)) {
                setHasError(true); return null;
            }
            const outcome = await runCloudItemSynthesis(itemIds, key, {
                synthesizeCloudItems: auth.kind === 'anonymous' ? async () => null
                    : (ids, retryKey) => synthesizeCloudItems(ids, retryKey, { isActive: operation.isActive, expectedUserId: auth.userId }),
                applyCloudSynthesisResult,
                localSynthesizeItems,
                allowLocalFallback: auth.kind === 'anonymous',
                isActive: operation.isActive,
            });
            if (!operation.isActive()) return null;
            if (outcome.status === 'error') {
                setHasError(true);
                return null;
            }
            if (outcome.status !== 'unconfigured-fallback') {
                // 未接続時はサーバーに何も送っていないため、この素材集合用の
                // 冪等キーを温存する（後で接続できたときに同じキーで送れる
                // ようにする。applied/4xxは削除して良い）
                idempotencyKeysRef.current.delete(synthKey);
            }
            lastItemIdsRef.current = null;
            return outcome.equipment;
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
