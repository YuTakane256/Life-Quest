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
 * クラウド合成の素材IDと再送キーは、送信前に本人の端末へ保存する。
 * 復元した操作は、古い応答から装備を作り直さず通常の同期で結果を受け取る。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useGameStore } from '../stores/useGameStore';
import { synthesizeCloudItems, type CloudSynthesisResult } from '../platform/gameCloud';
import { EdgeFunctionError } from '@life-quest/core/edgeFunctions';
import type { Equipment } from '../types';
import { captureAuthSessionGuard, captureAuthSessionScope } from '@life-quest/core/authLifecycle';
import { getGameAuthState } from '../platform/auth';
import { useGameOperationScope } from './useGameOperationScope';
import type { SavedSynthesis } from '@life-quest/core/synthesisRecovery';
import { registerSynthesisRecovery, synthesisRecovery, canSaveSynthesis, tryAcquireSynthesisSend } from '../platform/synthesisRecovery';

export interface UseCloudItemSynthesisResult {
    isSynthesizing: boolean;
    /** ネットワークエラー等で失敗し再送待ちなら`true`。 */
    hasError: boolean;
    synthesize: (itemIds: string[]) => Promise<Equipment | null>;
    /** 直前に失敗した合成を同一キーで再送する。失敗が無ければ何もしない。 */
    retry: () => Promise<Equipment | null>;
    recovery?: 'pending' | 'unreadable' | 'unavailable' | 'loading';
    recoveryMessage?: string;
    reloadRecovery?: () => Promise<void>;
    discardRecovery?: () => Promise<void>;
}

export interface CloudItemSynthesisDeps {
    synthesizeCloudItems: (itemIds: readonly string[], idempotencyKey: string) => Promise<CloudSynthesisResult | null>;
    applyCloudSynthesisResult: (ingredientIds: string[], resultId: string, templateId: string) => Equipment | null;
    localSynthesizeItems: (itemIds: string[]) => Equipment | null;
    /** 匿名確定時だけtrue。省略時は許可しない。 */
    allowLocalFallback?: boolean;
    isActive?: () => boolean;
    acceptCloudResult?: (result: { resultId: string; templateId: string }) => Promise<boolean>;
}

