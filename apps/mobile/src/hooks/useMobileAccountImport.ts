import { useCallback, useEffect, useRef, useState } from 'react';
import { captureAuthSessionScope, registerAuthLifecycleHooks, subscribeAuthSessionScope, waitForAuthLifecycleSettled } from '@life-quest/core/authLifecycle';
import { EdgeFunctionError } from '@life-quest/core/edgeFunctions';
import { getCurrentUser, type AuthUserInfo } from '../platform/auth';
import { approveMobileContentImport, getPendingMobileContent, type PendingMobileContent } from '../platform/cloudMigration';

/** Account-bound settings state. Scope events clear sensitive UI before async migration hooks finish. */
export function useMobileAccountImport() {
    const [currentUser, setCurrentUser] = useState<AuthUserInfo | null>(null);
    const [pendingContent, setPendingContent] = useState<PendingMobileContent | null>(null);
    const [importMessage, setImportMessage] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);
    const [importing, setImporting] = useState(false);
    const mounted = useRef(false);
    const generation = useRef(0);
    const pendingRef = useRef<PendingMobileContent | null>(null);
    const importingRef = useRef(false);
    const observedScope = useRef<(() => boolean) | null>(null);

    const clear = useCallback(() => {
        generation.current += 1;
        pendingRef.current = null;
        importingRef.current = false;
        observedScope.current = null;
        setCurrentUser(null);
        setPendingContent(null);
        setImportMessage(null);
        setChecking(false);
        setImporting(false);
    }, []);

    const refreshAccount = useCallback(async (): Promise<void> => {
        if (!mounted.current || importingRef.current) return;
        const scope = captureAuthSessionScope();
        observedScope.current = scope.isCurrent;
        const request = ++generation.current;
        const active = () => mounted.current && request === generation.current && scope.isCurrent();
        pendingRef.current = null;
        setPendingContent(null);
        setImportMessage(null);
        if (scope.userId === null) { clear(); return; }
        setChecking(true);
        try {
            // Mounting during login must not finalize empty candidates before backup creation.
            // Auth hooks launch this refresh detached, so waiting cannot block their completion.
            await waitForAuthLifecycleSettled();
            if (!active()) return;
            const user = await getCurrentUser();
            if (!active()) return;
            if (user?.userId !== scope.userId) { clear(); return; }
            setCurrentUser(user);
            const pending = await getPendingMobileContent(user.userId);
            if (!active()) return;
            pendingRef.current = pending.tasks.length > 0 || pending.habits.length > 0 ? pending : null;
            setPendingContent(pendingRef.current);
        } catch (error) {
            if (active()) setImportMessage(error instanceof EdgeFunctionError && error.code === 'import-limit-exceeded'
                ? error.message : '端末データの確認に失敗しました。接続・保存環境を確認して再確認してください。');
        } finally {
            if (active()) setChecking(false);
        }
    }, [clear]);

    useEffect(() => {
        mounted.current = true;
        const unsubscribeScope = subscribeAuthSessionScope(clear);
        // Refresh only after the application's migration/sync hooks. Scope listeners
        // above clear old UI immediately even if those hooks take a long time.
        const unregister = registerAuthLifecycleHooks({ onLogin: () => {
            if (!observedScope.current?.()) void refreshAccount();
        } });
        void refreshAccount();
        return () => { mounted.current = false; generation.current += 1; unsubscribeScope(); unregister(); };
    }, [clear, refreshAccount]);

    const dismissPendingContent = useCallback(() => {
        if (importingRef.current) return;
        pendingRef.current = null;
        setPendingContent(null);
        setImportMessage(null);
    }, []);

    const importContent = useCallback(async (): Promise<boolean> => {
        const content = pendingRef.current;
        if (!content || importingRef.current || !mounted.current) return false;
        const scope = captureAuthSessionScope();
        const request = ++generation.current;
        const active = () => mounted.current && request === generation.current && scope.isCurrent();
        importingRef.current = true; // Synchronous latch: two taps before re-render still send once.
        setImporting(true);
        setImportMessage(null);
        try {
            const result = await approveMobileContentImport(content);
            if (!active()) return false;
            if (result.status === 'imported') {
                pendingRef.current = null;
                setPendingContent(null);
                setImportMessage('この端末のデータをクラウドへ統合しました');
                return true;
            }
            if (result.status === 'stale') {
                setCurrentUser(null);
                pendingRef.current = null;
                setPendingContent(null);
                setImportMessage('アカウントの状態が変わりました。統合候補を再確認してください。');
            } else if (result.status === 'web_migration_required') {
                setImportMessage('先にWeb版でログインして初回設定を完了してください');
            } else setImportMessage(result.message);
            return false;
        } catch {
            if (active()) setImportMessage('統合に失敗しました。接続を確認してもう一度お試しください。');
            return false;
        } finally {
            if (active()) { importingRef.current = false; setImporting(false); }
        }
    }, []);

    return { currentUser, pendingContent, importMessage, checking, importing, refreshAccount, dismissPendingContent, importContent };
}
