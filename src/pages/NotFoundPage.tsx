import { Compass, Home, RotateCcw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function NotFoundPage() {
    const navigate = useNavigate();

    return (
        <div className="max-w-lg mx-auto min-h-[calc(100dvh-5rem)] px-5 py-10 flex items-center">
            <section
                className="w-full rounded-xl p-5 text-center"
                style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
            >
                <div className="flex justify-center mb-4">
                    <div
                        className="w-16 h-16 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-accent-primary)' }}
                    >
                        <Compass size={32} />
                    </div>
                </div>
                <p className="text-xs font-bold tracking-[0.16em] mb-2" style={{ color: 'var(--color-text-muted)' }}>
                    404
                </p>
                <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>
                    ページが見つかりません
                </h1>
                <p className="text-sm leading-relaxed mb-5" style={{ color: 'var(--color-text-secondary)' }}>
                    URLが変わったか、まだ用意されていない画面です。
                </p>
                <div className="grid grid-cols-2 gap-3">
                    <button
                        type="button"
                        onClick={() => navigate('/tasks', { replace: true })}
                        className="py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-all"
                        style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}
                    >
                        <Home size={16} />
                        タスクへ
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate(-1)}
                        className="py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-all"
                        style={{
                            backgroundColor: 'var(--color-bg-secondary)',
                            color: 'var(--color-text-secondary)',
                            border: '1px solid var(--color-border-default)',
                        }}
                    >
                        <RotateCcw size={16} />
                        戻る
                    </button>
                </div>
            </section>
        </div>
    );
}
