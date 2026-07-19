/**
 * Mobileのバトルクラウド連携。
 *
 * リクエスト/レスポンス変換・冪等キー方針は`@life-quest/core/gameCloud`
 * （Web/Mobile共有）に集約されている。このファイルはMobile固有の依存
 * （`getMobileEdgeFunctionInvoker`、react-native/expo-secure-store経由の
 * クライアント）を注入する薄いアダプタ。
 */
import { createGameCloudClient } from '@life-quest/core/gameCloud';
import { getMobileEdgeFunctionInvoker } from './edgeFunctions';
import { createMobileId } from '../utils/createMobileId';

const client = createGameCloudClient({
    getInvoker: () => getMobileEdgeFunctionInvoker(),
    generateId: createMobileId,
});

export type { CloudBattleAttempt, ResolveBattleAttemptResponse } from '@life-quest/core/gameCloud';

export const startCloudBattleAttempt = client.startBattleAttempt;
export const resolveCloudBattleAttempt = client.resolveBattleAttempt;
