import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false };

    static getDerivedStateFromError(): State {
        return { hasError: true };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('Unhandled app render error', error, info);
    }

    private handleRetry = () => {
        this.setState({ hasError: false });
    };

    private handleReload = () => {
        window.location.reload();
    };

    render() {
        if (!this.state.hasError) return this.props.children;

        return (
            <div
                className="min-h-[100dvh] flex items-center justify-center px-5"
                style={{ backgroundColor: 'var(--color-bg-primary)' }}
            >
                <div
                    role="alert"
                    className="w-full max-w-sm rounded-2xl p-5 text-center"
                    style={{
                        backgroundColor: 'var(--color-bg-card)',
                        border: '1px solid var(--color-border-default)',
                    }}
                >
                    <div className="flex justify-center mb-3">
                        <AlertTriangle size={36} style={{ color: 'var(--color-text-danger)' }} />
                    </div>
                    <h1 className="text-lg font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>
                        画面の表示に失敗しました
                    </h1>
                    <p className="text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>
                        一時的なエラーが発生しました。再試行しても戻らない場合は再読み込みしてください。
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={this.handleRetry}
                            className="py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-all"
                            style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}
                        >
                            <RotateCcw size={16} />
                            再試行
                        </button>
                        <button
                            type="button"
                            onClick={this.handleReload}
                            className="py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition-all"
                            style={{
                                backgroundColor: 'var(--color-bg-secondary)',
                                color: 'var(--color-text-secondary)',
                                border: '1px solid var(--color-border-default)',
                            }}
                        >
                            <RefreshCw size={16} />
                            再読み込み
                        </button>
                    </div>
                </div>
            </div>
        );
    }
}
