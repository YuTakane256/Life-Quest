import { describe, expect, it, vi } from 'vitest';
import { captureTitleSelection, type TitleSelectionSnapshot } from './achievements';

function setup(rendered: TitleSelectionSnapshot = { activeTitle: null, unlockedTitles: ['a', 'b'] }) {
    let current: TitleSelectionSnapshot = { ...rendered, unlockedTitles: [...rendered.unlockedTitles] };
    let active = true;
    const apply = vi.fn((title: string | null) => { current = { ...current, activeTitle: title }; });
    const read = vi.fn(() => current);
    const choose = captureTitleSelection(rendered, read, () => active, apply);
    return { choose, apply, read, set: (next: Partial<TitleSelectionSnapshot>) => { current = { ...current, ...next }; },
        deactivate: () => { active = false; } };
}

describe('render-bound title selection', () => {
    it('accepts an offered and still earned title once across all captured choices', () => {
        const s = setup(); expect(s.choose('a')).toBe(true);
        s.set({ activeTitle: null });
        expect(s.choose('b')).toBe(false); expect(s.choose(null)).toBe(false);
        expect(s.apply).toHaveBeenCalledExactlyOnceWith('a');
    });
    it('clears an active title once', () => {
        const s = setup({ activeTitle: 'a', unlockedTitles: ['a'] });
        expect(s.choose(null)).toBe(true); expect(s.choose(null)).toBe(false);
        expect(s.apply).toHaveBeenCalledExactlyOnceWith(null);
    });
    it('a same-value no-op does not consume a later valid selection', () => {
        const s = setup({ activeTitle: 'a', unlockedTitles: ['a', 'b'] });
        expect(s.choose('a')).toBe(false); expect(s.choose('b')).toBe(true);
        expect(s.apply).toHaveBeenCalledExactlyOnceWith('b');
    });
    it('an already empty choice does not write', () => {
        const s = setup(); expect(s.choose(null)).toBe(false); expect(s.apply).not.toHaveBeenCalled();
    });
    it('does not even read current data after session/screen ownership is lost', () => {
        const s = setup(); s.deactivate(); expect(s.choose('a')).toBe(false);
        expect(s.read).not.toHaveBeenCalled(); expect(s.apply).not.toHaveBeenCalled();
    });
    it('refuses titles not offered by the captured screen even if newly earned', () => {
        const s = setup(); s.set({ unlockedTitles: ['a', 'b', 'c'] });
        expect(s.choose('c')).toBe(false); expect(s.choose('b')).toBe(true);
        expect(s.apply).toHaveBeenCalledExactlyOnceWith('b');
    });
    it('refuses a formerly earned choice', () => {
        const s = setup(); s.set({ unlockedTitles: ['a'] });
        expect(s.choose('b')).toBe(false); expect(s.apply).not.toHaveBeenCalled();
    });
    it.each(['a', null])('does not overwrite newer profile data with %s', (target) => {
        const s = setup({ activeTitle: 'b', unlockedTitles: ['a', 'b'] }); s.set({ activeTitle: 'newer' });
        expect(s.choose(target)).toBe(false); expect(s.apply).not.toHaveBeenCalled();
    });
    it('preserves a stored locked title unless an explicit valid choice clears it', () => {
        const s = setup({ activeTitle: 'old locked title', unlockedTitles: ['a'] });
        expect(s.apply).not.toHaveBeenCalled(); expect(s.choose(null)).toBe(true);
    });
    it.each([true, false])('cannot clear when no title controls exist (rendered=%s)', (renderedEmpty) => {
        const s = setup({ activeTitle: 'old', unlockedTitles: renderedEmpty ? [] : ['a'] });
        if (renderedEmpty) s.set({ unlockedTitles: ['a'] }); else s.set({ unlockedTitles: [] });
        expect(s.choose(null)).toBe(false); expect(s.apply).not.toHaveBeenCalled();
    });
    it('copies offered titles rather than retaining a mutable array', () => {
        const titles = ['a']; const rendered = { activeTitle: null as string | null, unlockedTitles: titles };
        const s = setup(rendered); titles.push('b'); rendered.activeTitle = 'changed';
        s.set({ unlockedTitles: ['a', 'b'] }); expect(s.choose('b')).toBe(false); expect(s.choose('a')).toBe(true);
    });
    it('allows equivalent pulls and unrelated new achievements', () => {
        const s = setup(); s.set({ activeTitle: null, unlockedTitles: ['b', 'a', 'c'] });
        expect(s.choose('b')).toBe(true); expect(s.apply).toHaveBeenCalledExactlyOnceWith('b');
    });
    it('marks ownership used before applying to prevent reentrant writes', () => {
        const current = { activeTitle: null, unlockedTitles: ['a'] };
        const apply = vi.fn(() => { expect(choose('a')).toBe(false); });
        const choose = captureTitleSelection(current, () => current, () => true, apply);
        expect(choose('a')).toBe(true); expect(apply).toHaveBeenCalledOnce();
    });
});
