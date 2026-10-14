import { useGameStore } from '../../stores/useGameStore';

export function CompletionRewardNotice() {
    const message = useGameStore((state) => state.completionRewardError);
    const dismiss = useGameStore((state) => state.clearCompletionRewardError);
    if (!message) return null;
    return <div role="alert" className="fixed top-4 left-4 right-4 z-[400] rounded-xl p-4 shadow-lg"
        style={{ backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-danger)', border: '1px solid var(--color-border-default)' }}>
        <p>{message}</p><button onClick={dismiss} className="mt-2 min-h-11 px-3 underline" aria-label="報酬保存エラーを閉じる">閉じる</button>
    </div>;
}
