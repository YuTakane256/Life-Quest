import { describe, expect, it, vi } from 'vitest';
import { pickRandom } from './random';

describe('pickRandom', () => {
    it('空配列 → undefined', () => {
        expect(pickRandom([])).toBeUndefined();
    });

    it('1要素配列 → 必ずその要素', () => {
        expect(pickRandom([42])).toBe(42);
        expect(pickRandom(['hello'])).toBe('hello');
    });

    it('N要素から呼び出した結果が配列に含まれる', () => {
        const arr = ['a', 'b', 'c', 'd', 'e'];
        for (let i = 0; i < 20; i++) {
            const result = pickRandom(arr);
            expect(arr).toContain(result);
        }
    });

    it('Math.random をモックすると決定論的に選択できる', () => {
        const arr = [10, 20, 30];
        vi.spyOn(Math, 'random').mockReturnValue(0);
        expect(pickRandom(arr)).toBe(10);

        (Math.random as ReturnType<typeof vi.fn>).mockReturnValue(0.99);
        expect(pickRandom(arr)).toBe(30);

        vi.restoreAllMocks();
    });
});
