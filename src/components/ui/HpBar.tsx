import { getHpDisplayState, getHpBarA11y } from '../../utils/hp';

interface HpBarProps {
    /** 現在のHP */
    current: number;
    /** 最大HP */
    max: number;
    /** player: 30%以下で danger 色に切替 / enemy: 常に danger 色 */
    color?: 'player' | 'enemy';
    /** sm: h-2.5 (リプレイ用) / md: h-3 (バトル画面用) */
    height?: 'sm' | 'md';
    /** スクリーンリーダー向けの名前（例:「勇者 のHP」）。呼び出し元で必ず具体的な名前を渡す。 */
    label: string;
}

const HEIGHT_CLASS: Record<string, string> = {
    sm: 'h-2.5',
    md: 'h-3',
};

export function HpBar({ current, max, color = 'player', height = 'md', label }: HpBarProps) {
    const hp = getHpDisplayState(current, max);
    const a11y = getHpBarA11y(current, max);

    let barColor: string;
    if (color === 'enemy') {
        barColor = 'var(--color-text-danger)';
    } else {
        barColor = hp.ratio > 0.3 ? 'var(--color-accent-emerald)' : 'var(--color-text-danger)';
    }

    // valueMax=0（HP上限が不明・未設定）はmin===maxとなりprogressbarとしては無効な状態のため、
    // role自体を付与しない（現状の呼び出し元は全てmaxに正の値かフォールバックを渡すため到達しない防御）
    const a11yProps = a11y.valueMax > 0
        ? {
            role: 'progressbar' as const,
            'aria-valuenow': a11y.valueNow,
            'aria-valuemin': 0,
            'aria-valuemax': a11y.valueMax,
            'aria-valuetext': a11y.valueText,
            'aria-label': label,
        }
        : {};

    return (
        <div className="flex items-center gap-2">
            <div
                className={`flex-1 ${HEIGHT_CLASS[height] || HEIGHT_CLASS.md} rounded-full overflow-hidden`}
                style={{ backgroundColor: height === 'sm' ? 'var(--color-bg-primary)' : 'var(--color-bg-secondary)' }}
                {...a11yProps}
            >
                <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: hp.widthPercent, backgroundColor: barColor }}
                />
            </div>
            <span
                className={`${height === 'sm' ? 'text-xs min-w-[36px]' : 'text-sm min-w-[40px]'} font-bold text-right`}
                style={{ color: 'var(--color-text-primary)' }}
                aria-hidden="true"
            >
                {hp.current}
            </span>
        </div>
    );
}
