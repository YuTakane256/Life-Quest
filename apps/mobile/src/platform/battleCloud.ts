/**
 * Mobileのゲーム操作クラウド連携（バトル・宝箱開封・装備合成・ログインボーナス）。
 *
 * リクエスト/レスポンス変換・冪等キー方針は`@life-quest/core/gameCloud`
 * （Web/Mobile共有）に集約されている。このファイルはMobile固有の依存
 * （`getMobileEdgeFunctionInvoker`、react-native/expo-secure-store経由の
 * クライアント）を注入する薄いアダプタ（ファイル名はバトル専用だった
 * 名残りだが、宝箱開封・合成も同じリクエスト/レスポンス型で連携するため
 * ここに集約している）。
 */
import { createGameCloudClient } from '@life-quest/core/gameCloud';
import { getMobileEdgeFunctionInvoker } from './edgeFunctions';
import { createMobileId } from '../utils/createMobileId';

const client = createGameCloudClient({
    getInvoker: () => getMobileEdgeFunctionInvoker(),
    generateId: createMobileId,
});

export type {
    CloudBattleAttempt,
    CloudChestResult,
    CloudLoginBonusResult,
    CloudSynthesisResult,
    ResolveBattleAttemptResponse,
} from '@life-quest/core/gameCloud';

export const startCloudBattleAttempt = client.startBattleAttempt;
export const resolveCloudBattleAttempt = client.resolveBattleAttempt;
export const openCloudChest = client.openChest;
export const synthesizeCloudItems = client.synthesizeItems;
export const claimCloudLoginBonus = client.claimLoginBonus;
