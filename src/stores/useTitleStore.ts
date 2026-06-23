import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const MAX_TITLE_LENGTH = 40;

export function sanitizeActiveTitle(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') return null;
    const title = value.trim();
    if (title.length === 0) return null;
    return title.slice(0, MAX_TITLE_LENGTH);
}

interface TitleStoreState {
    activeTitle: string | null;
    setActiveTitle: (title: string | null) => void;
}

export const useTitleStore = create<TitleStoreState>()(
    persist(
        (set) => ({
            activeTitle: null,
            setActiveTitle: (title) => set({ activeTitle: sanitizeActiveTitle(title) }),
        }),
        {
            name: 'quest-board-title',
            version: 1,
            merge: (persisted, current) => {
                const incoming = (persisted as Partial<TitleStoreState> | undefined)?.activeTitle;
                return { ...current, activeTitle: sanitizeActiveTitle(incoming) };
            },
        }
    )
);
