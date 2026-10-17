/**
 * ゲーム操作（バトル・宝箱開封・装備合成・ログインボーナス）のサーバー権威クラウド連携。
 *
 * これらの操作はサーバー側で非決定論的な抽選（敵HP等の乱数、装備テンプレート抽選）
 * を行うため、タスク・習慣のような「ローカルで即時反映してoutboxへenqueueする」
 * fire-and-forget方式は使えない。クライアントはEdge Functionへリクエストを送り、
 * サーバーが返した結果をそのままUIへ反映するリクエスト/レスポンス型で連携する
 * （元はMobile専用のbattleCloud.tsにあった設計をWeb/Mobile共有のためcoreへ移設）。
 *
 * - 未ログイン・Edge Function未設定時はnullを返す。報酬を伴う操作の呼び出し元は
 *   認証状態に応じた安全なポリシーを適用する（認証済みのローカル報酬生成は禁止）
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
import { EdgeFunctionError, type EdgeFunctionInvoker, type EdgeFunctionCallOptions } from './edgeFunctions.ts';
import { captureAuthSessionScope } from './authLifecycle.ts';
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
    template_id: string | null;
    version: number;
    starter_character?: boolean;
}

export interface CloudChestResult {
    itemId: string | null;
    /** 排出装備のテンプレートID。blue（スターター）宝箱等、装備を排出しない場合はnull */
    templateId: string | null;
    starterCharacter: boolean;
}

interface SynthesizeItemsResponse {
    result_id: string;
    template_id: string;
    version: number;
}

export interface CloudSynthesisResult {
    resultId: string;
    templateId: string;
}

interface ClaimLoginBonusResponse {
    granted: boolean;
    already_claimed?: boolean;
    claim_date: string;
    streak: number;
    xp: number;
    chest_label: string | null;
    version: number;
}

export interface CloudLoginBonusResult {
    /** サーバーがXP・宝箱を実際に付与したか（同日に別端末等から既に請求済みならfalse） */
    granted: boolean;
    /** 同日の請求済みを正常応答として返す。 */
    alreadyClaimed: boolean;
    /** サーバーが確定したJST日付。 */
    claimDate: string;
    /** サーバーが算出した現在の連続ログイン日数（grantedがfalseでも現在値が返る） */
    streak: number;
    xp: number;
    chestLabel: string | null;
}

export interface GameCloudClient {
    /**
     * バトル開始。expectedUserIdはJWT主体との競合検出専用で、所有者の決定には使わない。
     * クラウド未接続ならnull。認証済み呼び出し元はローカル開始へ切り替えない。
     */
    startBattleAttempt: (stage: number, idempotencyKey: string, expectedUserId: string, options?: EdgeFunctionCallOptions) => Promise<CloudBattleAttempt | null>;
    /** バトル決着。クラウド未接続なら例外。 */
    resolveBattleAttempt: (
        battleAttemptId: string,
        actions: readonly BattleAction[],
        options?: EdgeFunctionCallOptions & { idempotencyKey?: string },
    ) => Promise<ResolveBattleAttemptResponse>;
    /** 宝箱開封。クラウド未接続ならnull。idempotencyKeyは呼び出し元が管理し、失敗時の再送に使う。 */
    openChest: (chestId: string, idempotencyKey: string, options?: EdgeFunctionCallOptions) => Promise<CloudChestResult | null>;
    /** 装備合成。クラウド未接続ならnull。idempotencyKeyは呼び出し元が管理し、失敗時の再送に使う。 */
    synthesizeItems: (itemIds: readonly string[], idempotencyKey: string, options?: EdgeFunctionCallOptions) => Promise<CloudSynthesisResult | null>;
    /**
     * ログインボーナス請求。クラウド未接続ならnull。サーバーが「今日分か」の
     * 判定・streak算出・XP/宝箱付与を行うため、クライアントは日付やstreakを
     * 送らない（habitのclaim_habit_bonusと同じ「クライアントの自己申告を
     * 信用しない」方針）。呼び出し元は日付単位で安定したidempotencyKeyを渡し、
     * リトライでも同じ要求として再送する。
     */
    claimLoginBonus: (idempotencyKey?: string, expectedUserId?: string, options?: EdgeFunctionCallOptions) => Promise<CloudLoginBonusResult | null>;
}

