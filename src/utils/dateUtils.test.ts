import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getTodayJST,
    getJSTHour,
    generateId,
    isOverdue,
    formatRelativeDate,
    formatHeatmapDate,
    isValidYmd,
    shiftDate,
    addRecurrenceInterval,
    toIsoDatePart,
} from './dateUtils';

describe('isValidYmd', () => {
    it('YYYY-MM-DD 形式の実在日を true にする', () => {
        expect(isValidYmd('2025-03-15')).toBe(true);
        expect(isValidYmd('2024-02-29')).toBe(true);
    });

    it('形式違いと実在しない日付を false にする', () => {
        expect(isValidYmd('2025-3-15')).toBe(false);
        expect(isValidYmd('2025-02-29')).toBe(false);
        expect(isValidYmd('2025-13-01')).toBe(false);
        expect(isValidYmd('2025-00-10')).toBe(false);
        expect(isValidYmd('2025-04-31')).toBe(false);
    });
});

describe('getTodayJST', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('UTC 0時を JST 9時として扱い、同じ暦日を返す', () => {
        vi.useFakeTimers();
        // 2025-03-15T00:00:00Z → JST 2025-03-15 09:00
        vi.setSystemTime(new Date('2025-03-15T00:00:00Z'));
        expect(getTodayJST()).toBe('2025-03-15');
    });

    it('UTC 23:59 が JST では翌日になる', () => {
        vi.useFakeTimers();
        // 2025-03-15T23:59:00Z → JST 2025-03-16 08:59
        vi.setSystemTime(new Date('2025-03-15T23:59:00Z'));
        expect(getTodayJST()).toBe('2025-03-16');
    });

    it('UTC 14:59 がちょうど JST 23:59 で同じ日付', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-03-15T14:59:00Z'));
        expect(getTodayJST()).toBe('2025-03-15');
    });

    it('UTC 15:00 が JST 00:00（翌日）になる', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-03-15T15:00:00Z'));
        expect(getTodayJST()).toBe('2025-03-16');
    });
});

describe('getJSTHour', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('0〜23 の範囲を返す', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-03-15T03:30:00Z'));
        const hour = getJSTHour();
        expect(hour).toBeGreaterThanOrEqual(0);
        expect(hour).toBeLessThan(24);
    });

    it('UTC 0時 → JST 9時', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-03-15T00:00:00Z'));
        expect(getJSTHour()).toBe(9);
    });

    it('UTC 15時 → JST 0時（翌日）', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-03-15T15:00:00Z'));
        expect(getJSTHour()).toBe(0);
    });
});

describe('generateId', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('"{number}-{string}" の形式で返す', () => {
        const id = generateId();
        expect(id).toMatch(/^\d+-[a-z0-9]+$/);
    });

    it('crypto.getRandomValues が使える環境では crypto 由来のセグメントを使う', () => {
        vi.spyOn(Date, 'now').mockReturnValue(123);
        vi.stubGlobal('crypto', {
            getRandomValues: (bytes: Uint8Array) => {
                bytes.set([0, 1, 2, 3, 4, 5, 6, 7]);
                return bytes;
            },
        });

        expect(generateId()).toBe('123-0001020304050607');
    });

    it('crypto が使えない環境では Math.random にフォールバックする', () => {
        vi.spyOn(Date, 'now').mockReturnValue(456);
        vi.spyOn(Math, 'random').mockReturnValue(0.123456789);
        vi.stubGlobal('crypto', undefined);

        expect(generateId()).toMatch(new RegExp(`^456-${(0.123456789).toString(36).substring(2, 12)}[a-z0-9]+$`));
    });

    it('同一時刻・同一乱数が続いてもフォールバックIDは衝突しない', () => {
        vi.spyOn(Date, 'now').mockReturnValue(456);
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        vi.stubGlobal('crypto', undefined);

        const ids = new Set(Array.from({ length: 100 }, () => generateId()));

        expect(ids.size).toBe(100);
    });

    it('crypto.getRandomValues が失敗してもフォールバックIDを返す', () => {
        vi.spyOn(Date, 'now').mockReturnValue(789);
        vi.spyOn(Math, 'random').mockImplementation(() => {
            throw new Error('random unavailable');
        });
        vi.stubGlobal('crypto', {
            getRandomValues: () => {
                throw new Error('crypto unavailable');
            },
        });

        const first = generateId();
        const second = generateId();

        expect(first).toMatch(/^789-[a-z0-9]+$/);
        expect(second).toMatch(/^789-[a-z0-9]+$/);
        expect(first).not.toBe(second);
    });

    it('連続呼び出しでユニークなIDが返る', () => {
        const ids = new Set(Array.from({ length: 100 }, () => generateId()));
        expect(ids.size).toBe(100);
    });
});

describe('isOverdue', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // JST で 2025-03-15 とみなされる時刻に固定
        vi.setSystemTime(new Date('2025-03-15T03:00:00Z'));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('null は overdue 扱いしない', () => {
        expect(isOverdue(null)).toBe(false);
    });

    it('過去日付は overdue', () => {
        expect(isOverdue('2025-03-14')).toBe(true);
    });

    it('今日は overdue ではない', () => {
        expect(isOverdue('2025-03-15')).toBe(false);
    });

    it('未来日付は overdue ではない', () => {
        expect(isOverdue('2025-03-16')).toBe(false);
    });

    it('不正な日付は overdue 扱いしない', () => {
        expect(isOverdue('2025-02-29')).toBe(false);
        expect(isOverdue('not-a-date')).toBe(false);
    });
});

