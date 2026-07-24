/**
 * NetInfoの最初の通知は「現在オンライン」であることが多いため、再接続として
 * 扱わない。明確な offline -> online の遷移だけを回復処理へ渡す。
 */
export function createReconnectDetector(onReconnect: () => void): (isOnline: boolean | null) => void {
    let previous: boolean | null = null;

    return (isOnline: boolean | null): void => {
        // NetInfoのnullは接続可否の取得途中。ここでonline扱いすると
        // false -> null -> true の実再接続を見逃すため、状態を更新しない。
        if (isOnline === null) return;
        if (previous === false && isOnline) onReconnect();
        previous = isOnline;
    };
}

/** NetInfoの接続状態を、再接続検知用の true / false / 不明へ正規化する。 */
export function resolveNetworkOnlineState(state: {
    isConnected: boolean | null;
    isInternetReachable: boolean | null;
}): boolean | null {
    if (state.isConnected === false) return false;
    if (state.isInternetReachable === null) return null;
    return state.isConnected === true && state.isInternetReachable === true;
}
