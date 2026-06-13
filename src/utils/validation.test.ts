import { describe, expect, it } from 'vitest';
import { clampString } from './validation';

describe('clampString', () => {
    it('returns strings that are shorter than the limit unchanged', () => {
        expect(clampString('task', 10)).toBe('task');
    });

    it('returns strings at the exact limit unchanged', () => {
        expect(clampString('12345', 5)).toBe('12345');
    });

    it('truncates strings that exceed the limit', () => {
        expect(clampString('1234567890', 6)).toBe('123456');
    });

    it('returns an empty string when the limit is zero', () => {
        expect(clampString('hidden', 0)).toBe('');
    });

    it('handles multi-byte user text without altering in-limit content', () => {
        expect(clampString('習慣メモ', 10)).toBe('習慣メモ');
    });

    it('truncates multi-byte user text by JavaScript string length', () => {
        expect(clampString('タスク完了', 3)).toBe('タスク');
    });
});