describe('formatRelativeDate', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // JST 基準で 2025-03-15 とみなされる時刻に固定
        vi.setSystemTime(new Date('2025-03-15T03:00:00Z'));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('今日', () => {
        expect(formatRelativeDate('2025-03-15')).toBe('今日');
    });
    it('明日', () => {
        expect(formatRelativeDate('2025-03-16')).toBe('明日');
    });
    it('明後日', () => {
        expect(formatRelativeDate('2025-03-17')).toBe('明後日');
    });
    it('昨日', () => {
        expect(formatRelativeDate('2025-03-14')).toBe('昨日');
    });
    it('N日後', () => {
        expect(formatRelativeDate('2025-03-22')).toBe('7日後');
    });
    it('N日前', () => {
        expect(formatRelativeDate('2025-03-10')).toBe('5日前');
    });
    it('月またぎでも正しい日数差', () => {
        expect(formatRelativeDate('2025-04-15')).toBe('31日後');
    });
    it('不正な日付は空文字を返す', () => {
        expect(formatRelativeDate('2025-02-29')).toBe('');
        expect(formatRelativeDate('not-a-date')).toBe('');
    });
});

describe('formatHeatmapDate', () => {
    it('JST基準で「M月D日(曜)」形式に整形する', () => {
        expect(formatHeatmapDate('2025-07-24')).toBe('7月24日(木)');
    });

    it('UTC境界日でもJSTの日付がずれない（UTC前日深夜のケース）', () => {
        // 2025-01-01T00:00:00+09:00 は UTC では 2024-12-31T15:00:00Z。
        // T00:00:00+09:00固定でパースするため、UTC変換によるズレが起きないことを確認する。
        expect(formatHeatmapDate('2025-01-01')).toBe('1月1日(水)');
    });
});

describe('shiftDate', () => {
    it('+1日: 通常', () => {
        expect(shiftDate('2025-03-15', 1)).toBe('2025-03-16');
    });
    it('-1日: 通常', () => {
        expect(shiftDate('2025-03-15', -1)).toBe('2025-03-14');
    });
    it('月またぎ（月末→翌月1日）', () => {
        expect(shiftDate('2025-03-31', 1)).toBe('2025-04-01');
    });
    it('年またぎ（12/31→1/1）', () => {
        expect(shiftDate('2025-12-31', 1)).toBe('2026-01-01');
    });
    it('うるう年 2024-02-28 +1日 = 2024-02-29', () => {
        expect(shiftDate('2024-02-28', 1)).toBe('2024-02-29');
    });
    it('非うるう年 2025-02-28 +1日 = 2025-03-01', () => {
        expect(shiftDate('2025-02-28', 1)).toBe('2025-03-01');
    });
    it('0日: 同じ日付', () => {
        expect(shiftDate('2025-03-15', 0)).toBe('2025-03-15');
    });
    it('大きい正の値（30日）', () => {
        expect(shiftDate('2025-03-15', 30)).toBe('2025-04-14');
    });
    it('不正な日付は例外にする', () => {
        expect(() => shiftDate('2025-02-29', 1)).toThrow(RangeError);
        expect(() => shiftDate('not-a-date', 1)).toThrow(RangeError);
    });
});

describe('addRecurrenceInterval', () => {
    it('daily で 1 日進む', () => {
        expect(addRecurrenceInterval('2025-03-15', 'daily')).toBe('2025-03-16');
    });
    it('weekly で 7 日進む', () => {
        expect(addRecurrenceInterval('2025-03-15', 'weekly')).toBe('2025-03-22');
    });
    it('monthly で 1 ヶ月進む', () => {
        expect(addRecurrenceInterval('2025-03-15', 'monthly')).toBe('2025-04-15');
    });
    it('monthly で 1/31 → 2/28 に丸める', () => {
        expect(addRecurrenceInterval('2025-01-31', 'monthly')).toBe('2025-02-28');
    });
    it('うるう年の 1/31 + monthly → 2/29 に丸める', () => {
        expect(addRecurrenceInterval('2024-01-31', 'monthly')).toBe('2024-02-29');
    });
    it('monthly で年またぎ', () => {
        expect(addRecurrenceInterval('2025-12-31', 'monthly')).toBe('2026-01-31');
    });
    it('weekly で年またぎ', () => {
        expect(addRecurrenceInterval('2025-12-30', 'weekly')).toBe('2026-01-06');
    });
    it('不正な日付は例外にする', () => {
        expect(() => addRecurrenceInterval('2025-02-29', 'daily')).toThrow(RangeError);
        expect(() => addRecurrenceInterval('not-a-date', 'monthly')).toThrow(RangeError);
    });
});

describe('toIsoDatePart', () => {
    it('ISO日時から日付部分(YYYY-MM-DD)を取り出す', () => {
        expect(toIsoDatePart('2026-06-27T12:34:56.000Z')).toBe('2026-06-27');
    });
    it('日付のみの文字列はそのまま返す', () => {
        expect(toIsoDatePart('2026-06-27')).toBe('2026-06-27');
    });
});
