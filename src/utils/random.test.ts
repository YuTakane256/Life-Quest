import { describe, expect, it, vi, afterEach } from 'vitest';
import { pickRandom } from './random';

describe('pickRandom', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('空配列は undefined を返す', () => {
        expect(pickRandom([])).toBeUndefined();
    });

    it('1要素配列は必ずその要素を返す', () => {
        expect(pickRandom(['only'])).toBe('only');
        // 100 回試行しても変わらない
        for (let i = 0; i < 100; i++) {
            expect(pickRandom([42])).toBe(42);
        }
    });

    it('N要素配列の結果は元の配列に含まれる要素', () => {
        const arr = [1, 2, 3, 4, 5];
        const seen = new Set<number>();
        for (let i = 0; i < 200; i++) {
            const result = pickRandom(arr);
            expect(arr).toContain(result);
            if (result !== undefined) seen.add(result);
        }
        // 200回引けば全要素が出現する可能性が極めて高い
        expect(seen.size).toBe(arr.length);
    });

    it('Math.random をモックすると決定的に動く', () => {
        const arr = ['a', 'b', 'c', 'd'];
        vi.spyOn(Math, 'random').mockReturnValue(0);
        expect(pickRandom(arr)).toBe('a');
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        expect(pickRandom(arr)).toBe('c');
        vi.spyOn(Math, 'random').mockReturnValue(0.999);
        expect(pickRandom(arr)).toBe('d');
    });

    it('readonly 配列も扱える（TS の型制約のみのチェック）', () => {
        const arr = [1, 2, 3] as const;
        const result = pickRandom(arr);
        expect([1, 2, 3]).toContain(result);
    });
});
