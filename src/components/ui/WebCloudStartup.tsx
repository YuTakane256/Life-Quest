import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getGameRewardAuthorityState, subscribeGameRewardAuthority } from '@life-quest/core/gameRewardAuthority';
import { getPasswordRecoveryState, subscribePasswordRecoveryState } from '../../platform/auth';
import { useGameStore } from '../../stores/useGameStore';
import { AccountSettings } from './AccountSettings';
import { ThemeController } from './ThemeController';

interface WebCloudStartupProps {
    hasSavedCloudDisplay: boolean;
    children: ReactNode;
}

/** Keep cached cloud views out of the DOM while the startup session is being checked. */
export function WebCloudStartup({ hasSavedCloudDisplay, children }: WebCloudStartupProps) {
    const [released, setReleased] = useState(() =>
        !hasSavedCloudDisplay || getGameRewardAuthorityState() !== 'resolving',
    );

    useEffect(() => {
        if (released) return;
        const releaseIfReady = () => {
            if (getGameRewardAuthorityState() !== 'resolving') setReleased(true);
        };
        const unsubscribe = subscribeGameRewardAuthority(releaseIfReady);
        releaseIfReady();
        return unsubscribe;
    }, [released]);

    return released ? children : <ProtectedCloudStartup />;
}

function ProtectedCloudStartup() {
    const recovery = useSyncExternalStore(subscribePasswordRecoveryState, getPasswordRecoveryState);
    const storageError = useGameStore((state) => state.completionRewardError);
    return (
        <>
            <ThemeController />
            <main className="max-w-lg mx-auto px-5 pt-10">
                <p role={storageError ? 'alert' : 'status'} className="text-sm mb-4"
                    style={{ color: 'var(--color-text-secondary)' }}>
                    {storageError ? '保存データを確認できませんでした。保存環境を確認して再読み込みしてください。' : '保存データを確認しています…'}
                </p>
                {recovery !== 'idle' && <AccountSettings protectedStartup />}
                {storageError && (
                    <button type="button" className="rounded-lg border px-4 py-2" onClick={() => window.location.reload()}>
                        再読み込み
                    </button>
                )}
            </main>
        </>
    );
}
