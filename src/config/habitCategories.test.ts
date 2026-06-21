import { describe, expect, it } from 'vitest';
import {
    DEFAULT_CATEGORY_ID,
    HABIT_CATEGORIES,
    getCategoryById,
} from './habitCategories';

const EXPECTED_CATEGORY_IDS = [
    'health',
    'study',
    'work',
    'lifestyle',
    'mindset',
    'creative',
    'social',
    'other',
] as const;

describe('habit category config', () => {
    it('カテゴリIDが重複せず、想定した表示順を維持している', () => {
        const ids = HABIT_CATEGORIES.map((category) => category.id);

        expect(ids).toEqual(EXPECTED_CATEGORY_IDS);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('すべてのカテゴリに表示に必要な値が入っている', () => {
        for (const category of HABIT_CATEGORIES) {
            expect(category.id).not.toHaveLength(0);
            expect(category.name).not.toHaveLength(0);
            expect(category.icon).not.toHaveLength(0);
            expect(category.color).toMatch(/^#[0-9a-f]{6}$/i);
        }
    });

    it('デフォルトカテゴリはその他カテゴリとして解決できる', () => {
        expect(DEFAULT_CATEGORY_ID).toBe('other');
        expect(getCategoryById(DEFAULT_CATEGORY_ID)).toMatchObject({
            id: 'other',
            name: 'その他',
        });
    });

    it('存在しないカテゴリIDは undefined を返す', () => {
        expect(getCategoryById('missing-category')).toBeUndefined();
    });
});
