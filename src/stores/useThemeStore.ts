import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createWebPersistStorage } from '../platform/storage';
import { createSafePersistMerge } from '../utils/persistMerge';
import { syncSettingsToCloud } from '../platform/settingsSync';

export type ThemeMode = 'light' | 'dark' | 'system';

const VALID_THEME_MODES: readonly ThemeMode[] = ['light', 'dark', 'system'];

/** 未知の値（細工された localStorage や型 ignored な代入）を 'system' にフォールバック */
export function sanitizeThemeMode(value: unknown): ThemeMode {
    return VALID_THEME_MODES.includes(value as ThemeMode) ? (value as ThemeMode) : 'system';
}

interface ThemeStoreState {
    mode: ThemeMode;
    setMode: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeStoreState>()(
    persist(
        (set) => ({
            mode: 'system',
            // setMode 経由でも値を検証して invalid なら 'system' に落とす
            setMode: (mode) => {
                set({ mode: sanitizeThemeMode(mode) });
                syncSettingsToCloud();
            },
        }),
        {
            name: 'quest-board-theme',
            storage: createWebPersistStorage(),
            version: 1,
            // localStorage から読み込んだ persisted state を信用せず、mode を必ず検証する
            merge: createSafePersistMerge<ThemeStoreState>((persisted) => ({
                mode: sanitizeThemeMode(persisted.mode),
            })),
        }
    )
);
