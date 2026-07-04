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
}

async function runHooks(run: (hooks: AuthLifecycleHooks) => void | Promise<void>): Promise<void> {
    for (const hooks of [...registeredHooks]) {
        try {
            await run(hooks);
        } catch {
            // 1つの失敗で他の片付け処理を止めない
        }
    }
}

/** セッション確立を全フックへ通知する。 */
export function notifyLogin(userId: string): Promise<void> {
    return runHooks((hooks) => hooks.onLogin?.(userId));
}

/** ログアウトを全フックへ通知する。全フック完了後に解決する。 */
export function notifyLogout(): Promise<void> {
    return runHooks((hooks) => hooks.onLogout?.());
}
