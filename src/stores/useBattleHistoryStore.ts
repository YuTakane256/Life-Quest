import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BattleHistoryEntry, BattleHistoryStoreState } from '../types';
import { BATTLE_CONFIG } from '../config/gameConfig';

interface BattleHistoryStorePersisted {
    history: BattleHistoryEntry[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.floor(value))
        : fallback;
}

function sanitizeBattleLog(raw: unknown): BattleHistoryEntry['logs'][number] | null {
    if (!isPlainObject(raw) || typeof raw.message !== 'string') return null;
    return {
        turn: nonNegativeInteger(raw.turn),
        message: raw.message.slice(0, 200),
        playerHp: nonNegativeInteger(raw.playerHp),
        enemyHp: nonNegativeInteger(raw.enemyHp),
    };
}

function sanitizeBattleHistoryEntry(raw: unknown): BattleHistoryEntry | null {
    if (!isPlainObject(raw)) return null;
    if (typeof raw.id !== 'string' || typeof raw.timestamp !== 'string') return null;
    if (Number.isNaN(new Date(raw.timestamp).getTime())) return null;
    if (raw.outcome !== 'victory' && raw.outcome !== 'defeat') return null;

    const stage = nonNegativeInteger(raw.stage, -1);
    const stageData = BATTLE_CONFIG.STAGES.find((entry) => entry.stage === stage);
    if (!stageData) return null;

    return {
        id: raw.id,
        timestamp: raw.timestamp,
        stage,
        enemyName: typeof raw.enemyName === 'string' ? raw.enemyName.slice(0, 80) : stageData.name,
        enemyMaxHp: nonNegativeInteger(raw.enemyMaxHp, stageData.hp),
        enemyAttack: nonNegativeInteger(raw.enemyAttack, stageData.attack),
        enemyDefense: nonNegativeInteger(raw.enemyDefense, stageData.defense),
        outcome: raw.outcome,
        turnCount: nonNegativeInteger(raw.turnCount),
        xpEarned: nonNegativeInteger(raw.xpEarned),
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
