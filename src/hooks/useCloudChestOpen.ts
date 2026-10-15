/**
 * 宝箱開封をクラウド権威で行う（可能な場合）。
 *
 * `open_chest_apply`はDB関数として排他制御され、成功すれば装備が実際に
 * サーバー側で付与される。そのためバトル開始（`useCloudBattleStart`）とは
 * 異なり、エラー時に無条件でローカル抽選へフォールバックすると、実際には
 * サーバー側で成功していた場合（レスポンスがネットワーク断で届かなかった等）
 * にサーバーと乖離した装備をローカルに表示してしまう危険がある。
 * そのため:
 * - 匿名確定時のみ、旧ローカル宝箱をローカル`openChest`で開封する
 * - 認証済み/判定不能時はnull/404でもローカル抽選へ切り替えない
 * - canonical pull由来（`origin: 'cloud'`）の宝箱はnull/404でもフォールバックせず
 *   再送・次回pullへ委ねる。サインイン中のサーバー正を端末抽選で上書きしないため
 * - `chest_already_opened`を返すstatus 409（サーバー側は既に正常）→ エラー扱い
 *   せず`discardSyncedChest`で演出無しにローカル未開封表示だけ消す
 * - それ以外（ネットワーク断・5xx等）→ フォールバックせず`errorChestId`を
 *   セットし、呼び出し元に再送ボタンを出させる（`useCloudBattleResolve`と
 *   同じretryパターン。サーバーのidempotency_keysが二重抽選を防ぐ）
 *
 * 冪等キーはchestIdごとに保持し、再送時も同じキーを使う。
 */
import { useRef, useState } from 'react';
import { useGameStore } from '../stores/useGameStore';
import { openCloudChest, type CloudChestResult } from '../platform/gameCloud';
import { EdgeFunctionError } from '@life-quest/core/edgeFunctions';
import { captureAuthSessionGuard } from '@life-quest/core/authLifecycle';
import { getGameAuthState } from '../platform/auth';
import { useGameOperationScope } from './useGameOperationScope';

export interface UseCloudChestOpenResult {
    /** 開封処理中のchestId（ボタン無効化用）。開封中でなければnull。 */
    openingChestId: string | null;
    /** ネットワークエラー等で失敗し再送待ちのchestId。無ければnull。 */
    errorChestId: string | null;
    openChest: (chestId: string) => Promise<void>;
    /** errorChestIdと同じキーで再送する。errorChestIdが無ければ何もしない。 */
    retry: () => void;
}

export interface CloudChestOpenDeps {
    openCloudChest: (chestId: string, idempotencyKey: string) => Promise<CloudChestResult | null>;
    applyCloudChestResult: (
        chestId: string,
        itemId: string | null,
        templateId: string | null,
        starterCharacter: boolean,
    ) => void;
    discardSyncedChest: (chestId: string) => void;
    localOpenChest: (chestId: string) => void;
    /** 匿名確定かつlocal originの場合だけtrue。省略時は許可しない。 */
    allowLocalFallback?: boolean;
    isActive?: () => boolean;
}

/**
 * local originに限り、'unconfigured-fallback'（未接続=null）と
 * 'not-found-fallback'（404）はどちらもローカル開封へ落ちる。呼び出し元の冪等キー削除可否が
 * 異なる（未接続時はサーバーに何も送っていないため、そのchestIdへ最初に
 * 割り当てたキーを温存し、後で接続できたときに同じキーで送れるようにする。
 * 404はサーバーに実際に送って拒否されたことが確定しているため削除してよい）。
 */
export type CloudChestOpenOutcome =
    | 'applied' | 'unconfigured-fallback' | 'not-found-fallback' | 'discarded' | 'error';

/**
 * 宝箱開封の判断ロジック本体（ヘッダーコメントのエラー分岐方針を実装する）。
 * Reactの状態管理から切り離した純粋な非同期関数として抽出し、
 * `useCloudChestOpen.test.ts`から直接テストできるようにする。
 */
