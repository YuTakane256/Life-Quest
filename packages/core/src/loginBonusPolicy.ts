import { EdgeFunctionError } from './edgeFunctions.ts';
import type { BattleAuthState } from './battleStartPolicy.ts';
import type { CloudLoginBonusResult } from './gameCloud.ts';

/** ログインボーナスでもバトルと同じ三値の認証判定を利用する。 */
export type LoginBonusAuthState = BattleAuthState;

export type LoginBonusClaimFailureKind = 'unavailable' | 'retryable-error' | 'auth-error' | 'auth-changed' | 'rejected';

export type LoginBonusClaimResult =
    | { kind: 'local-eligible' }
    | { kind: 'cloud-granted'; bonus: CloudLoginBonusResult }
    | { kind: 'already-claimed'; bonus: CloudLoginBonusResult }
    | { kind: 'deferred' }
    | { kind: LoginBonusClaimFailureKind };

function isSameAuthenticatedUser(expected: LoginBonusAuthState, current: LoginBonusAuthState): boolean {
    return expected.kind === 'authenticated'
        && current.kind === 'authenticated'
        && expected.userId === current.userId;
}

/** Web/Mobileで共通に使う失敗時の控えめな案内文。 */
export function getLoginBonusClaimMessage(result: LoginBonusClaimResult): string | null {
    switch (result.kind) {
        case 'unavailable':
            return 'ログインボーナスの接続を確認しています。';
        case 'retryable-error':
            return 'ログインボーナスを受け取れませんでした。通信を確認して再試行してください。';
        case 'auth-error':
            return '再ログインするとログインボーナスを受け取れます。';
        case 'auth-changed':
            return 'ログイン状態が変わりました。再ログインして再試行してください。';
        case 'rejected':
            return 'ログインボーナスを確認できませんでした。画面を更新して再試行してください。';
        default:
            return null;
    }
}

/**
 * ログインボーナスのクラウド権威ポリシー。
 *
 * anonymous が確定した場合だけローカル報酬を許可する。認証済み・判定不能時は
 * null や例外をローカル付与へ変換しないため、通信障害や別端末受取でも端末内の
 * XP・宝箱・受取日を変更しない。
 */
export async function requestLoginBonusClaim(
    authState: LoginBonusAuthState,
    getCurrentAuthState: () => Promise<LoginBonusAuthState>,
    requestCloudBonus: (expectedUserId: string) => Promise<CloudLoginBonusResult | null>,
): Promise<LoginBonusClaimResult> {
    if (authState.kind === 'anonymous') return { kind: 'local-eligible' };
    if (authState.kind === 'unavailable') return { kind: 'unavailable' };

    if (!isSameAuthenticatedUser(authState, await getCurrentAuthState())) return { kind: 'auth-changed' };

    try {
        const bonus = await requestCloudBonus(authState.userId);
        if (!bonus) return { kind: 'retryable-error' };
        if (!isSameAuthenticatedUser(authState, await getCurrentAuthState())) return { kind: 'auth-changed' };
        return bonus.granted ? { kind: 'cloud-granted', bonus } : { kind: 'already-claimed', bonus };
    } catch (error) {
        if (error instanceof EdgeFunctionError) {
            if (error.code === 'unauthenticated' || error.status === 401) return { kind: 'auth-error' };
            if (error.status !== null && error.status >= 400 && error.status < 500) return { kind: 'rejected' };
        }
        return { kind: 'retryable-error' };
    }
}
