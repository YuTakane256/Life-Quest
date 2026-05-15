import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeStoreState {
    mode: ThemeMode;
    setMode: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeStoreState>()(
    persist(
        (set) => ({
            mode: 'system',
            setMode: (mode) => set({ mode }),
        }),
        { name: 'quest-board-theme' }
    )
);
