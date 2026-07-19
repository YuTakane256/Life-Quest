/**
 * Webのバトルクラウド連携。
 *
 * リクエスト/レスポンス変換・冪等キー方針は`@life-quest/core/gameCloud`
 * （Web/Mobile共有）に集約されている。このファイルはWeb固有の依存
 * （`getWebEdgeFunctionInvoker`）を注入する薄いアダプタ
 * （Mobileの`apps/mobile/src/platform/battleCloud.ts`と対称構造）。
 */
import { createGameCloudClient } from '@life-quest/core/gameCloud';
import { getWebEdgeFunctionInvoker } from './edgeFunctions';

const client = createGameCloudClient({
    getInvoker: () => getWebEdgeFunctionInvoker(),
});

export type { CloudBattleAttempt, ResolveBattleAttemptResponse } from '@life-quest/core/gameCloud';

export const startCloudBattleAttempt = client.startBattleAttempt;
export const resolveCloudBattleAttempt = client.resolveBattleAttempt;
