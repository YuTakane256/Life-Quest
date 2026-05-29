interface Props {
    current: number;
    max: number;
    variant?: 'player' | 'enemy';
    height?: 'sm' | 'md';
    trackColor?: string;
}

export function HpBar({
    current,
    max,
    variant = 'player',
    height = 'md',
    trackColor = 'var(--color-bg-secondary)',
}: Props) {
    const ratio = max > 0 ? current / max : 0;
    const barColor =
        variant === 'enemy' || ratio <= 0.3
            ? 'var(--color-text-danger)'
            : 'var(--color-accent-emerald)';
    const barHeight = height === 'sm' ? 'h-2.5' : 'h-3';
    const textSize = height === 'sm' ? 'text-xs min-w-[36px]' : 'text-sm min-w-[40px]';

    return (
        <div className="flex items-center gap-2">
            <div
                className={`flex-1 ${barHeight} rounded-full overflow-hidden`}
                style={{ backgroundColor: trackColor }}
            >
                <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                        width: `${Math.max(0, Math.min(100, ratio * 100))}%`,
                        backgroundColor: barColor,
                    }}
                />
            </div>
            <span
                className={`${textSize} font-bold text-right`}
                style={{ color: 'var(--color-text-primary)' }}
            >
                {current}
            </span>
        </div>
    );
}
