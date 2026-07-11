import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

const MAX_TITLE_LENGTH = 40;

/** Web useTitleStore.ts と同一の検証ロジック */
export function sanitizeActiveTitle(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return null;
    const title = value.trim();
    if (title.length === 0) return null;
    return title.slice(0, MAX_TITLE_LENGTH);
}

interface MobileTitleStore {
    activeTitle: string | null;
    setActiveTitle: (title: string | null) => void;
}

export const useMobileTitleStore = create<MobileTitleStore>()(
    persist(
        (set) => ({
            activeTitle: null,
            setActiveTitle: (title) => set({ activeTitle: sanitizeActiveTitle(title) }),
        }),
        {
            name: 'quest-board-title',
            storage: createJSONStorage(() => AsyncStorage),
            version: 1,
        }
    )
);
