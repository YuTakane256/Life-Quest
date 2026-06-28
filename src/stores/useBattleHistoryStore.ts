import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BattleHistoryEntry, BattleHistoryStoreState } from '../types';
import { BATTLE_CONFIG } from '../config/gameConfig';
import { isPlainObject, toNonNegativeInteger } from '../utils/persistSanitize';

interface BattleHistoryStorePersisted {
    history: BattleHistoryEntry[];
}

function sanitizeTimestamp(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const time = new Date(value).getTime();
    if (Number.isNaN(time)) return null;
    return new Date(Math.min(time, Date.now())).toISOString();
}

function sanitizeBattleLog(raw: unknown): BattleHistoryEntry['logs'][number] | null {
    if (!isPlainObject(raw) || typeof raw.message !== 'string') return null;
    return {
        turn: toNonNegativeInteger(raw.turn),
        message: raw.message.slice(0, 200),
        playerHp: toNonNegativeInteger(raw.playerHp),
        enemyHp: toNonNegativeInteger(raw.enemyHp),
    };
}

function sanitizeBattleHistoryEntry(raw: unknown): BattleHistoryEntry | null {
    if (!isPlainObject(raw)) return null;
    if (typeof raw.id !== 'string') return null;
    const timestamp = sanitizeTimestamp(raw.timestamp);
    if (!timestamp) return null;
    if (raw.outcome !== 'victory' && raw.outcome !== 'defeat') return null;

    const stage = toNonNegativeInteger(raw.stage, -1);
    const stageData = BATTLE_CONFIG.STAGES.find((entry) => entry.stage === stage);
    if (!stageData) return null;

    return {
        id: raw.id,
        timestamp,
        stage,
        enemyName: typeof raw.enemyName === 'string' ? raw.enemyName.slice(0, 80) : stageData.name,
        enemyMaxHp: toNonNegativeInteger(raw.enemyMaxHp, stageData.hp),
        enemyAttack: toNonNegativeInteger(raw.enemyAttack, stageData.attack),
        enemyDefense: toNonNegativeInteger(raw.enemyDefense, stageData.defense),
        outcome: raw.outcome,
        turnCount: toNonNegativeInteger(raw.turnCount),
        xpEarned: toNonNegativeInteger(raw.xpEarned),
        logs: Array.isArray(raw.logs)
            ? raw.logs.map(sanitizeBattleLog).filter((log): log is BattleHistoryEntry['logs'][number] => log !== null).slice(0, 200)
            : [],
    };
}

export function sanitizeBattleHistoryStoreState(persisted: unknown): BattleHistoryStorePersisted {
    if (!isPlainObject(persisted) || !Array.isArray(persisted.history)) {
        return { history: [] };
    }

    const seenIds = new Set<string>();
    const history = persisted.history
        .map(sanitizeBattleHistoryEntry)
        .filter((entry): entry is BattleHistoryEntry => entry !== null)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .filter((entry) => {
            if (seenIds.has(entry.id)) return false;
            seenIds.add(entry.id);
            return true;
        })
        .slice(0, BATTLE_CONFIG.BATTLE_HISTORY_MAX_ENTRIES);

    return {
        history,
    };
}

export const useBattleHistoryStore = create<BattleHistoryStoreState>()(
    persist(
        (set) => ({
            history: [],

            addBattleResult: (entry: BattleHistoryEntry) => {
                set((state) => ({
                    history: [
                        entry,
                        ...state.history.filter((historyEntry) => historyEntry.id !== entry.id),
                    ].slice(0, BATTLE_CONFIG.BATTLE_HISTORY_MAX_ENTRIES),
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
            merge: (persisted, current) => ({
                ...current,
                ...sanitizeBattleHistoryStoreState(persisted),
            }),
        }
    )
);
