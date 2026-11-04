import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNavigate } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { createEquipmentFromTemplate } from '@life-quest/core/equipment';
import { EQUIPMENT_POOL, type ChestReward } from '@life-quest/core/rewards';
import { useGameStore } from '../stores/useGameStore';
import App from '../App';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), open: vi.fn(), synth: vi.fn() }));
vi.mock('../platform/auth', () => ({ getGameAuthState: mocks.auth }));
vi.mock('../platform/gameCloud', () => ({ openCloudChest: mocks.open, synthesizeCloudItems: mocks.synth }));
vi.mock('../platform/cloudOutbox', () => ({ enqueueCloudOperation: vi.fn(), isWebCloudOutboxActive: () => false }));
vi.mock('../utils/notifications', () => ({ runNotificationChecks: vi.fn(), cancelNotificationChecks: vi.fn() }));
vi.mock('../stores/useLoginBonusStore', () => ({ useLoginBonusStore: { getState: () => ({ checkDailyLogin() {} }) } }));
vi.mock('../pages/TasksPage', () => ({ TasksPage: () => createElement('div', {}, 'tasks-route') }));
vi.mock('../components/layout/BottomNav', () => ({ BottomNav: () => {
    const navigate = useNavigate();
    return createElement('nav', {}, ...['tasks', 'character', 'character/inventory'].map((path) => createElement('button',
        { key: path, onClick: () => navigate('/' + path) }, 'go-' + path)));
} }));
vi.mock('../components/ui/ThemeController', () => ({ ThemeController: () => null }));
vi.mock('../components/ui/LevelUpOverlay', () => ({ LevelUpOverlay: () => null }));
vi.mock('../components/ui/LoginBonusOverlay', () => ({ LoginBonusOverlay: () => null }));
vi.mock('../components/ui/CompletionRewardNotice', () => ({ CompletionRewardNotice: () => null }));

let root: Root; let host: HTMLDivElement; let mounted: boolean;
const initial = useGameStore.getInitialState();
const chests = (): ChestReward[] => [1, 2].map((n) => ({ id: 'chest-' + n, label: '試験の木箱' + n,
    chestType: 'wood', opened: false, equipment: null, origin: 'cloud' }));
function button(text: string) { return [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!; }
async function click(text: string) { const target = button(text); expect(target).toBeTruthy(); await act(async () => target.click()); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { resolve, promise }; }
const result = (id = 'item') => ({ itemId: id, templateId: 'wooden_sword', starterCharacter: false });
beforeEach(async () => {
    await import('../pages/CharacterPage');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); resetAuthLifecycleHooks(); await notifyLogin('a'); localStorage.clear();
    vi.clearAllMocks(); mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'a' }); mocks.open.mockResolvedValue(result());
    useGameStore.setState({ ...initial, chestQueue: chests(), equipment: [], pendingChestReveal: null });
    history.replaceState({}, '', '/character');
    host = document.createElement('div'); document.body.append(host); root = createRoot(host); mounted = true;
    await act(async () => root.render(createElement(App)));
});
afterEach(async () => {
    if (mounted) await act(async () => root.unmount()); host.remove(); resetAuthLifecycleHooks(); vi.unstubAllGlobals();
    useGameStore.setState(initial); history.replaceState({}, '', '/');
});

