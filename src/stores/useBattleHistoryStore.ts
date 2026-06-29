import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BattleHistoryEntry, BattleHistoryStoreState } from '../types';
import { BATTLE_CONFIG } from '../config/gameConfig';
import { isPlainObject, toBoundedInteger } from '../utils/persistSanitize';

export const MAX_BATTLE_HISTORY_ID_LENGTH = 128;
export const MAX_BATTLE_HISTORY_LOG_ENTRIES = 200;
const MAX_HISTORY_NUMBER = Number.MAX_SAFE_INTEGER;

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
        turn: toBoundedInteger(raw.turn, 0, 0, MAX_HISTORY_NUMBER),
        message: raw.message.slice(0, 200),
        playerHp: toBoundedInteger(raw.playerHp, 0, 0, MAX_HISTORY_NUMBER),
        enemyHp: toBoundedInteger(raw.enemyHp, 0, 0, MAX_HISTORY_NUMBER),
    };
}

function sanitizeBattleHistoryEntry(raw: unknown): BattleHistoryEntry | null {
    if (!isPlainObject(raw)) return null;
    if (typeof raw.id !== 'string') return null;
    const id = raw.id.trim();
    if (!id || id.length > MAX_BATTLE_HISTORY_ID_LENGTH) return null;
    const timestamp = sanitizeTimestamp(raw.timestamp);
    if (!timestamp) return null;
    if (raw.outcome !== 'victory' && raw.outcome !== 'defeat') return null;

    const stage = toBoundedInteger(raw.stage, -1, 0, MAX_HISTORY_NUMBER);
    const stageData = BATTLE_CONFIG.STAGES.find((entry) => entry.stage === stage);
    if (!stageData) return null;

    return {
        id,
        timestamp,
        stage,
        enemyName: typeof raw.enemyName === 'string' ? raw.enemyName.slice(0, 80) : stageData.name,
        enemyMaxHp: toBoundedInteger(raw.enemyMaxHp, stageData.hp, 0, MAX_HISTORY_NUMBER),
        enemyAttack: toBoundedInteger(raw.enemyAttack, stageData.attack, 0, MAX_HISTORY_NUMBER),
        enemyDefense: toBoundedInteger(raw.enemyDefense, stageData.defense, 0, MAX_HISTORY_NUMBER),
        outcome: raw.outcome,
        turnCount: toBoundedInteger(raw.turnCount, 0, 0, MAX_HISTORY_NUMBER),
        xpEarned: toBoundedInteger(raw.xpEarned, 0, 0, MAX_HISTORY_NUMBER),
        logs: Array.isArray(raw.logs)
            ? raw.logs.map(sanitizeBattleLog).filter((log): log is BattleHistoryEntry['logs'][number] => log !== null).slice(0, MAX_BATTLE_HISTORY_LOG_ENTRIES)
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
                const sanitized = sanitizeBattleHistoryEntry(entry);
                if (!sanitized) return;
                set((state) => ({
                    history: [
                        sanitized,
                        ...state.history.filter((historyEntry) => historyEntry.id !== sanitized.id),
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
