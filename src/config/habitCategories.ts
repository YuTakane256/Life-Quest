/**
 * 習慣カテゴリの定義。
 * 実体は @life-quest/core/habits に移動し、Mobileと共有する。
 * 既存のimportパスとAPI名を維持するためここから再エクスポートする。
 */
import {
    DEFAULT_HABIT_CATEGORY_ID,
    getHabitCategoryById,
    getHabitCategoryByIdOrDefault,
    HABIT_CATEGORIES as CORE_HABIT_CATEGORIES,
    type HabitCategory,
} from '@life-quest/core/habits';

export type { HabitCategory } from '@life-quest/core/habits';

export const HABIT_CATEGORIES: HabitCategory[] = [...CORE_HABIT_CATEGORIES];

/** カテゴリIDからカテゴリオブジェクトを取得 */
export function getCategoryById(id: string): HabitCategory | undefined {
    return getHabitCategoryById(id);
}

/** デフォルトカテゴリ（その他） */
export const DEFAULT_CATEGORY_ID = DEFAULT_HABIT_CATEGORY_ID;

export function getDefaultCategory(): HabitCategory {
    return getHabitCategoryByIdOrDefault(DEFAULT_HABIT_CATEGORY_ID);
}

export function getCategoryByIdOrDefault(id: unknown): HabitCategory {
    return getHabitCategoryByIdOrDefault(id);
}
