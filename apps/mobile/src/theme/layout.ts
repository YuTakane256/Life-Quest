import { LAYOUT_TOKENS } from '@life-quest/core/designTokens';

// The tab bar owns the bottom inset. Screen content must not reserve it again.
export const TAB_SCREEN_EDGES = ['top', 'left', 'right'] as const;
export const PAGE_HEADING = {
    fontSize: LAYOUT_TOKENS.heading.size,
    lineHeight: LAYOUT_TOKENS.heading.lineHeight,
    fontWeight: LAYOUT_TOKENS.heading.weight,
};

/** Allow scaled/wrapped labels to grow, rather than clipping inside 64 points. */
export function getTabBarHeight(width: number, fontScale: number): number {
    const nav = LAYOUT_TOKENS.navigation;
    const availableWidth = Math.max(1, (Math.min(width, LAYOUT_TOKENS.page.maxWidth) - nav.horizontal * 2) / 6 - 8);
    const lines = Math.ceil(3 * nav.labelSize * fontScale / availableWidth);
    return Math.max(nav.height, Math.ceil(nav.iconSize * nav.activeScale + nav.gap + nav.labelLineHeight * fontScale * lines + 16));
}

export function getTaskBadge(count: number): string | undefined {
    return count > 0 ? (count > 99 ? '99+' : String(count)) : undefined;
}

export function shouldNavigateTab(locked: boolean, focused: boolean, prevented: boolean): boolean {
    return !locked && !focused && !prevented;
}
