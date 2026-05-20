/**
 * 習慣カテゴリの定義
 * 各カテゴリに名前、アイコン（絵文字）、カラーを設定
 */

export interface HabitCategory {
    id: string;
    name: string;
    icon: string;   // 絵文字アイコン
    color: string;   // HEX カラーコード
}

export const HABIT_CATEGORIES: HabitCategory[] = [
    { id: 'health',    name: '健康',     icon: '💪', color: '#10b981' },
    { id: 'study',     name: '勉強',     icon: '📚', color: '#3b82f6' },
    { id: 'work',      name: '仕事',     icon: '💼', color: '#8b5cf6' },
    { id: 'lifestyle', name: '生活',     icon: '🏠', color: '#f59e0b' },
    { id: 'mindset',   name: 'マインド', icon: '🧘', color: '#ec4899' },
    { id: 'creative',  name: 'クリエイティブ', icon: '🎨', color: '#f97316' },
    { id: 'social',    name: '社交',     icon: '🤝', color: '#06b6d4' },
    { id: 'other',     name: 'その他',   icon: '📌', color: '#64748b' },
];

/** カテゴリIDからカテゴリオブジェクトを取得 */
export function getCategoryById(id: string): HabitCategory | undefined {
    return HABIT_CATEGORIES.find((c) => c.id === id);
}

/** デフォルトカテゴリ（その他） */
export const DEFAULT_CATEGORY_ID = 'other';