export interface GameCloudClientDeps {
    getInvoker: () => Promise<EdgeFunctionInvoker | null> | EdgeFunctionInvoker | null;
    /** バトル系操作の冪等キー生成（open_chest/synthesize_itemsは呼び出し元が明示的に渡すため対象外）。 */
    generateId?: () => string;
}

export function createGameCloudClient(deps: GameCloudClientDeps): GameCloudClient {
    const { getInvoker } = deps;
    const generateId = deps.generateId ?? (() => crypto.randomUUID());

    async function invokeOwned<T>(name: string, body: Record<string, unknown>, options?: EdgeFunctionCallOptions): Promise<T | null> {
        const scope = captureAuthSessionScope();
        const isActive = () => scope.isCurrent() && (options?.isActive() ?? true);
        const assertActive = () => {
            if (!isActive()) throw new EdgeFunctionError('stale-session', 'ログイン状態が変わりました');
        };
        assertActive();
        const invoker = await getInvoker();
        assertActive();
        if (!invoker) return null;
        const result = await invoker<T>(name, body, {
            isActive,
            expectedUserId: options?.expectedUserId ?? scope.userId ?? undefined,
        });
        assertActive();
        return result;
    }

    return {
        startBattleAttempt: async (stage, idempotencyKey, expectedUserId, options) => {
            const response = await invokeOwned<StartBattleAttemptResponse>('start_battle_attempt', {
                stage,
                idempotencyKey,
                // JWT以外で所有者を決めることはない。これは開始要求の途中で
                // セッション主体が切り替わった競合をEdge Functionで検出するためだけの値。
                expectedUserId,
            }, { isActive: options?.isActive ?? (() => true), expectedUserId });
            if (!response) return null;
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

        resolveBattleAttempt: async (battleAttemptId, actions, options) => {
            const response = await invokeOwned<ResolveBattleAttemptResponse>('resolve_battle_attempt', {
                battleAttemptId,
                actions: actions.map((action) => ({ ...action })),
                idempotencyKey: options?.idempotencyKey ?? generateId(),
            }, options);
            if (!response) throw new EdgeFunctionError('unconfigured', 'クラウド接続が利用できません');
            return response;
        },

        openChest: async (chestId, idempotencyKey, options) => {
            const response = await invokeOwned<OpenChestResponse>('open_chest', {
                chestId,
                idempotencyKey,
            }, options);
            if (!response) return null;
            return {
                itemId: response.item_id,
                templateId: response.template_id,
                starterCharacter: response.starter_character === true,
            };
        },

        synthesizeItems: async (itemIds, idempotencyKey, options) => {
            const response = await invokeOwned<SynthesizeItemsResponse>('synthesize_items', {
                itemIds: [...itemIds],
                idempotencyKey,
            }, options);
            if (!response) return null;
            return { resultId: response.result_id, templateId: response.template_id };
        },

        claimLoginBonus: async (idempotencyKey = generateId(), expectedUserId, options) => {
            const response = await invokeOwned<ClaimLoginBonusResponse>('claim_login_bonus', {
                idempotencyKey,
                ...(expectedUserId === undefined ? {} : { expectedUserId }),
            }, { isActive: options?.isActive ?? (() => true), expectedUserId: expectedUserId ?? options?.expectedUserId });
            if (!response) return null;
            return {
                granted: response.granted,
                alreadyClaimed: response.already_claimed === true || response.granted === false,
                claimDate: response.claim_date,
                streak: response.streak,
                xp: response.xp,
                chestLabel: response.chest_label,
            };
        },
    };
}
