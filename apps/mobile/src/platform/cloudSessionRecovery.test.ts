import { beforeEach, describe, expect, it, vi } from 'vitest';
const memory = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
    getItem: vi.fn(async (key: string) => memory.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { memory.set(key, value); }),
    removeItem: vi.fn(async (key: string) => { memory.delete(key); }),
    getAllKeys: vi.fn(async () => [...memory.keys()]),
} }));
import AsyncStorage from '@react-native-async-storage/async-storage';
import { beginMobileCloudSessionCheck, checkMobileCloudSessionOwner, finishMobileCloudSessionCheck,
    getMobileCloudRecoveryState, MOBILE_CLOUD_DISPLAY_OWNER_KEY, releaseMobileCloudDisplayOwner,
    rememberMobileCloudDisplayOwner } from './cloudSessionRecovery';

describe('Mobile cloud cache authentication boundary', () => {
    beforeEach(() => { memory.clear(); vi.restoreAllMocks(); beginMobileCloudSessionCheck(); });
    it('匿名専用データは変更せず通常利用を続ける', async () => {
        memory.set('quest-board-tasks', JSON.stringify({ state: { tasks: [{ id: 'local' }] } }));
        const before = [...memory];
        expect(await checkMobileCloudSessionOwner(null)).toBe(true);
        finishMobileCloudSessionCheck();
        expect(getMobileCloudRecoveryState()).toBe('ready');
        expect([...memory]).toEqual(before);
    });
    it('期限切れ起動ではデータ・所有者別キューを保持して再認証を求める', async () => {
        await rememberMobileCloudDisplayOwner('a');
        memory.set('quest-board-game', 'unchanged game');
        memory.set('life-quest:cloud:a:outbox:v1', 'pending operations');
        const before = [...memory];
        expect(await checkMobileCloudSessionOwner(null)).toBe(false);
        expect(getMobileCloudRecoveryState()).toBe('required');
        expect([...memory]).toEqual(before);
        expect(await checkMobileCloudSessionOwner('b')).toBe(false);
        expect(await checkMobileCloudSessionOwner('a')).toBe(true);
    });
    it('旧版のクラウド表示をIDで判定し、次回起動用の所有者だけ保存する', async () => {
        const tasks = JSON.stringify({ state: { tasks: [{ id: 'cloud-task' }] } });
        memory.set('quest-board-tasks', tasks);
        memory.set('life-quest:cloud:a:cache:tasks:v1', JSON.stringify({ tasks: { 'cloud-task': { id: 'cloud-task', version: 1 } } }));
        expect(await checkMobileCloudSessionOwner(null)).toBe(false);
        expect(memory.get(MOBILE_CLOUD_DISPLAY_OWNER_KEY)).toBe('a');
        expect(memory.get('quest-board-tasks')).toBe(tasks);
        expect(await checkMobileCloudSessionOwner('b')).toBe(false);
    });
    it('過去のクラウドキャッシュがあるだけでは匿名データをロックしない', async () => {
        memory.set('quest-board-tasks', JSON.stringify({ state: { tasks: [{ id: 'local' }] } }));
        memory.set('life-quest:cloud:a:cache:tasks:v1', JSON.stringify({ tasks: { other: { id: 'other', version: 1 } } }));
        expect(await checkMobileCloudSessionOwner(null)).toBe(true);
    });
    it('旧版の同じ所有者へログインした時も初回pull前のログアウト用に所有者を記録する', async () => {
        memory.set('quest-board-tasks', JSON.stringify({ state: { tasks: [{ id: 'cloud-task' }] } }));
        memory.set('life-quest:cloud:a:cache:tasks:v1', JSON.stringify({ tasks: { 'cloud-task': { id: 'cloud-task', version: 1 } } }));
        expect(await checkMobileCloudSessionOwner('a')).toBe(true);
        expect(memory.get(MOBILE_CLOUD_DISPLAY_OWNER_KEY)).toBe('a');
    });
    it('同じXPやキャラクター名だけで匿名進行の所有者を推定しない', async () => {
        memory.set('quest-board-game', JSON.stringify({ state: { character: { name: '勇者', totalXp: 20 }, gachaCount: 0 } }));
        memory.set('life-quest:cloud:a:cache:game:v1', JSON.stringify({ characters: { a: { name: '勇者', total_xp: 20, gacha_count: 0, version: 2 } } }));
        expect(await checkMobileCloudSessionOwner(null)).toBe(true);
        expect(memory.has(MOBILE_CLOUD_DISPLAY_OWNER_KEY)).toBe(false);
    });
    it('旧版のゲームだけの表示も装備の安定IDが一致すれば保護する', async () => {
        memory.set('quest-board-game', JSON.stringify({ state: { equipment: [{ id: 'cloud-item' }], chestQueue: [] } }));
        memory.set('life-quest:cloud:a:cache:game:v1', JSON.stringify({ inventory_items: { 'cloud-item': { id: 'cloud-item', version: 1 } } }));
        expect(await checkMobileCloudSessionOwner(null)).toBe(false);
        expect(memory.get(MOBILE_CLOUD_DISPLAY_OWNER_KEY)).toBe('a');
    });
    it('読取・所有者保存失敗で匿名や別アカウントへ切り替えない', async () => {
        vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('read failed'));
        expect(await checkMobileCloudSessionOwner(null)).toBe(false);
        expect(getMobileCloudRecoveryState()).toBe('storage-error');
        await rememberMobileCloudDisplayOwner('a');
        vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk full'));
        expect(await checkMobileCloudSessionOwner('b')).toBe(false);
        expect(memory.get(MOBILE_CLOUD_DISPLAY_OWNER_KEY)).toBe('a');
    });
    it('古い判定・古いログアウトが新しい所有者を上書きしない', async () => {
        await rememberMobileCloudDisplayOwner('b');
        await rememberMobileCloudDisplayOwner('a', () => false);
        await releaseMobileCloudDisplayOwner('a');
        expect(memory.get(MOBILE_CLOUD_DISPLAY_OWNER_KEY)).toBe('b');
        expect(await checkMobileCloudSessionOwner(null, () => false)).toBe(false);
        expect(getMobileCloudRecoveryState()).toBe('checking');
        await releaseMobileCloudDisplayOwner('b');
        expect(memory.has(MOBILE_CLOUD_DISPLAY_OWNER_KEY)).toBe(false);
    });
});
