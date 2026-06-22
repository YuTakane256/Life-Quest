import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type MotionMode = 'system' | 'standard' | 'reduced';

const VALID_MOTION_MODES: readonly MotionMode[] = ['system', 'standard', 'reduced'];

export function sanitizeMotionMode(value: unknown): MotionMode {
    return VALID_MOTION_MODES.includes(value as MotionMode) ? (value as MotionMode) : 'system';
}

interface MotionStoreState {
    mode: MotionMode;
    setMode: (mode: MotionMode) => void;
}

export const useMotionStore = create<MotionStoreState>()(
    persist(
        (set) => ({
            mode: 'system',
            setMode: (mode) => set({ mode: sanitizeMotionMode(mode) }),
        }),
        {
            name: 'quest-board-motion',
            version: 1,
            merge: (persisted, current) => {
                const incoming = (persisted as Partial<MotionStoreState> | undefined)?.mode;
                return { ...current, mode: sanitizeMotionMode(incoming) };
            },
        }
    )
);
