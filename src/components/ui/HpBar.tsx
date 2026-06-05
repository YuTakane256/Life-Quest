interface HpBarProps {
    /** 現在のHP */
    current: number;
    /** 最大HP */
    max: number;
    /** player: 30%以下で danger 色に切替 / enemy: 常に danger 色 */
    color?: 'player' | 'enemy';
    /** sm: h-2.5 (リプレイ用) / md: h-3 (バトル画面用) */
    height?: 'sm' | 'md';
}

const HEIGHT_CLASS: Record<string, string> = {
    sm: 'h-2.5',
    md: 'h-3',
};

export function HpBar({ current, max, color = 'player', height = 'md' }: HpBarProps) {
    const ratio = max > 0 ? current / max : 0;
    const widthPercent = `${ratio * 100}%`;

    let barColor: string;
    if (color === 'enemy') {
        barColor = 'var(--color-text-danger)';
    } else {
        barColor = ratio > 0.3 ? 'var(--color-accent-emerald)' : 'var(--color-text-danger)';
    }

    return (
        <div className="flex items-center gap-2">
            <div
                className={`flex-1 ${HEIGHT_CLASS[height] || HEIGHT_CLASS.md} rounded-full overflow-hidden`}
                style={{ backgroundColor: height === 'sm' ? 'var(--color-bg-primary)' : 'var(--color-bg-secondary)' }}
            >
                <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: widthPercent, backgroundColor: barColor }}
                />
            </div>
            <span
                className={`${height === 'sm' ? 'text-xs min-w-[36px]' : 'text-sm min-w-[40px]'} font-bold text-right`}
                style={{ color: 'var(--color-text-primary)' }}
            >
                {current}
            </span>
        </div>
    );
}
