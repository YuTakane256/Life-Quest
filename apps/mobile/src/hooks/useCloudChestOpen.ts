/**
 * 宝箱開封をクラウド権威で行う（可能な場合）。Web `src/hooks/useCloudChestOpen.ts`
 * の移植（エラー分岐の設計はWebと同一。詳細な理由もそちらのコメント参照）。
 *
 * - 匿名確定かつ旧ローカル宝箱のみ端末内で開封する
 * - 認証済み/判定不能時はnull/404でもローカル抽選へ切り替えない
 * - canonical pull由来（`origin: 'cloud'`）の宝箱はnull/404でもフォールバックせず
 *   再送・次回pullへ委ねる
 * - `chest_already_opened`を返すstatus 409（サーバー側は既に正常）→ エラー扱い
 *   せず`discardSyncedChest`で演出無しにローカル未開封表示だけ消す
 * - それ以外（ネットワーク断・5xx等）→ フォールバックせず`errorChestId`を
 *   セットし、呼び出し元に再送させる
 *
 * クラウドでは所有者と宝箱IDから再送キーを復元する。
 * 以前の結果は通常同期で受け取り、古い装備や演出を再作成しない。
 */
import { useRef, useState } from 'react';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { openCloudChest, type CloudChestResult } from '../platform/battleCloud';
import { chestOpenRetryKey } from '@life-quest/core/rewards';
import { EdgeFunctionError } from '@life-quest/core/edgeFunctions';
import type { Equipment } from '@life-quest/core/equipment';
import { captureAuthSessionGuard } from '@life-quest/core/authLifecycle';
import { getGameAuthState } from '../platform/auth';
import { useGameOperationScope } from './useGameOperationScope';

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
    /** 匿名確定かつlocal originの場合だけtrue。省略時は許可しない。 */
    allowLocalFallback?: boolean;
    syncConfirmedChest?: (chestId: string) => Promise<boolean>;
    isActive?: () => boolean;
}

export type CloudChestOpenTag = 'applied' | 'unconfigured-fallback' | 'not-found-fallback' | 'discarded' | 'confirmed' | 'error';

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
    const isActive = deps.isActive ?? captureAuthSessionGuard();
    if (!isActive()) return { tag: 'error', equipment: null };
    try {
        const result = await deps.openCloudChest(chestId, idempotencyKey);
        if (!isActive()) return { tag: 'error', equipment: null };
        if (!result) {
            if (deps.allowLocalFallback !== true) return { tag: 'error', equipment: null };
            return { tag: 'unconfigured-fallback', equipment: deps.localOpenChest(chestId) };
        }
        if (result.requiresCanonicalSync) {
            const confirmed = await deps.syncConfirmedChest?.(chestId);
            return { tag: confirmed && isActive() ? 'confirmed' : 'error', equipment: null };
        }
        const equipment = deps.applyCloudChestResult(chestId, result.itemId, result.templateId, result.starterCharacter);
        return { tag: 'applied', equipment };
    } catch (error) {
        if (!isActive()) return { tag: 'error', equipment: null };
        if (error instanceof EdgeFunctionError && error.status === 404) {
            if (deps.allowLocalFallback !== true) return { tag: 'error', equipment: null };
            return { tag: 'not-found-fallback', equipment: deps.localOpenChest(chestId) };
        }
        if (error instanceof EdgeFunctionError && error.status === 409 && isAlreadyOpened(error)) {
            deps.discardSyncedChest(chestId);
            return { tag: 'discarded', equipment: null };
        }
        return { tag: 'error', equipment: null };
    }
}

/** 409のキー衝突等を開封済みと取り違えない。 */
function isAlreadyOpened(error: EdgeFunctionError): boolean {
    const prefix = 'open_chest failed: 409 ';
    if (!error.message.startsWith(prefix)) return false;
    try {
        return JSON.parse(error.message.slice(prefix.length))?.error === 'chest_already_opened';
    } catch {
        return false;
    }
}

export function useCloudChestOpen(): UseCloudChestOpenResult {
    const localOpenChest = useMobileGameStore((state) => state.openChest);
    const applyCloudChestResult = useMobileGameStore((state) => state.applyCloudChestResult);
    const discardSyncedChest = useMobileGameStore((state) => state.discardSyncedChest);
    const [openingChestId, setOpeningChestId] = useState<string | null>(null);
    const [errorChestId, setErrorChestId] = useState<string | null>(null);
    const errorRef = useRef<string | null>(null);
    const operationScope = useGameOperationScope(() => {
        errorRef.current = null;
        setOpeningChestId(null); setErrorChestId(null);
    });

    const runOpen = async (chestId: string): Promise<CloudChestOpenOutcome> => {
        const chest = useMobileGameStore.getState().chestQueue.find((candidate) => candidate.id === chestId && !candidate.opened);
        if (!chest) return PENDING;
        const operation = operationScope.begin();
        if (!operation) return PENDING;
        setOpeningChestId(chestId);
        setErrorChestId(null);
        errorRef.current = null;
        try {
            const auth = await getGameAuthState();
            if (!operation.isActive()) return PENDING;
            if (auth.kind === 'unavailable' || operation.userId !== (auth.kind === 'authenticated' ? auth.userId : null)) {
                errorRef.current = chestId; setErrorChestId(chestId); return PENDING;
            }
            if (!useMobileGameStore.getState().chestQueue.some((candidate) => candidate.id === chestId && !candidate.opened)) return PENDING;
            const key = auth.kind === 'authenticated' ? chestOpenRetryKey(auth.userId, chestId) : chestId;
            const { tag, equipment } = await runCloudChestOpen(chestId, key, {
                openCloudChest: auth.kind === 'anonymous' ? async () => null
                    : (id, retryKey) => openCloudChest(id, retryKey, { isActive: operation.isActive, expectedUserId: auth.userId }),
                syncConfirmedChest: async (id) => {
                    const { syncMobileNow } = await import('../platform/cloudSync');
                    if (!operation.isActive()) return false;
                    await syncMobileNow();
                    return !useMobileGameStore.getState().chestQueue.some((candidate) => candidate.id === id && !candidate.opened);
                },
                applyCloudChestResult,
                discardSyncedChest,
                localOpenChest,
                allowLocalFallback: auth.kind === 'anonymous' && chest.origin !== 'cloud',
                isActive: operation.isActive,
            });
            if (!operation.isActive()) return PENDING;
            if (tag === 'error') {
                errorRef.current = chestId;
                setErrorChestId(chestId);
                return PENDING;
            }
            if (tag === 'discarded' || tag === 'confirmed') return PENDING;
            return { status: 'opened', equipment };
        } catch {
            if (operation.isActive()) { errorRef.current = chestId; setErrorChestId(chestId); }
            return PENDING;
        } finally {
            if (operation.isActive()) setOpeningChestId(null);
            operation.finish();
        }
    };

    const openChest = async (chestId: string): Promise<CloudChestOpenOutcome> => {
        return runOpen(chestId);
    };

    const retry = async (): Promise<CloudChestOpenOutcome> => {
        if (!errorRef.current) return PENDING;
        return runOpen(errorRef.current);
    };

    return { openingChestId, errorChestId, openChest, retry };
}
