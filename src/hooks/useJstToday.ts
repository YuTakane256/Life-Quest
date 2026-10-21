import { useEffect, useState } from 'react';
import { getTodayJst, msUntilNextJstDay } from '@life-quest/core/dates';

/** 日付をまたいだ表示と、スリープ/別タブからの復帰を更新する。保存処理は行わない。 */
export function useJstToday() {
    const [today, setToday] = useState(getTodayJst);
    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        const refresh = () => {
            clearTimeout(timer);
            setToday(getTodayJst());
            if (document.visibilityState === 'visible') timer = setTimeout(refresh, msUntilNextJstDay());
        };
        refresh();
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', refresh);
        return () => { clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
    }, []);
    return today;
}
