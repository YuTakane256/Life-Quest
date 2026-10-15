/**
 * 認証ライフサイクルの共有契約（ADR-009）。
 *
 * ログイン/ログアウト時にプラットフォーム側（同期ブリッジ・outbox・ストア初期化）が
 * 実行すべき処理を、この登録簿へフックとして登録する。認証サービス（#503）は
 * セッション確立時に notifyLogin、ログアウト時に notifyLogout を呼ぶ。
 *
 * 重要な契約:
 * - notifyLogout はフックを**逐次・同期的に**実行し終えてから解決する。
 *   ログアウトAPI呼び出しの一部としてストアのメモリ即時クリア（#504実装）が
 *   完了することを保証するため、fire-and-forgetにしない。
 * - フックの1つが例外を投げても残りのフックは実行する（片付け処理の連鎖を守る）。
 */

export interface AuthLifecycleHooks {
    /** セッション確立時（ログイン・セッション復元）。userIdはJWT由来。 */
    onLogin?: (userId: string) => void | Promise<void>;
    /** ログアウト時。クラウド同期対象ストアのメモリ即時クリア等を行う。 */
    onLogout?: () => void | Promise<void>;
}

const registeredHooks = new Set<AuthLifecycleHooks>();
// 認証SDKはログイン/ログアウト通知を並行して発火しうる。新しい認証遷移が
// 始まったら、古い通知が後続フック（cloud sync等）を動かさないようにする。
let lifecycleGeneration = 0;
let scopeGeneration = 0;
let scopeUserId: string | null = null;
let lifecycleSettled: Promise<void> = Promise.resolve();
const scopeListeners = new Set<(scope: AuthSessionScope) => void>();

export interface AuthSessionScope {
    userId: string | null;
    isCurrent: () => boolean;
}

/** Lifecycle identity only, not authentication. Useful for invalidating account UI before async hooks. */
export function captureAuthSessionScope(): AuthSessionScope {
    return { userId: scopeUserId, isCurrent: captureAuthSessionGuard() };
}

export function subscribeAuthSessionScope(listener: (scope: AuthSessionScope) => void): () => void {
    scopeListeners.add(listener);
    return () => { scopeListeners.delete(listener); };
}

/** Detached UI may wait for initialization. Never await this from a lifecycle hook itself. */
export function waitForAuthLifecycleSettled(): Promise<void> {
    return lifecycleSettled;
}

/** Compare lifecycle scope only; this is not an authentication/authorization check. */
export function captureAuthSessionGuard(): () => boolean {
    const generation = scopeGeneration;
    return () => generation === scopeGeneration;
}

function updateScope(userId: string | null): void {
    if (scopeUserId === userId) return;
    scopeUserId = userId;
    scopeGeneration += 1;
    const scope = captureAuthSessionScope();
    for (const listener of [...scopeListeners]) {
        if (!scope.isCurrent()) break; // A subscriber may start a newer transition.
        try { listener(scope); } catch { /* A UI subscriber must not prevent authentication cleanup. */ }
    }
}

/** フックを登録する。戻り値で解除できる。 */
export function registerAuthLifecycleHooks(hooks: AuthLifecycleHooks): () => void {
    registeredHooks.add(hooks);
    return () => {
        registeredHooks.delete(hooks);
    };
}

/** 全フックを破棄する（テスト用）。 */
export function resetAuthLifecycleHooks(): void {
    registeredHooks.clear();
    scopeListeners.clear();
    lifecycleGeneration = 0;
    lifecycleSettled = Promise.resolve();
    scopeUserId = null;
    scopeGeneration += 1; // Teardown must invalidate already captured work.
}

async function runHooks(
    run: (hooks: AuthLifecycleHooks) => void | Promise<void>,
    shouldContinue: () => boolean = () => true,
): Promise<void> {
    for (const hooks of [...registeredHooks]) {
        if (!shouldContinue()) return;
        try {
            await run(hooks);
        } catch {
            // 1つの失敗で他の片付け処理を止めない
        }
        if (!shouldContinue()) return;
    }
}

/** セッション確立を全フックへ通知する。 */
export function notifyLogin(userId: string): Promise<void> {
    return notifyTransition(userId, (hooks) => hooks.onLogin?.(userId));
}

/** ログアウトを全フックへ通知する。全フック完了後に解決する。 */
export function notifyLogout(): Promise<void> {
    return notifyTransition(null, (hooks) => hooks.onLogout?.());
}

function notifyTransition(userId: string | null, run: (hooks: AuthLifecycleHooks) => void | Promise<void>): Promise<void> {
    const generation = ++lifecycleGeneration;
    let finish!: () => void;
    // Publish before synchronous hooks/subscribers. Reentrant transitions replace
    // this handle; completing older work must not replace the newer wait handle.
    lifecycleSettled = new Promise<void>((resolve) => { finish = resolve; });
    updateScope(userId);
    const completed = runHooks(run, () => generation === lifecycleGeneration);
    void completed.then(finish, finish);
    return completed;
}
