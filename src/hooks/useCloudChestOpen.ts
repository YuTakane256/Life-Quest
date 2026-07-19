/**
 * 宝箱開封をクラウド権威で行う（可能な場合）。
 *
 * `open_chest_apply`はDB関数として排他制御され、成功すれば装備が実際に
 * サーバー側で付与される。そのためバトル開始（`useCloudBattleStart`）とは
 * 異なり、エラー時に無条件でローカル抽選へフォールバックすると、実際には
 * サーバー側で成功していた場合（レスポンスがネットワーク断で届かなかった等）
 * にサーバーと乖離した装備をローカルに表示してしまう危険がある。
 * そのため:
 * - `openCloudChest`が`null`を返す（未ログイン・Edge Function未設定）→
 *   サーバーに何も送っていないので無条件でローカル`openChest`へフォールバック
 * - `EdgeFunctionError`でstatus 404（サーバーがそのchestIdを知らない＝
 *   ローカル生成IDで未同期の宝箱。`checkGachaMilestones`はクラウド有効時も
 *   ローカルIDで宝箱を積むため、次回pull到着までの間このケースが起こり得る）
 *   → ローカル`openChest`へフォールバック（`seedGame`が次回pullで丸ごと
 *   上書きするため、最終的にサーバーの実態へ収束する）
 * - status 409（`chest_already_opened`。サーバー側は既に正常）→ エラー扱い
 *   せず`discardSyncedChest`で演出無しにローカル未開封表示だけ消す
 * - それ以外（ネットワーク断・5xx等）→ フォールバックせず`errorChestId`を
 *   セットし、呼び出し元に再送ボタンを出させる（`useCloudBattleResolve`と
 *   同じretryパターン。サーバーのidempotency_keysが二重抽選を防ぐ）
 *
 * 冪等キーはchestIdごとに保持し、再送時も同じキーを使う。
 */
import { useRef, useState } from 'react';
import { useGameStore } from '../stores/useGameStore';
import { openCloudChest } from '../platform/gameCloud';
import { EdgeFunctionError } from '@life-quest/core/edgeFunctions';

export interface UseCloudChestOpenResult {
    /** 開封処理中のchestId（ボタン無効化用）。開封中でなければnull。 */
    openingChestId: string | null;
    /** ネットワークエラー等で失敗し再送待ちのchestId。無ければnull。 */
    errorChestId: string | null;
    openChest: (chestId: string) => Promise<void>;
    /** errorChestIdと同じキーで再送する。errorChestIdが無ければ何もしない。 */
    retry: () => void;
}

export function useCloudChestOpen(): UseCloudChestOpenResult {
    const localOpenChest = useGameStore((state) => state.openChest);
    const applyCloudChestResult = useGameStore((state) => state.applyCloudChestResult);
    const discardSyncedChest = useGameStore((state) => state.discardSyncedChest);
    const [openingChestId, setOpeningChestId] = useState<string | null>(null);
    const [errorChestId, setErrorChestId] = useState<string | null>(null);
    const idempotencyKeysRef = useRef(new Map<string, string>());

    const runOpen = async (chestId: string): Promise<void> => {
        setOpeningChestId(chestId);
        setErrorChestId(null);
        let key = idempotencyKeysRef.current.get(chestId);
        if (!key) {
            key = crypto.randomUUID();
            idempotencyKeysRef.current.set(chestId, key);
        }
        try {
            const result = await openCloudChest(chestId, key);
            if (!result) {
                localOpenChest(chestId);
                return;
            }
            applyCloudChestResult(chestId, result.itemId, result.templateId, result.starterCharacter);
            idempotencyKeysRef.current.delete(chestId);
        } catch (error) {
            if (error instanceof EdgeFunctionError && error.status === 404) {
                localOpenChest(chestId);
                idempotencyKeysRef.current.delete(chestId);
                return;
            }
            if (error instanceof EdgeFunctionError && error.status === 409) {
                discardSyncedChest(chestId);
                idempotencyKeysRef.current.delete(chestId);
                return;
            }
            setErrorChestId(chestId);
        } finally {
            setOpeningChestId(null);
        }
    };

    const openChest = async (chestId: string): Promise<void> => {
        if (openingChestId) return;
        await runOpen(chestId);
    };

    const retry = (): void => {
        if (!errorChestId || openingChestId) return;
        void runOpen(errorChestId);
    };

    return { openingChestId, errorChestId, openChest, retry };
}
