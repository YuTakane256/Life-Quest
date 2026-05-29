import { useEffect, useRef } from 'react';
import type { BattleLog } from '../../types';

interface Props {
    logs: BattleLog[];
    autoScroll?: boolean;
}

export function BattleLogList({ logs, autoScroll = false }: Props) {
    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (autoScroll) endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs, autoScroll]);

    return (
        <>
            {logs.map((log, i) => (
                <div
                    key={i}
                    className="text-sm py-1 animate-fade-in"
                    style={{ color: 'var(--color-text-secondary)' }}
                >
                    <span style={{ color: 'var(--color-text-muted)' }}>[{log.turn}] </span>
                    {log.message}
                </div>
            ))}
            {autoScroll && <div ref={endRef} />}
        </>
    );
}
