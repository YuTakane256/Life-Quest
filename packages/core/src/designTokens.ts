/**
 * WebとMobileで共有するデザイントークン。
 *
 * Web `src/index.css` のCSS変数パレットを製品上の正とし、ここに同じ値を
 * 型付きで定義する。Web側はintegrityテストでCSS変数との一致を検証し、
 * Mobile側はStyleSheetからこのトークンを直接参照する。
 * 値を変えるときは必ず index.css と両方を更新する（テストが乖離を検出する）。
 */

export interface ThemePalette {
    bg: {
        primary: string;
        secondary: string;
        tertiary: string;
        card: string;
        cardHover: string;
    };
    accent: {
        primary: string;
        secondary: string;
        gold: string;
        emerald: string;
        rose: string;
        sky: string;
    };
    text: {
        primary: string;
        secondary: string;
        muted: string;
        danger: string;
    };
    border: {
        default: string;
        active: string;
    };
    priority: {
        low: string;
        medium: string;
        high: string;
    };
    chest: {
        blue: string;
        wood: string;
        silver: string;
        gold: string;
        redGold: string;
        /** 虹色宝箱のグラデーション停止色（Webでは135degのlinear-gradient） */
        rainbowStops: readonly string[];
    };
    rarity: {
        common: string;
        uncommon: string;
        rare: string;
        epic: string;
        legendary: string;
    };
}

export const DARK_THEME: ThemePalette = {
    bg: {
        primary: '#0f0f1a',
        secondary: '#1a1a2e',
        tertiary: '#16213e',
        card: '#1e1e36',
        cardHover: '#2a2a4a',
    },
    accent: {
        primary: '#7c3aed',
        secondary: '#a855f7',
        gold: '#f59e0b',
        emerald: '#10b981',
        rose: '#f43f5e',
        sky: '#0ea5e9',
    },
    text: {
        primary: '#f1f5f9',
        secondary: '#94a3b8',
        muted: '#64748b',
        danger: '#ef4444',
    },
    border: {
        default: '#2e2e4a',
        active: '#7c3aed',
    },
    priority: {
        low: '#22c55e',
        medium: '#f59e0b',
        high: '#ef4444',
    },
    chest: {
        blue: '#3b82f6',
        wood: '#92400e',
        silver: '#9ca3af',
        gold: '#f59e0b',
        redGold: '#dc2626',
        rainbowStops: ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6'],
    },
    rarity: {
        common: '#9ca3af',
        uncommon: '#22c55e',
        rare: '#3b82f6',
        epic: '#8b5cf6',
        legendary: '#f59e0b',
    },
};

export const LIGHT_THEME: ThemePalette = {
    bg: {
        primary: '#f5f7fb',
        secondary: '#e8edf6',
        tertiary: '#dfe7f2',
        card: '#ffffff',
        cardHover: '#f0f4fa',
    },
    accent: {
        primary: '#2563eb',
        secondary: '#0ea5e9',
        gold: '#b7791f',
        emerald: '#059669',
        rose: '#e11d48',
        sky: '#0284c7',
    },
    text: {
        primary: '#172033',
        secondary: '#46556c',
        muted: '#718096',
        danger: '#dc2626',
    },
    border: {
        default: '#d6deea',
        active: '#2563eb',
    },
    priority: {
        low: '#16a34a',
        medium: '#d97706',
        high: '#dc2626',
    },
    chest: {
        blue: '#2563eb',
        wood: '#9a5a22',
        silver: '#64748b',
        gold: '#d97706',
        redGold: '#dc2626',
        rainbowStops: ['#dc2626', '#d97706', '#16a34a', '#2563eb', '#7c3aed'],
    },
    rarity: {
        common: '#64748b',
        uncommon: '#16a34a',
        rare: '#2563eb',
        epic: '#7c3aed',
        legendary: '#d97706',
    },
};

export const FONT_SANS = "'Inter', system-ui, -apple-system, sans-serif";

/**
 * テーマをCSS変数名→値のフラットなマップへ展開する。
 * Web側のintegrityテストが index.css との一致検証に使う。
 */
export function themeToCssVariables(palette: ThemePalette): Record<string, string> {
    return {
        '--color-bg-primary': palette.bg.primary,
        '--color-bg-secondary': palette.bg.secondary,
        '--color-bg-tertiary': palette.bg.tertiary,
        '--color-bg-card': palette.bg.card,
        '--color-bg-card-hover': palette.bg.cardHover,
        '--color-accent-primary': palette.accent.primary,
        '--color-accent-secondary': palette.accent.secondary,
        '--color-accent-gold': palette.accent.gold,
        '--color-accent-emerald': palette.accent.emerald,
        '--color-accent-rose': palette.accent.rose,
        '--color-accent-sky': palette.accent.sky,
        '--color-text-primary': palette.text.primary,
        '--color-text-secondary': palette.text.secondary,
        '--color-text-muted': palette.text.muted,
        '--color-text-danger': palette.text.danger,
        '--color-border-default': palette.border.default,
        '--color-border-active': palette.border.active,
        '--color-priority-low': palette.priority.low,
        '--color-priority-medium': palette.priority.medium,
        '--color-priority-high': palette.priority.high,
        '--color-chest-blue': palette.chest.blue,
        '--color-chest-wood': palette.chest.wood,
        '--color-chest-silver': palette.chest.silver,
        '--color-chest-gold': palette.chest.gold,
        '--color-chest-red-gold': palette.chest.redGold,
        '--color-chest-rainbow': `linear-gradient(135deg, ${palette.chest.rainbowStops.join(', ')})`,
        '--color-rarity-common': palette.rarity.common,
        '--color-rarity-uncommon': palette.rarity.uncommon,
        '--color-rarity-rare': palette.rarity.rare,
        '--color-rarity-epic': palette.rarity.epic,
        '--color-rarity-legendary': palette.rarity.legendary,
    };
}
