/**
 * ユーザー入力フィールドの最大文字数。
 * UI 層で maxLength として、ストア層で .slice(0, MAX) でフォールバックとして使う。
 * クリップボードから巨大文字列をペーストされた際の DoS / localStorage 肥大化対策。
 */
export const INPUT_LIMITS = {
    TASK_NAME: 200,
    SUBTASK_NAME: 150,
    TAG: 30,
    HABIT_NAME: 100,
    HABIT_MEMO: 500,
    CHARACTER_NAME: 12,
} as const;
