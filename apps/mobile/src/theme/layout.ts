import { LAYOUT_TOKENS } from '@life-quest/core/designTokens';

// The tab bar owns the bottom inset. Screen content must not reserve it again.
export const TAB_SCREEN_EDGES = ['top', 'left', 'right'] as const;
export const TASK_ACTION_LAYOUT = { size: 44, bottom: 12, gap: 12 } as const;

/** Keep the normal page padding; reserve the entire live overlay when it grows. */
export function getTaskActionsBottomPadding(height: number): number {
    const measured = Number.isFinite(height) ? Math.max(TASK_ACTION_LAYOUT.size, height) : TASK_ACTION_LAYOUT.size;
    return Math.max(76, Math.ceil(measured + TASK_ACTION_LAYOUT.bottom + TASK_ACTION_LAYOUT.gap));
}
export const PAGE_HEADING = {
    fontSize: LAYOUT_TOKENS.heading.size,
    lineHeight: LAYOUT_TOKENS.heading.lineHeight,
    fontWeight: LAYOUT_TOKENS.heading.weight,
};

export function getTaskBadge(count: number): string | undefined {
    return count > 0 ? (count > 99 ? '99+' : String(count)) : undefined;
}

export function shouldNavigateTab(locked: boolean, focused: boolean, prevented: boolean): boolean {
    return !locked && !focused && !prevented;
}
