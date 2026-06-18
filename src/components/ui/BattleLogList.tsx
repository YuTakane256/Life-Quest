import { useEffect, useRef, ReactNode } from 'react';
import type { BattleLog } from '../../types';

interface Props {
    logs: BattleLog[];
    autoScroll?: boolean;
    className?: string;
    style?: React.CSSProperties;
    children?: ReactNode; // For appending outcome messages
    emptyMessage?: string;
    ariaLabel?: string;
}

export function BattleLogList({ logs, autoScroll = false, className = '', style, children, emptyMessage, ariaLabel = 'バトルログ' }: Props) {
    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (autoScroll && endRef.current) {
            endRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs.length, autoScroll]);

    return (
        <div
            className={`overflow-y-auto ${className}`}
            style={style}
            role="log"
            aria-live="polite"
            aria-atomic="false"
            aria-relevant="additions text"
            aria-label={ariaLabel}
        >
            {logs.length === 0 && emptyMessage && (
                <div className="text-center text-xs py-4" style={{ color: 'var(--color-text-muted)' }}>
                    {emptyMessage}
                </div>
            )}
            {logs.map((log, i) => (
                <div
                    key={i}
                    role="article"
                    aria-label={`ターン ${log.turn}: ${log.message}`}
                    className="text-sm py-1 animate-fade-in"
                    style={{ color: 'var(--color-text-secondary)' }}
                >
                    <span aria-hidden="true" style={{ color: 'var(--color-text-muted)' }}>[{log.turn}] </span>{log.message}
                </div>
            ))}
            {children}
            <div ref={endRef} />
        </div>
    );
}
