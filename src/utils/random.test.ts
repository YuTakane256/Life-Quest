import { describe, expect, it, vi, afterEach } from 'vitest';
import { pickRandom } from './random';

describe('pickRandom', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
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

    it('N要素配列では Math.random に応じた index の要素を返す', () => {
        vi.stubGlobal('crypto', undefined);
        const arr = [1, 2, 3, 4, 5];
        const randomSpy = vi.spyOn(Math, 'random');

        randomSpy.mockReturnValue(0);
        expect(pickRandom(arr)).toBe(1);

        randomSpy.mockReturnValue(0.2);
        expect(pickRandom(arr)).toBe(2);

        randomSpy.mockReturnValue(0.6);
        expect(pickRandom(arr)).toBe(4);

        randomSpy.mockReturnValue(0.999999);
        expect(pickRandom(arr)).toBe(5);
    });

    it('Math.random をモックすると決定的に動く', () => {
        vi.stubGlobal('crypto', undefined);
        const arr = ['a', 'b', 'c', 'd'];
        vi.spyOn(Math, 'random').mockReturnValue(0);
        expect(pickRandom(arr)).toBe('a');
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        expect(pickRandom(arr)).toBe('c');
        vi.spyOn(Math, 'random').mockReturnValue(0.999);
        expect(pickRandom(arr)).toBe('d');
    });

    it('Web Crypto が使える場合は getRandomValues の値から選ぶ', () => {
        vi.stubGlobal('crypto', {
            getRandomValues: (values: Uint32Array) => {
                values[0] = 5;
                return values;
            },
        });

        expect(pickRandom(['a', 'b', 'c'])).toBe('c');
    });

    it('Math.random が 1 を返しても fallback index は範囲内に収まる', () => {
        vi.stubGlobal('crypto', undefined);
        vi.spyOn(Math, 'random').mockReturnValue(1);

        expect(pickRandom(['a', 'b', 'c'])).toBe('c');
    });

    it('readonly 配列も扱える（TS の型制約のみのチェック）', () => {
        const arr = [1, 2, 3] as const;
        const result = pickRandom(arr);
        expect([1, 2, 3]).toContain(result);
    });
});
