/** 今日の日付 (YYYY-MM-DD, JST) を返す。習慣・日次ボーナスの判定に使う。 */
export function getTodayJst(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

/** 現在のJSTの時（0〜23）を返す。通知リマインダーの時刻判定に使う。 */
export function getJstHour(): number {
    const hour = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit',
        hour12: false,
    }).format(new Date());
    return Number(hour) % 24; // en-GBのhour12:falseは深夜0時を"24"と返すため丸める
}
