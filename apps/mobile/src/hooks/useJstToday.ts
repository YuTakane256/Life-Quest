import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getTodayJst, msUntilNextJstDay } from '@life-quest/core/dates';

/** 表示中だけ午前0時を監視。タブ/アプリ復帰時には即時再確認する。 */
export function useJstToday() {
    const [, refreshView] = useState(0);
    useFocusEffect(useCallback(() => {
        let timer: ReturnType<typeof setTimeout>;
        const refresh = () => {
            clearTimeout(timer);
            refreshView((revision) => revision + 1);
            if (AppState.currentState === 'active') timer = setTimeout(refresh, msUntilNextJstDay());
        };
        refresh();
        const subscription = AppState.addEventListener('change', refresh);
        return () => { clearTimeout(timer); subscription.remove(); };
    }, []));
    // Also refresh on normal renders before a delayed AppState / timer notification arrives.
    return getTodayJst();
}
