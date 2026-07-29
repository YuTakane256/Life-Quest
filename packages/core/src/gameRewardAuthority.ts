/**
 * タスク/サブタスクのローカル宝箱を許可するための小さな認証境界。
 * 各クライアントの認証リスナーが状態を更新し、ストアはネイティブ認証SDKを
 * importせずに参照できる。初期値はresolvingで、各クライアントがSupabase未設定を
 * 確認した時点でanonymousへ確定する。これにより起動順で認証復元より先に
 * ローカル報酬を確定してしまうことを防ぐ。
 */
export type GameRewardAuthorityState = 'anonymous' | 'authenticated' | 'resolving';

let state: GameRewardAuthorityState = 'resolving';
const listeners = new Set<(state: GameRewardAuthorityState) => void>();

export function getGameRewardAuthorityState(): GameRewardAuthorityState {
    return state;
}

export function setGameRewardAuthorityState(next: GameRewardAuthorityState): void {
    if (state === next) return;
    state = next;
    for (const listener of [...listeners]) listener(state);
}

/** 認証確定を待つ報酬再照合用。解除関数を返す。 */
export function subscribeGameRewardAuthority(
    listener: (state: GameRewardAuthorityState) => void,
): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
