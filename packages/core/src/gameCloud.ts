/**
 * ゲーム操作（バトル・宝箱開封・装備合成）のサーバー権威クラウド連携。
 *
 * これらの操作はサーバー側で非決定論的な抽選（敵HP等の乱数、装備テンプレート抽選）
 * を行うため、タスク・習慣のような「ローカルで即時反映してoutboxへenqueueする」
 * fire-and-forget方式は使えない。クライアントはEdge Functionへリクエストを送り、
 * サーバーが返した結果をそのままUIへ反映するリクエスト/レスポンス型で連携する
 * （元はMobile専用のbattleCloud.tsにあった設計をWeb/Mobile共有のためcoreへ移設）。
 *
 * - 未ログイン・Edge Function未設定時はnullを返す（呼び出し元はローカル
 *   フォールバック動作に切り替える）
 * - ネットワークエラー・サーバーエラーはEdgeFunctionErrorとしてthrowする
 *   （outbox側のcode/status分類と同じ表現に統一。呼び出し元でtry/catchする）
 * - open_chest/synthesize_itemsはUI層から冪等キーを受け取る（内部生成しない）。
 *   失敗時に呼び出し元が同じキーで再送できるようにするため（サーバーの
 *   idempotency_keysが同一結果を返し、二重抽選・二重付与を防ぐ）
 * - sell_item（決定論的操作）はここに含めない。ローカルで即時XP付与して
 *   outbox（RPC_OPERATIONS）へenqueueする方式が適する
 *
 * 依存はEdgeFunctionInvoker取得関数のみ（cloudOutboxControllerのdepsパターンと
 * 同型）。react-native/DOM等プラットフォーム固有のクライアント取得は
 * 呼び出し側（apps/mobile/src/platform、src/platform）に閉じ込める。
 */
import { EdgeFunctionError, type EdgeFunctionInvoker } from './edgeFunctions.ts';
import type { BattleAction, BattleActors } from './battle.ts';

interface StartBattleAttemptResponse {
    battle_attempt_id: string;
    enemy_snapshot: {
        stage: number;
        name: string;
        maxHp: number;
        attack: number;
        defense: number;
        xpReward: number;
    };
    player_snapshot: {
        name: string;
        level: number;
        attack: number;
        defense: number;
        maxHp: number;
    };
}

export interface CloudBattleAttempt {
    battleAttemptId: string;
    actors: BattleActors;
}

export interface ResolveBattleAttemptResponse {
    outcome: 'victory' | 'defeat';
    granted: boolean;
    already_resolved?: boolean;
}

interface OpenChestResponse {
    item_id: string | null;
    version: number;
    starter_character?: boolean;
}

export interface CloudChestResult {
    itemId: string | null;
    starterCharacter: boolean;
}

interface SynthesizeItemsResponse {
    result_id: string;
    version: number;
}

export interface CloudSynthesisResult {
    resultId: string;
}

export interface GameCloudClient {
    /** バトル開始。クラウド未接続ならnull（呼び出し元はローカル計算にフォールバック）。 */
    startBattleAttempt: (stage: number) => Promise<CloudBattleAttempt | null>;
    /** バトル決着。クラウド未接続なら例外。 */
    resolveBattleAttempt: (
        battleAttemptId: string,
        actions: readonly BattleAction[],
    ) => Promise<ResolveBattleAttemptResponse>;
    /** 宝箱開封。クラウド未接続ならnull。idempotencyKeyは呼び出し元が管理し、失敗時の再送に使う。 */
    openChest: (chestId: string, idempotencyKey: string) => Promise<CloudChestResult | null>;
    /** 装備合成。クラウド未接続ならnull。idempotencyKeyは呼び出し元が管理し、失敗時の再送に使う。 */
    synthesizeItems: (itemIds: readonly string[], idempotencyKey: string) => Promise<CloudSynthesisResult | null>;
}

export interface GameCloudClientDeps {
    getInvoker: () => Promise<EdgeFunctionInvoker | null> | EdgeFunctionInvoker | null;
    /** バトル系操作の冪等キー生成（open_chest/synthesize_itemsは呼び出し元が明示的に渡すため対象外）。 */
    generateId?: () => string;
}

export function createGameCloudClient(deps: GameCloudClientDeps): GameCloudClient {
    const { getInvoker } = deps;
    const generateId = deps.generateId ?? (() => crypto.randomUUID());

    return {
        startBattleAttempt: async (stage) => {
            const invoker = await getInvoker();
            if (!invoker) return null;
            const response = await invoker<StartBattleAttemptResponse>('start_battle_attempt', {
                stage,
                idempotencyKey: generateId(),
            });
            return {
                battleAttemptId: response.battle_attempt_id,
                actors: {
                    player: {
                        attack: response.player_snapshot.attack,
                        defense: response.player_snapshot.defense,
                        maxHp: response.player_snapshot.maxHp,
                    },
                    enemy: response.enemy_snapshot,
                    playerLevel: response.player_snapshot.level,
                    playerName: response.player_snapshot.name,
                },
            };
        },

        resolveBattleAttempt: async (battleAttemptId, actions) => {
            const invoker = await getInvoker();
            if (!invoker) throw new EdgeFunctionError('unconfigured', 'クラウド接続が利用できません');
            return await invoker<ResolveBattleAttemptResponse>('resolve_battle_attempt', {
                battleAttemptId,
                actions,
                idempotencyKey: generateId(),
            });
        },

        openChest: async (chestId, idempotencyKey) => {
            const invoker = await getInvoker();
            if (!invoker) return null;
            const response = await invoker<OpenChestResponse>('open_chest', {
                chestId,
                idempotencyKey,
            });
            return {
                itemId: response.item_id,
                starterCharacter: response.starter_character === true,
            };
        },

        synthesizeItems: async (itemIds, idempotencyKey) => {
            const invoker = await getInvoker();
            if (!invoker) return null;
            const response = await invoker<SynthesizeItemsResponse>('synthesize_items', {
                itemIds,
                idempotencyKey,
            });
            return { resultId: response.result_id };
        },
    };
}
