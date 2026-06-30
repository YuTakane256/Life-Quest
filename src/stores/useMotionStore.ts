import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createWebPersistStorage } from '../platform/storage';
import { createSafePersistMerge } from '../utils/persistMerge';

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
            storage: createWebPersistStorage(),
            version: 1,
            merge: createSafePersistMerge<MotionStoreState>((persisted) => ({
                mode: sanitizeMotionMode(persisted.mode),
            })),
        }
    )
);
