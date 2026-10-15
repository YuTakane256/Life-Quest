import { describe, expect, it } from 'vitest';
import { LAYOUT_TOKENS } from '@life-quest/core/designTokens';
import { getTabBarHeight, getTaskBadge, getTaskActionsBottomPadding, TASK_ACTION_LAYOUT, PAGE_HEADING, shouldNavigateTab, TAB_SCREEN_EDGES } from './layout';

describe('Web-aligned Mobile layout', () => {
    it('keeps normal task spacing and reserves measured wrapped/scaled toast height', () => {
        expect(getTaskActionsBottomPadding(44)).toBe(76);
        for (const toastHeight of [68, 96, 150, 240]) {
            const stackHeight = TASK_ACTION_LAYOUT.size + TASK_ACTION_LAYOUT.gap + toastHeight;
            expect(getTaskActionsBottomPadding(stackHeight)).toBeGreaterThanOrEqual(stackHeight + TASK_ACTION_LAYOUT.bottom);
        }
    });
    it.each([0, -1, NaN, Infinity])('uses safe default task clearance for invalid measured height %s', (height) => {
        expect(getTaskActionsBottomPadding(height)).toBe(76);
    });
    it.each([320, 390, 402, 512, 834])('keeps the standard 64-point bar at width %s', (width) => {
        expect(getTabBarHeight(width, 1)).toBe(64);
    });
    it('grows for large/wrapped labels and respects the maximum content width', () => {
        expect(getTabBarHeight(320, 2)).toBeGreaterThan(64);
        expect(getTabBarHeight(402, 3)).toBeGreaterThan(getTabBarHeight(402, 2));
        expect(getTabBarHeight(834, 3)).toBe(getTabBarHeight(512, 3));
    });
    it('reserves the bottom safe area only in the tab bar, not twice', () => {
        expect(TAB_SCREEN_EDGES).toEqual(['top', 'left', 'right']);
        expect(PAGE_HEADING).toEqual({ fontSize: 24, lineHeight: 32, fontWeight: '700' });
        expect(LAYOUT_TOKENS.card).toEqual({ radius: 12, padding: 16 });
    });
    it.each([[0, undefined], [1, '1'], [99, '99'], [100, '99+']])('formats count %s like Web', (count, badge) => {
        expect(getTaskBadge(count as number)).toBe(badge);
    });
    it.each([
        [false, false, false, true], [true, false, false, false],
        [false, true, false, false], [false, false, true, false],
    ])('preserves disabled, reselect and prevented navigation (%s, %s, %s)', (locked, focused, prevented, expected) => {
        expect(shouldNavigateTab(locked, focused, prevented)).toBe(expected);
    });
});
