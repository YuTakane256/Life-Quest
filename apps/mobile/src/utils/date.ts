/** 今日の日付 (YYYY-MM-DD, JST) を返す。習慣・日次ボーナスの判定に使う。 */
export function getTodayJst(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}