export async function runCloudChestOpen(
    chestId: string,
    idempotencyKey: string,
    deps: CloudChestOpenDeps,
): Promise<CloudChestOpenOutcome> {
    const isActive = deps.isActive ?? captureAuthSessionGuard();
    if (!isActive()) return 'error';
    try {
        const result = await deps.openCloudChest(chestId, idempotencyKey);
        if (!isActive()) return 'error';
        if (!result) {
            if (deps.allowLocalFallback !== true) return 'error';
            deps.localOpenChest(chestId);
            return 'unconfigured-fallback';
        }
        deps.applyCloudChestResult(chestId, result.itemId, result.templateId, result.starterCharacter);
        return 'applied';
    } catch (error) {
        if (!isActive()) return 'error';
        if (error instanceof EdgeFunctionError && error.status === 404) {
            if (deps.allowLocalFallback !== true) return 'error';
            deps.localOpenChest(chestId);
            return 'not-found-fallback';
        }
        if (error instanceof EdgeFunctionError && error.status === 409 && isAlreadyOpened(error)) {
            deps.discardSyncedChest(chestId);
            return 'discarded';
        }
        return 'error';
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
    const localOpenChest = useGameStore((state) => state.openChest);
    const applyCloudChestResult = useGameStore((state) => state.applyCloudChestResult);
    const discardSyncedChest = useGameStore((state) => state.discardSyncedChest);
    const [openingChestId, setOpeningChestId] = useState<string | null>(null);
    const [errorChestId, setErrorChestId] = useState<string | null>(null);
    const idempotencyKeysRef = useRef(new Map<string, string>());
    const errorRef = useRef<string | null>(null);
    const operationScope = useGameOperationScope(() => {
        idempotencyKeysRef.current.clear(); errorRef.current = null;
        setOpeningChestId(null); setErrorChestId(null);
    });

    const runOpen = async (chestId: string): Promise<void> => {
        const chest = useGameStore.getState().chestQueue.find((candidate) => candidate.id === chestId && !candidate.opened);
        if (!chest) return;
        const operation = operationScope.begin();
        if (!operation) return;
        setOpeningChestId(chestId);
        setErrorChestId(null);
        errorRef.current = null;
        let key = idempotencyKeysRef.current.get(chestId);
        if (!key) {
            key = crypto.randomUUID();
            idempotencyKeysRef.current.set(chestId, key);
        }
        try {
            const auth = await getGameAuthState();
            if (!operation.isActive()) return;
            if (auth.kind === 'unavailable' || operation.userId !== (auth.kind === 'authenticated' ? auth.userId : null)) {
                errorRef.current = chestId; setErrorChestId(chestId); return;
            }
            const outcome = await runCloudChestOpen(chestId, key, {
                openCloudChest: auth.kind === 'anonymous' ? async () => null
                    : (id, retryKey) => openCloudChest(id, retryKey, { isActive: operation.isActive, expectedUserId: auth.userId }),
                applyCloudChestResult,
                discardSyncedChest,
                localOpenChest,
                allowLocalFallback: auth.kind === 'anonymous' && chest.origin !== 'cloud',
                isActive: operation.isActive,
            });
            if (!operation.isActive()) return;
            if (outcome === 'error') {
                errorRef.current = chestId;
                setErrorChestId(chestId);
            } else if (outcome !== 'unconfigured-fallback') {
                // 未接続時はサーバーに何も送っていないため、そのchestId用の
                // 冪等キーを温存する（後で接続できたときに同じキーで送れる
                // ようにする。applied/404/409は削除して良い）
                idempotencyKeysRef.current.delete(chestId);
            }
        } catch {
            if (operation.isActive()) { errorRef.current = chestId; setErrorChestId(chestId); }
        } finally {
            if (operation.isActive()) setOpeningChestId(null);
            operation.finish();
        }
    };

    const openChest = async (chestId: string): Promise<void> => {
        await runOpen(chestId);
    };

    const retry = (): void => {
        if (!errorRef.current) return;
        void runOpen(errorRef.current);
    };

    return { openingChestId, errorChestId, openChest, retry };
}
