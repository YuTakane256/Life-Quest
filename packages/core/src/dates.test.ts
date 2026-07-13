import { afterEach, describe, expect, it, vi } from 'vitest';
import { getJstHour, getTodayJst, isOverdue, isValidYmd, shiftDate, toIsoDatePart } from './dates.ts';

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

describe('getTodayJst', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('UTC 0時を JST 9時として扱い、同じ暦日を返す', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-03-15T00:00:00Z'));
        expect(getTodayJst()).toBe('2025-03-15');
    });

    it('UTC 14:59 がちょうど JST 23:59 で同じ日付', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-03-15T14:59:00Z'));
        expect(getTodayJst()).toBe('2025-03-15');
    });

    it('UTC 15:00 が JST 00:00（翌日）になる', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-03-15T15:00:00Z'));
        expect(getTodayJst()).toBe('2025-03-16');
    });

    it('`Intl`(Asia/Tokyo)方式（旧Mobile実装）と同じ結果になる（サンプル時刻での後方互換確認）', () => {
        const samples = [
            '2025-01-01T00:00:00Z', // 年跨ぎ境界
            '2025-12-31T23:59:59Z',
            '2025-02-28T14:59:59Z', // 月末境界（平年）
            '2024-02-28T15:00:00Z', // 月末境界（うるう年、UTC 15:00でJST翌日）
            '2025-06-15T15:00:00Z', // 日付変わり目ちょうど
        ];
        for (const iso of samples) {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(iso));
            const intlResult = new Intl.DateTimeFormat('en-CA', {
                timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
            }).format(new Date());
            expect(getTodayJst()).toBe(intlResult);
            vi.useRealTimers();
        }
    });
});

describe('getJstHour', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('UTC 0時 → JST 9時', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-03-15T00:00:00Z'));
        expect(getJstHour()).toBe(9);
    });

    it('UTC 15時 → JST 0時（翌日）', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-03-15T15:00:00Z'));
        expect(getJstHour()).toBe(0);
    });

    it('`Intl`(Asia/Tokyo)方式（旧Mobile実装）と同じ結果になる', () => {
        const samples = ['2025-01-01T00:00:00Z', '2025-12-31T23:59:59Z', '2025-06-15T15:00:00Z'];
        for (const iso of samples) {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(iso));
            const hour = new Intl.DateTimeFormat('en-GB', {
                timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false,
            }).format(new Date());
            const intlResult = Number(hour) % 24;
            expect(getJstHour()).toBe(intlResult);
            vi.useRealTimers();
        }
    });
});

describe('toIsoDatePart', () => {
    it('日時文字列から日付部分を取り出す', () => {
        expect(toIsoDatePart('2026-06-27T12:34:56.000Z')).toBe('2026-06-27');
    });

    it('既に日付部分だけの文字列はそのまま返す', () => {
        expect(toIsoDatePart('2026-06-27')).toBe('2026-06-27');
    });
});

describe('shiftDate', () => {
    it('日数を加算・減算する', () => {
        expect(shiftDate('2025-03-15', 1)).toBe('2025-03-16');
        expect(shiftDate('2025-03-15', -1)).toBe('2025-03-14');
    });

    it('月末・年末をまたぐ', () => {
        expect(shiftDate('2025-03-31', 1)).toBe('2025-04-01');
        expect(shiftDate('2025-12-31', 1)).toBe('2026-01-01');
    });

    it('うるう年を考慮する', () => {
        expect(shiftDate('2024-02-28', 1)).toBe('2024-02-29');
        expect(shiftDate('2025-02-28', 1)).toBe('2025-03-01');
    });

    it('0日ずらしはそのまま返す', () => {
        expect(shiftDate('2025-03-15', 0)).toBe('2025-03-15');
    });

    it('複数日ずらせる', () => {
        expect(shiftDate('2025-03-15', 30)).toBe('2025-04-14');
    });

    it('不正な日付はRangeErrorを投げる', () => {
        expect(() => shiftDate('2025-02-29', 1)).toThrow(RangeError);
        expect(() => shiftDate('not-a-date', 1)).toThrow(RangeError);
    });
});

describe('isOverdue', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('null は overdue 扱いしない', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-03-15T03:00:00Z'));
        expect(isOverdue(null)).toBe(false);
    });

    it('過去日付は overdue', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-03-15T03:00:00Z'));
        expect(isOverdue('2025-03-14')).toBe(true);
    });

    it('今日・未来日付は overdue ではない', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-03-15T03:00:00Z'));
        expect(isOverdue('2025-03-15')).toBe(false);
        expect(isOverdue('2025-03-16')).toBe(false);
    });

    it('不正な日付は overdue 扱いしない', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-03-15T03:00:00Z'));
        expect(isOverdue('2025-02-29')).toBe(false);
        expect(isOverdue('not-a-date')).toBe(false);
    });
});
