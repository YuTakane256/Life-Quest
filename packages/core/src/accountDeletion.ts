/**
 * 退会成功後にだけ削除する、認証ユーザー固有の端末データ。
 * 匿名利用の quest-board-* キーには触れない。
 */
import { cloudCacheKey, type CloudCacheSection } from './cloudCache.ts';
import { preMigrationBackupKey } from './cloudImport.ts';
import { cloudCursorKey, cloudOutboxKey } from './cloudPull.ts';
import type { RepositoryStorage } from './syncRepository.ts';
import { captureAuthSessionScope, notifyLogout, subscribeAuthSessionScope, waitForAuthLifecycleSettled } from './authLifecycle.ts';
import type { EdgeFunctionCallOptions } from './edgeFunctions.ts';

export interface AccountDeletionApproval { userId: string; isActive: () => boolean }
export type AccountDeletionResult = (
    | { ok: true; manualAppleRevocationRequired?: boolean }
    | { ok: false; message: string }
) & { completionScope?: () => boolean };

export interface AccountDeletionOperationDeps {
    getSessionUserId: () => Promise<string | null>;
    invokeDelete: (options: EdgeFunctionCallOptions) => Promise<{ apple_revocation?: unknown }>;
    detachRewards: () => void;
    cleanup: (userId: string, isCurrent: () => boolean) => Promise<void>;
    signOut: () => Promise<void>;
    setAnonymous: () => void;
}

/** Only a confirmed identity may be deleted. Never retry an uncertain destructive request automatically. */
export function createAccountDeletionOperation(deps: AccountDeletionOperationDeps) {
    let active: { userId: string; isCurrent: () => boolean; promise: Promise<AccountDeletionResult> } | null = null;
    return (approval: AccountDeletionApproval): Promise<AccountDeletionResult> => {
        const scope = captureAuthSessionScope();
        const stale = (): AccountDeletionResult => ({ ok: false, message: 'アカウントの状態が変わりました。退会結果を確認し、現在のアカウントで確認し直してください。' });
        if (!approval.isActive() || scope.userId !== approval.userId) return Promise.resolve(stale());
        if (active?.isCurrent()) return active.userId === approval.userId ? active.promise : Promise.resolve(stale());
        const owner = { userId: approval.userId, isCurrent: scope.isCurrent, promise: undefined as unknown as Promise<AccountDeletionResult> };
        active = owner;
        owner.promise = (async (): Promise<AccountDeletionResult> => {
            let finishing = false;
            let committed = false;
            let invalid = false;
            let logoutScope: ReturnType<typeof captureAuthSessionScope> | null = null;
            const ownsLogout = () => logoutScope?.isCurrent() === true;
            const unsubscribe = subscribeAuthSessionScope((next) => {
                if (finishing && !invalid && !logoutScope && next.userId === null) logoutScope = next;
                else invalid = true;
            });
            const current = () => !invalid && scope.isCurrent();
            try {
                await waitForAuthLifecycleSettled();
                if (!current() || !approval.isActive()) return stale();
                const userId = await deps.getSessionUserId();
                if (!current() || !approval.isActive() || userId !== approval.userId) return stale();
                // Approval is committed here. Leaving the screen later must not skip cleanup after server success.
                committed = true;
                const deletion = await deps.invokeDelete({ expectedUserId: userId, isActive: current });
                if (!current()) return stale();
                let cleanupFailed = false;
                try { deps.detachRewards(); } catch { cleanupFailed = true; }
                try { await deps.cleanup(userId, current); } catch { cleanupFailed = true; }
                if (!current()) return stale();
                finishing = true;
                try { await deps.signOut(); } catch { cleanupFailed = true; }
                if (invalid || (!scope.isCurrent() && !ownsLogout())) return stale();
                try { await notifyLogout(); } catch { cleanupFailed = true; }
                const completed = captureAuthSessionScope();
                if (invalid || completed.userId !== null || !ownsLogout()) return stale();
                deps.setAnonymous();
                const manualAppleRevocationRequired = deletion.apple_revocation === 'manual_required';
                return cleanupFailed
                    ? { ok: false, message: 'アカウントは削除されました。端末側の後始末を完了できませんでした。アプリを再起動してください。'
                        + (manualAppleRevocationRequired ? 'Appleの「Apple IDを使用中のApp」からもLife Questの連携を削除してください。' : ''), completionScope: completed.isCurrent }
                    : { ok: true, manualAppleRevocationRequired, completionScope: completed.isCurrent };
            } catch {
                return current()
                    ? { ok: false, message: committed ? '退会結果を確認できませんでした。自動では再送しません。再ログインしてアカウントの状態を確認してください。' : 'アカウントの確認に失敗しました。削除要求は送信していません。接続を確認して操作し直してください。' }
                    : stale();
            } finally { unsubscribe(); if (active === owner) active = null; }
        })();
        return owner.promise;
    };
}

export interface AccountDeletionConfirmation extends AccountDeletionApproval { email: string | null }
export interface AccountDeletionViewState {
    confirmation: AccountDeletionConfirmation | null;
    text: string;
    busy: boolean;
    message: string | null;
}