export type CloudItemSynthesisOutcome =
    | { status: 'applied' | 'unconfigured-fallback' | 'client-error-fallback'; equipment: Equipment | null }
    | { status: 'synced' | 'error'; equipment: null };

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
        if (deps.acceptCloudResult) {
            const apply = await deps.acceptCloudResult(result);
            if (!isActive()) return { status: 'error', equipment: null };
            if (!apply) return { status: 'synced', equipment: null };
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
    const recoveryState = useSyncExternalStore(synthesisRecovery.subscribe, synthesisRecovery.getState, synthesisRecovery.getState);
    const [recoveryMessage, setRecoveryMessage] = useState('');
    useEffect(() => registerSynthesisRecovery(), []);
    const lastItemIdsRef = useRef<string[] | null>(null);
    const operationScope = useGameOperationScope(() => {
        lastItemIdsRef.current = null;
        setIsSynthesizing(false);
        setHasError(false);
        setRecoveryMessage('');
    });

    const runSynthesize = async (requestedIds: readonly string[], pending?: SavedSynthesis): Promise<Equipment | null> => {
        const operation = operationScope.begin();
        if (!operation) return null;
        const scope = captureAuthSessionScope();
        const itemIds = [...requestedIds];
        setIsSynthesizing(true);
        setHasError(false);
        setRecoveryMessage('');
        lastItemIdsRef.current = itemIds;
        let release: (() => void) | null = null;
        try {
            const auth = await getGameAuthState();
            if (!operation.isActive()) return null;
            if (auth.kind === 'unavailable' || operation.userId !== (auth.kind === 'authenticated' ? auth.userId : null)
                || (pending && (auth.kind !== 'authenticated' || pending.userId !== auth.userId))) {
                setHasError(true);
                return null;
            }
            if (auth.kind === 'authenticated' && !canSaveSynthesis()) {
                setRecoveryMessage('このブラウザーでは合成を安全に保存できません。別のブラウザーでお試しください。');
                return null;
            }
            if (auth.kind === 'authenticated') {
                release = await tryAcquireSynthesisSend(auth.userId);
                if (!operation.isActive()) return null;
                if (!release) {
                    setRecoveryMessage('別のタブで合成を処理しています。完了してからお試しください。');
                    return null;
                }
            }
            const saved = auth.kind === 'authenticated'
                ? await synthesisRecovery.prepare(auth.userId, itemIds, () => crypto.randomUUID(), pending) : null;
            if (!operation.isActive()) return null;
            if (saved) lastItemIdsRef.current = null;
            const { status, equipment } = await runCloudItemSynthesis(
                saved ? [...saved.record.itemIds] : itemIds, saved?.record.key ?? '', {
                    synthesizeCloudItems: auth.kind === 'anonymous' ? async () => null
                        : (ids, key) => synthesizeCloudItems(ids, key, { isActive: operation.isActive, expectedUserId: auth.userId }),
                    applyCloudSynthesisResult,
                    localSynthesizeItems,
                    allowLocalFallback: auth.kind === 'anonymous',
                    isActive: operation.isActive,
                    acceptCloudResult: saved ? async (result) => {
                        if (typeof result.resultId !== 'string' || !result.resultId
                            || typeof result.templateId !== 'string' || !result.templateId) throw new Error('合成結果を確認できません。');
                        const removed = await synthesisRecovery.acknowledge(saved.record, scope);
                        return saved.fresh && removed;
                    } : undefined,
                },
            );
            if (!operation.isActive()) return null;
            if (status === 'error') {
                setHasError(true);
                return null;
            }
            lastItemIdsRef.current = null;
            if (status === 'synced') {
                setRecoveryMessage('合成結果を確認しました。同期後に持ち物へ反映されます。');
                void import('../platform/cloudSync').then(({ syncWebNow }) => {
                    if (scope.isCurrent()) return syncWebNow();
                }).catch(() => undefined);
            }
            return equipment;
        } catch {
            if (operation.isActive()) setHasError(true);
            return null;
        } finally {
            // Invalidation hides stale UI, but cannot cancel a request already sent.
            release?.();
            if (operation.isActive()) setIsSynthesizing(false);
            operation.finish();
        }
    };

    const retry = () => {
        if (recoveryState.pending) return runSynthesize(recoveryState.pending.itemIds, recoveryState.pending);
        if (lastItemIdsRef.current) return runSynthesize(lastItemIdsRef.current);
        return Promise.resolve(null);
    };
    const discardRecovery = async () => {
        const scope = captureAuthSessionScope();
        if (!scope.userId) return;
        const operation = operationScope.begin();
        if (!operation) return;
        let release: (() => void) | null = null;
        try {
            release = await tryAcquireSynthesisSend(scope.userId);
            if (!operation.isActive()) return;
            if (!release) {
                setRecoveryMessage('別のタブで合成を処理しています。完了してからお試しください。');
                return;
            }
            const removed = await synthesisRecovery.discard(recoveryState, scope);
            if (!removed || !operation.isActive()) return;
            lastItemIdsRef.current = null;
            setHasError(false);
            setRecoveryMessage('');
        } catch {
            if (operation.isActive()) setRecoveryMessage('保留を解除できませんでした。もう一度お試しください。');
        } finally {
            release?.();
            operation.finish();
        }
    };
    const recovery = recoveryState.pending ? 'pending'
        : recoveryState.status === 'ready' || recoveryState.status === 'inactive' ? undefined : recoveryState.status;

    return {
        isSynthesizing, hasError: hasError && Boolean(recoveryState.pending || lastItemIdsRef.current), synthesize: (ids) => runSynthesize(ids), retry, recovery, recoveryMessage,
        reloadRecovery: synthesisRecovery.load, discardRecovery,
    };
}
