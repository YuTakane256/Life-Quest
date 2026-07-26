import { EdgeFunctionError } from './edgeFunctions.ts';

/** 操作時点で確認したクラウド認証の状態。 */
export type BattleAuthState =
    | { kind: 'authenticated'; userId: string }
    | { kind: 'anonymous' }
    | { kind: 'unavailable' };

export type BattleStartFailureKind = 'unavailable' | 'retryable-error' | 'auth-error' | 'auth-changed' | 'rejected';

export type BattleStartResult<TAttempt> =
    | { kind: 'local-started' }
    | { kind: 'cloud-started'; attempt: TAttempt }
    | { kind: BattleStartFailureKind };

/** 同一画面での二重開始を同期的に止める小さなゲート。 */
export interface BattleStartGate {
    tryEnter: () => boolean;
    leave: () => void;
}

export function createBattleStartGate(): BattleStartGate {
    let inFlight = false;
    return {
        tryEnter: () => {
            if (inFlight) return false;
            inFlight = true;
            return true;
        },
        leave: () => {
            inFlight = false;
        },
    };
}

function isSameAuthenticatedUser(expected: BattleAuthState, current: BattleAuthState): boolean {
    return expected.kind === 'authenticated'
        && current.kind === 'authenticated'
        && expected.userId === current.userId;
}

/** UIでWeb/Mobile共通に使う、開始失敗時の案内。 */
export function getBattleStartMessage(result: BattleStartResult<unknown>): string | null {
    switch (result.kind) {
        case 'unavailable':
            return '認証状態を確認できません。通信を確認して再試行してください。';
        case 'retryable-error':
            return '通信を確認して、もう一度お試しください。';
        case 'auth-error':
            return 'ログインの有効期限が切れました。再ログインしてください。';
        case 'auth-changed':
            return 'ログイン状態が変わりました。再ログインして再試行してください。';
        case 'rejected':
            return 'バトル情報を更新して、もう一度お試しください。';
        default:
            return null;
    }
}

export function isBattleStartSuccess<TAttempt>(result: BattleStartResult<TAttempt>): result is Extract<BattleStartResult<TAttempt>, { kind: 'local-started' | 'cloud-started' }> {
    return result.kind === 'local-started' || result.kind === 'cloud-started';
}

/**
 * クラウド権威バトルの開始可否を決定する純粋な共有ポリシー。
 *
 * anonymous のときだけローカル開始を許可する。authenticated/unavailable は
 * null・例外をローカル戦闘へ変換しないため、端末内で報酬が発生しない。
 */
export async function requestBattleStart<TAttempt>(
    authState: BattleAuthState,
    getCurrentAuthState: () => Promise<BattleAuthState>,
    requestCloudAttempt: (expectedUserId: string) => Promise<TAttempt | null>,
): Promise<BattleStartResult<TAttempt>> {
    if (authState.kind === 'anonymous') return { kind: 'local-started' };
    if (authState.kind === 'unavailable') return { kind: 'unavailable' };

    // getSessionとEdge Function呼び出しの間にログアウト/別ユーザーへの切替が
    // 起きても、観測した主体と異なるセッションで戦闘を開始しない。
    if (!isSameAuthenticatedUser(authState, await getCurrentAuthState())) return { kind: 'auth-changed' };

    try {
        const attempt = await requestCloudAttempt(authState.userId);
        if (!attempt) return { kind: 'retryable-error' };
        if (!isSameAuthenticatedUser(authState, await getCurrentAuthState())) return { kind: 'auth-changed' };
        return { kind: 'cloud-started', attempt };
    } catch (error) {
        if (error instanceof EdgeFunctionError) {
            if (error.code === 'unauthenticated' || error.status === 401) return { kind: 'auth-error' };
            if (error.status !== null && error.status >= 400 && error.status < 500) return { kind: 'rejected' };
        }
        return { kind: 'retryable-error' };
    }
}
