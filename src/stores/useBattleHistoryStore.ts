import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BattleHistoryEntry, BattleHistoryStoreState } from '../types';
import { BATTLE_CONFIG } from '../config/gameConfig';

interface BattleHistoryStorePersisted {
    history: BattleHistoryEntry[];
}

export const useBattleHistoryStore = create<BattleHistoryStoreState>()(
    persist(
        (set) => ({
            history: [],

            addBattleResult: (entry: BattleHistoryEntry) => {
                set((state) => ({
                    history: [entry, ...state.history].slice(0, BATTLE_CONFIG.BATTLE_HISTORY_MAX_ENTRIES),
                }));
            },

            clearHistory: () => set({ history: [] }),
        }),
        {
            name: 'quest-board-battle-history',
            version: 1,
            partialize: (state): BattleHistoryStorePersisted => ({
                history: state.history,
            }),
        }
    )
);
