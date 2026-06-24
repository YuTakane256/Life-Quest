import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BATTLE_CONFIG } from '../config/gameConfig';
import { sanitizeBattleHistoryStoreState, useBattleHistoryStore } from './useBattleHistoryStore';

function reset() {
    localStorage.clear();
    useBattleHistoryStore.setState({ history: [] });
}

describe('useBattleHistoryStore', () => {
    beforeEach(() => reset());

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('sanitizeBattleHistoryStoreState', () => {
        it('非オブジェクトや history 配列以外は空履歴にする', () => {
            expect(sanitizeBattleHistoryStoreState(null)).toEqual({ history: [] });
            expect(sanitizeBattleHistoryStoreState({ history: 'broken' })).toEqual({ history: [] });
        });

        it('有効な履歴だけを残し、危険な値を丸める', () => {
            const stage = BATTLE_CONFIG.STAGES[0];
            const sanitized = sanitizeBattleHistoryStoreState({
                history: [
                    'broken',
                    {
                        id: 'history-1',
                        timestamp: '2026-06-13T00:00:00.000Z',
                        stage: stage.stage,
                        enemyName: 'x'.repeat(90),
                        enemyMaxHp: 10.8,
                        enemyAttack: -10,
                        enemyDefense: Number.NaN,
                        outcome: 'victory',
                        turnCount: 3.8,
                        xpEarned: 5.2,
                        logs: [
                            { turn: 1.9, message: 'm'.repeat(220), playerHp: 50.2, enemyHp: -1 },
                            { turn: 2, message: 123, playerHp: 40, enemyHp: 0 },
                        ],
                    },
                    {
                        id: 'bad-stage',
                        timestamp: '2026-06-13T00:00:00.000Z',
                        stage: 999,
                        outcome: 'defeat',
                    },
                    {
                        id: 'bad-date',
                        timestamp: 'not-a-date',
                        stage: stage.stage,
                        outcome: 'defeat',
                    },
                ],
            });

            expect(sanitized.history).toHaveLength(1);
            expect(sanitized.history[0]).toMatchObject({
                id: 'history-1',
                timestamp: '2026-06-13T00:00:00.000Z',
                stage: stage.stage,
                enemyName: 'x'.repeat(80),
                enemyMaxHp: 10,
                enemyAttack: 0,
                enemyDefense: stage.defense,
                outcome: 'victory',
                turnCount: 3,
                xpEarned: 5,
            });
            expect(sanitized.history[0].logs).toEqual([
                {
                    turn: 1,
                    message: 'm'.repeat(200),
                    playerHp: 50,
                    enemyHp: 0,
                },
            ]);
        });

        it('履歴件数は設定上限までに制限する', () => {
            const stage = BATTLE_CONFIG.STAGES[0];
            const history = Array.from({ length: BATTLE_CONFIG.BATTLE_HISTORY_MAX_ENTRIES + 5 }, (_, index) => ({
                id: `history-${index}`,
                timestamp: '2026-06-13T00:00:00.000Z',
                stage: stage.stage,
                enemyName: stage.name,
                enemyMaxHp: stage.hp,
                enemyAttack: stage.attack,
                enemyDefense: stage.defense,
                outcome: 'victory',
                turnCount: 1,
                xpEarned: stage.xpReward,
                logs: [],
            }));

            expect(sanitizeBattleHistoryStoreState({ history }).history).toHaveLength(
                BATTLE_CONFIG.BATTLE_HISTORY_MAX_ENTRIES
            );
        });

        it('履歴は新しい順に並べ、同じIDは最新の1件だけ残す', () => {
            const stage = BATTLE_CONFIG.STAGES[0];
            const makeEntry = (id: string, timestamp: string, outcome: 'victory' | 'defeat' = 'victory') => ({
                id,
                timestamp,
                stage: stage.stage,
                enemyName: stage.name,
                enemyMaxHp: stage.hp,
                enemyAttack: stage.attack,
                enemyDefense: stage.defense,
                outcome,
                turnCount: 1,
                xpEarned: outcome === 'victory' ? stage.xpReward : 0,
                logs: [],
            });

            const sanitized = sanitizeBattleHistoryStoreState({
                history: [
                    makeEntry('old', '2026-06-11T00:00:00.000Z'),
                    makeEntry('duplicate', '2026-06-10T00:00:00.000Z', 'defeat'),
                    makeEntry('new', '2026-06-13T00:00:00.000Z'),
                    makeEntry('duplicate', '2026-06-12T00:00:00.000Z', 'victory'),
                ],
            });

            expect(sanitized.history.map((entry) => entry.id)).toEqual(['new', 'duplicate', 'old']);
            expect(sanitized.history.find((entry) => entry.id === 'duplicate')?.outcome).toBe('victory');
        });

        it('未来の timestamp は現在時刻に丸める', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-06-13T12:00:00.000Z'));
            const stage = BATTLE_CONFIG.STAGES[0];

            const sanitized = sanitizeBattleHistoryStoreState({
                history: [
                    {
                        id: 'future',
                        timestamp: '2999-01-01T00:00:00.000Z',
                        stage: stage.stage,
                        enemyName: stage.name,
                        enemyMaxHp: stage.hp,
                        enemyAttack: stage.attack,
                        enemyDefense: stage.defense,
                        outcome: 'victory',
                        turnCount: 1,
                        xpEarned: stage.xpReward,
                        logs: [],
                    },
                ],
            });

            expect(sanitized.history[0].timestamp).toBe('2026-06-13T12:00:00.000Z');
        });
    });

    it('addBattleResult は新しい履歴を先頭に追加し上限を守る', () => {
        const stage = BATTLE_CONFIG.STAGES[0];
        const entry = {
            id: 'history-1',
            timestamp: '2026-06-13T00:00:00.000Z',
            stage: stage.stage,
            enemyName: stage.name,
            enemyMaxHp: stage.hp,
            enemyAttack: stage.attack,
            enemyDefense: stage.defense,
            outcome: 'victory' as const,
            turnCount: 1,
            xpEarned: stage.xpReward,
            logs: [],
        };

        useBattleHistoryStore.getState().addBattleResult(entry);

        expect(useBattleHistoryStore.getState().history).toEqual([entry]);
    });

    it('addBattleResult は同じIDの古い履歴を置き換える', () => {
        const stage = BATTLE_CONFIG.STAGES[0];
        const olderEntry = {
            id: 'history-1',
            timestamp: '2026-06-13T00:00:00.000Z',
            stage: stage.stage,
            enemyName: stage.name,
            enemyMaxHp: stage.hp,
            enemyAttack: stage.attack,
            enemyDefense: stage.defense,
            outcome: 'defeat' as const,
            turnCount: 2,
            xpEarned: 0,
            logs: [],
        };
        const replacementEntry = {
            ...olderEntry,
            timestamp: '2026-06-14T00:00:00.000Z',
            outcome: 'victory' as const,
            xpEarned: stage.xpReward,
        };

        useBattleHistoryStore.getState().addBattleResult(olderEntry);
        useBattleHistoryStore.getState().addBattleResult(replacementEntry);

        expect(useBattleHistoryStore.getState().history).toEqual([replacementEntry]);
    });
});