describe('Web chest operations across actual routes', () => {
    it('keeps the failed chest and key through inventory/tasks navigation, then opens once on retry', async () => {
        mocks.open.mockRejectedValueOnce(new TypeError('response lost'));
        await click('試験の木箱1'); expect(button('再送')).toBeTruthy();
        await click('go-character/inventory'); await click('go-tasks'); await click('go-character');
        expect(button('再送')).toBeTruthy(); await click('再送');
        expect(mocks.open).toHaveBeenCalledTimes(2);
        expect(mocks.open.mock.calls.map(([id]) => id)).toEqual(['chest-1', 'chest-1']);
        expect(mocks.open.mock.calls[0][1]).toBe(mocks.open.mock.calls[1][1]);
        expect(useGameStore.getState().equipment.map((x) => x.id)).toEqual(['item']);
        expect(useGameStore.getState().chestQueue.filter((c) => c.opened)).toHaveLength(1);
        expect(useGameStore.getState().pendingChestReveal?.chestId).toBe('chest-1'); expect(button('再送')).toBeUndefined();
    });
    it('retains the opening lock after remount and completes once through the global reveal without changing routes', async () => {
        const pending = deferred<unknown>(); mocks.open.mockReturnValueOnce(pending.promise);
        await click('試験の木箱1'); await click('go-tasks'); await click('go-character');
        expect(button('試験の木箱1').disabled).toBe(true); expect(button('試験の木箱2').disabled).toBe(true); await click('試験の木箱1'); await click('試験の木箱2');
        expect(mocks.open).toHaveBeenCalledTimes(1); await click('go-tasks');
        await act(async () => { pending.resolve(result()); });
        expect(useGameStore.getState().equipment.map((x) => x.id)).toEqual(['item']);
        expect(useGameStore.getState().chestQueue.filter((c) => c.opened).map((c) => c.id)).toEqual(['chest-1']);
        expect(useGameStore.getState().pendingChestReveal?.chestId).toBe('chest-1'); expect(location.pathname).toBe('/tasks');
        expect(host.querySelector('img[alt="試験の木箱1"]')).toBeTruthy(); expect(host.textContent).toContain('タップして開ける');
    });
    it('drops retry identity after logout and binds a new B request to a new key', async () => {
        mocks.open.mockRejectedValueOnce(new TypeError('response lost'));
        await click('試験の木箱1'); await click('go-tasks');
        await act(async () => { await notifyLogout(); mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'b' }); await notifyLogin('b');
            useGameStore.setState({ chestQueue: chests(), equipment: [], pendingChestReveal: null }); });
        await click('go-character'); expect(button('再送')).toBeUndefined(); await click('試験の木箱1');
        expect(mocks.open).toHaveBeenCalledTimes(2); expect(mocks.open.mock.calls[0][1]).not.toBe(mocks.open.mock.calls[1][1]);
        expect(mocks.open.mock.calls[1][2].expectedUserId).toBe('b'); expect(useGameStore.getState().equipment).toHaveLength(1);
    });
    it('does not apply late A results or end the new B opening state', async () => {
        const old = deferred<unknown>(); const current = deferred<unknown>();
        mocks.open.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
        await click('試験の木箱1'); await click('go-tasks');
        await act(async () => { mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'b' }); await notifyLogin('b');
            useGameStore.setState({ chestQueue: chests(), equipment: [], pendingChestReveal: null }); });
        await click('go-character'); await click('試験の木箱1');
        await act(async () => { old.resolve(result('old-a')); });
        expect(useGameStore.getState().equipment).toEqual([]); expect(useGameStore.getState().pendingChestReveal).toBeNull();
        expect(button('試験の木箱1').disabled).toBe(true); expect(mocks.open.mock.calls[1][2].expectedUserId).toBe('b');
        await act(async () => { current.resolve(result('new-b')); });
        expect(useGameStore.getState().equipment.map((x) => x.id)).toEqual(['new-b']);
    });
    it('does not apply a response after the entire App unmounts', async () => {
        const pending = deferred<unknown>(); mocks.open.mockReturnValueOnce(pending.promise);
        await click('試験の木箱1'); await act(async () => root.unmount()); mounted = false;
        await act(async () => { pending.resolve(result()); });
        expect(mocks.open.mock.calls[0][2].isActive()).toBe(false);
        expect(useGameStore.getState().equipment).toEqual([]); expect(useGameStore.getState().pendingChestReveal).toBeNull();
    });
    it('does not duplicate or reveal a chest already applied by canonical sync before the response arrives', async () => {
        const pending = deferred<unknown>(); mocks.open.mockReturnValueOnce(pending.promise);
        await click('試験の木箱1'); await click('go-tasks');
        const item = { ...createEquipmentFromTemplate('item', EQUIPMENT_POOL.find((t) => t.id === 'wooden_sword')!), equipped: true };
        await act(async () => { useGameStore.setState({ equipment: [item], chestQueue: chests().map((c) => c.id === 'chest-1' ? { ...c, opened: true, equipment: item } : c) });
            pending.resolve(result()); });
        expect(useGameStore.getState().equipment).toEqual([item]); expect(useGameStore.getState().equipment[0].equipped).toBe(true);
        expect(useGameStore.getState().pendingChestReveal).toBeNull(); expect(mocks.open).toHaveBeenCalledTimes(1);
    });
});
