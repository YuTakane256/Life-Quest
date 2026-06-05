import { useEffect, useRef, ReactNode } from 'react';
import type { BattleLog } from '../../types';

interface Props {
    logs: BattleLog[];
    autoScroll?: boolean;
    className?: string;
    style?: React.CSSProperties;
    children?: ReactNode; // For appending outcome messages
    emptyMessage?: string;
}

export function BattleLogList({ logs, autoScroll = false, className = '', style, children, emptyMessage }: Props) {
    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (autoScroll && endRef.current) {
            endRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs.length, autoScroll]);

    return (
        <div className={`overflow-y-auto ${className}`} style={style}>
            {logs.length === 0 && emptyMessage && (
                <div className="text-center text-xs py-4" style={{ color: 'var(--color-text-muted)' }}>
                    {emptyMessage}
                </div>
            )}
            {logs.map((log, i) => (
                <div key={i} className="text-sm py-1 animate-fade-in" style={{ color: 'var(--color-text-secondary)' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>[{log.turn}] </span>{log.message}
                </div>
            ))}
            {children}
            <div ref={endRef} />
        </div>
    );
}
