import { describe, expect, it } from 'vitest';
import { createGameCloudClient } from './gameCloud.ts';
import { EdgeFunctionError, type EdgeFunctionInvoker } from './edgeFunctions.ts';

function makeInvoker(handler: (name: string, body?: Record<string, unknown>) => unknown): EdgeFunctionInvoker {
    return (async <TResult>(name: string, body?: Record<string, unknown>) => handler(name, body) as TResult);
}

describe('createGameCloudClient', () => {
    describe('startBattleAttempt', () => {
        it('クラウド未接続ならnullを返す', async () => {
            const client = createGameCloudClient({ getInvoker: () => null });
            expect(await client.startBattleAttempt(1)).toBeNull();
        });

        it('レスポンスをCloudBattleAttemptへ変換する', async () => {
            const calls: { name: string; body?: Record<string, unknown> }[] = [];
            const invoker = makeInvoker((name, body) => {
                calls.push({ name, body });
                return {
                    battle_attempt_id: 'attempt-1',
                    enemy_snapshot: { stage: 1, name: 'スライム', maxHp: 10, attack: 1, defense: 1, xpReward: 5 },
                    player_snapshot: { name: '勇者', level: 3, attack: 10, defense: 5, maxHp: 50 },
                };
            });
            const client = createGameCloudClient({ getInvoker: () => invoker });

            const result = await client.startBattleAttempt(1);
            expect(result).toEqual({
                battleAttemptId: 'attempt-1',
                actors: {
                    player: { attack: 10, defense: 5, maxHp: 50 },
                    enemy: { stage: 1, name: 'スライム', maxHp: 10, attack: 1, defense: 1, xpReward: 5 },
                    playerLevel: 3,
                    playerName: '勇者',
                },
            });
            expect(calls[0].name).toBe('start_battle_attempt');
            expect(calls[0].body).toMatchObject({ stage: 1 });
            expect(typeof calls[0].body?.idempotencyKey).toBe('string');
        });

        it('generateIdを注入するとそれを冪等キーに使う', async () => {
            const invoker = makeInvoker(() => ({
                battle_attempt_id: 'attempt-1',
                enemy_snapshot: { stage: 1, name: 'e', maxHp: 1, attack: 1, defense: 1, xpReward: 1 },
                player_snapshot: { name: 'p', level: 1, attack: 1, defense: 1, maxHp: 1 },
            }));
            const calls: { name: string; body?: Record<string, unknown> }[] = [];
            const wrappedInvoker: EdgeFunctionInvoker = async (name, body) => {
                calls.push({ name, body });
                return invoker(name, body);
            };
            const client = createGameCloudClient({ getInvoker: () => wrappedInvoker, generateId: () => 'fixed-id' });

            await client.startBattleAttempt(1);
            expect(calls[0].body?.idempotencyKey).toBe('fixed-id');
        });
    });

    describe('resolveBattleAttempt', () => {
        it('クラウド未接続なら例外を投げる', async () => {
            const client = createGameCloudClient({ getInvoker: () => null });
            await expect(client.resolveBattleAttempt('attempt-1', [{ type: 'attack' }])).rejects.toThrow(EdgeFunctionError);
        });

        it('レスポンスをそのまま返す', async () => {
            const invoker = makeInvoker(() => ({ outcome: 'victory', granted: true }));
            const client = createGameCloudClient({ getInvoker: () => invoker });

            const result = await client.resolveBattleAttempt('attempt-1', [{ type: 'attack' }]);
            expect(result).toEqual({ outcome: 'victory', granted: true });
        });
    });

    describe('openChest', () => {
        it('クラウド未接続ならnullを返す', async () => {
            const client = createGameCloudClient({ getInvoker: () => null });
            expect(await client.openChest('chest-1', 'key-1')).toBeNull();
        });

        it('idempotencyKeyをそのまま送り、レスポンスを変換する', async () => {
            const calls: { name: string; body?: Record<string, unknown> }[] = [];
            const invoker = makeInvoker((name, body) => {
                calls.push({ name, body });
                return { item_id: 'item-1', template_id: 'sword-1', version: 5, starter_character: true };
            });
            const client = createGameCloudClient({ getInvoker: () => invoker });

            const result = await client.openChest('chest-1', 'key-1');
            expect(result).toEqual({ itemId: 'item-1', templateId: 'sword-1', starterCharacter: true });
            expect(calls[0]).toEqual({ name: 'open_chest', body: { chestId: 'chest-1', idempotencyKey: 'key-1' } });
        });

        it('blue宝箱（装備なし）はitemId/templateIdがnullのまま返る', async () => {
            const invoker = makeInvoker(() => ({ item_id: null, template_id: null, version: 1 }));
            const client = createGameCloudClient({ getInvoker: () => invoker });

            const result = await client.openChest('chest-1', 'key-1');
            expect(result).toEqual({ itemId: null, templateId: null, starterCharacter: false });
        });
    });

    describe('synthesizeItems', () => {
        it('クラウド未接続ならnullを返す', async () => {
            const client = createGameCloudClient({ getInvoker: () => null });
            expect(await client.synthesizeItems(['a', 'b', 'c', 'd', 'e'], 'key-1')).toBeNull();
        });

        it('idempotencyKeyをそのまま送り、レスポンスを変換する', async () => {
            const calls: { name: string; body?: Record<string, unknown> }[] = [];
            const invoker = makeInvoker((name, body) => {
                calls.push({ name, body });
                return { result_id: 'result-1', template_id: 'shield-1', version: 9 };
            });
            const client = createGameCloudClient({ getInvoker: () => invoker });

            const result = await client.synthesizeItems(['a', 'b', 'c', 'd', 'e'], 'key-1');
            expect(result).toEqual({ resultId: 'result-1', templateId: 'shield-1' });
            expect(calls[0]).toEqual({
                name: 'synthesize_items',
                body: { itemIds: ['a', 'b', 'c', 'd', 'e'], idempotencyKey: 'key-1' },
            });
        });
    });
});