/** Platform-independent confirmation ownership. Activation is a mounted/focused view, not an auth session. */
export function createAccountDeletionConfirmation(deleteAccount: (approval: AccountDeletionApproval) => Promise<AccountDeletionResult>) {
    let state: AccountDeletionViewState = { confirmation: null, text: '', busy: false, message: null };
    let view: object | null = null;
    let request: object | null = null;
    const listeners = new Set<() => void>();
    const publish = (patch: Partial<AccountDeletionViewState>) => { state = { ...state, ...patch }; listeners.forEach((listener) => listener()); };
    const owns = (owner: AccountDeletionConfirmation | null) => !!owner && state.confirmation === owner && owner.isActive();
    return {
        getSnapshot: () => state,
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        activate: () => {
            const token = {}; view = token;
            const unsubscribe = subscribeAuthSessionScope(({ userId }) => {
                // A successful deletion logs out. Keep its pending UI receipt only in that anonymous scope.
                if (userId !== null) request = null;
                publish({ confirmation: null, text: '', busy: false, message: null });
            });
            return () => { unsubscribe(); if (view === token) { view = null; request = null; publish({ confirmation: null, text: '', busy: false, message: null }); } };
        },
        open: (user: { userId: string; email: string | null } | null) => {
            const token = view; const scope = captureAuthSessionScope();
            if (!token || !user || state.busy || user.userId !== scope.userId) return;
            const owner: AccountDeletionConfirmation = { userId: user.userId, email: user.email,
                isActive: () => view === token && state.confirmation === owner && scope.isCurrent() };
            publish({ confirmation: owner, text: '', message: null });
            return true;
        },
        setText: (owner: AccountDeletionConfirmation | null, text: string) => { if (owns(owner) && !state.busy) publish({ text }); },
        cancel: (owner: AccountDeletionConfirmation | null) => { if (owns(owner) && !state.busy) publish({ confirmation: null, text: '', message: null }); },
        submit: async (owner: AccountDeletionConfirmation | null, expectedText: string) => {
            if (!owns(owner) || state.busy || expectedText !== '削除' || state.text !== expectedText) return;
            const token = {}; request = token; const currentView = view;
            const sameSession = captureAuthSessionScope().isCurrent;
            const applies = (result?: AccountDeletionResult) => view === currentView && view !== null && request === token
                && (sameSession() || result?.completionScope?.() === true);
            publish({ busy: true, message: null });
            let result: AccountDeletionResult | undefined;
            try {
                result = await deleteAccount(owner!);
                if (!applies(result)) return;
                publish(result.ok ? { confirmation: null, text: '', message: result.manualAppleRevocationRequired
                    ? 'アカウントとクラウドデータを削除しました。Appleの「Apple IDを使用中のApp」からもLife Questの連携を削除してください。'
                    : 'アカウントとクラウドデータを削除しました' } : { message: result.message });
            } catch {
                if (applies()) publish({ message: '退会結果を確認できませんでした。自動では再送しません。アカウントの状態を確認してください。' });
            } finally {
                if (applies(result)) publish({ busy: false });
                if (request === token) request = null;
            }
        },
    };
}

/** 追加の認証ユーザー固有キュー。#613由来の保留報酬操作も退会時に破棄する。 */
export const ACCOUNT_DELETION_EXTRA_KEYS: readonly ((userId: string) => string)[] = [
    (userId) => `life-quest:cloud:${userId}:pending-reward-operations:v1`,
];

export function accountDeletionKeys(userId: string): string[] {
    return [
        ...(['tasks', 'habits', 'game', 'profile'] as const satisfies readonly CloudCacheSection[])
            .map((section) => cloudCacheKey(userId, section)),
        cloudCursorKey(userId),
        cloudOutboxKey(userId),
        preMigrationBackupKey(userId),
        ...ACCOUNT_DELETION_EXTRA_KEYS.map((key) => key(userId)),
    ];
}

/** 個々の削除失敗で中断せず、全キーの削除を試みる。 */
export async function deleteAccountCloudData(storage: RepositoryStorage, userId: string): Promise<void> {
    const results = await Promise.allSettled(accountDeletionKeys(userId).map((key) => storage.removeItem(key)));
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
}

export interface AccountDeletionCleanupDeps {
    isCurrent?: () => boolean;
    stopSync: () => void | Promise<void>;
    stopOutbox: () => void | Promise<void>;
    removeCloudData: () => Promise<void>;
    resetMemory: () => void | Promise<void>;
}

/** 退会後処理の順序を固定する。サーバー成功前には呼び出してはならない。 */
export async function runAccountDeletionCleanup(deps: AccountDeletionCleanupDeps): Promise<void> {
    const failures: unknown[] = [];
    for (const step of [deps.stopSync, deps.stopOutbox, deps.removeCloudData, deps.resetMemory]) {
        if (deps.isCurrent && !deps.isCurrent()) break;
        try {
            await step();
        } catch (error) {
            failures.push(error);
        }
    }
    if (failures.length > 0) {
        const error = new Error('account deletion cleanup incomplete') as Error & { errors?: unknown[] };
        error.errors = failures;
        throw error;
    }
}
