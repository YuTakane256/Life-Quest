import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getTodayJst, msUntilNextJstDay } from '@life-quest/core/dates';

/** 表示中だけ午前0時を監視。タブ/アプリ復帰時には即時再確認する。 */
export function useJstToday() {
    const [today, setToday] = useState(getTodayJst);
    useFocusEffect(useCallback(() => {
        let timer: ReturnType<typeof setTimeout>;
        const refresh = () => {
            clearTimeout(timer);
            setToday(getTodayJst());
            if (AppState.currentState === 'active') timer = setTimeout(refresh, msUntilNextJstDay());
        };
        refresh();
        const subscription = AppState.addEventListener('change', refresh);
        return () => { clearTimeout(timer); subscription.remove(); };
    }, []));
    return today;
}
