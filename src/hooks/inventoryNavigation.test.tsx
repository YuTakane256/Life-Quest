import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useNavigate } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { createEquipmentFromTemplate } from '@life-quest/core/equipment';
import { EQUIPMENT_POOL } from '@life-quest/core/rewards';
import { useGameStore } from '../stores/useGameStore';
import { InventoryPage, InventorySection } from '../components/character/InventorySection';
import App from '../App';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), synth: vi.fn(), apply: vi.fn(), local: vi.fn() }));
vi.mock('../platform/auth', () => ({ getGameAuthState: mocks.auth }));
vi.mock('../platform/gameCloud', () => ({ synthesizeCloudItems: mocks.synth, openCloudChest: vi.fn() }));
vi.mock('../platform/cloudOutbox', () => ({ enqueueCloudOperation: vi.fn(), isWebCloudOutboxActive: () => false }));
vi.mock('../utils/notifications', () => ({ runNotificationChecks: vi.fn(), cancelNotificationChecks: vi.fn() }));
vi.mock('../stores/useLoginBonusStore', () => ({ useLoginBonusStore: { getState: () => ({ checkDailyLogin() {} }) } }));
vi.mock('../pages/CharacterPage', () => ({ InventoryPage, CharacterPage: () => createElement(InventorySection, { visibleLimit: 5, showViewAll: true }) }));
vi.mock('../pages/TasksPage', () => ({ TasksPage: () => createElement('div', {}, 'tasks-route') }));
vi.mock('../components/layout/BottomNav', () => ({ BottomNav: () => {
    const navigate = useNavigate();
    return createElement('nav', {}, ...['tasks', 'character', 'character/inventory'].map((path) => createElement('button',
        { key: path, onClick: () => navigate('/' + path) }, 'go-' + path)));
} }));
vi.mock('../components/ui/ThemeController', () => ({ ThemeController: () => null }));
vi.mock('../components/ui/LevelUpOverlay', () => ({ LevelUpOverlay: () => null }));
vi.mock('../components/ui/LoginBonusOverlay', () => ({ LoginBonusOverlay: () => null }));
vi.mock('../components/ui/ChestOpeningOverlay', () => ({ ChestOpeningOverlay: () => null }));
vi.mock('../components/ui/CompletionRewardNotice', () => ({ CompletionRewardNotice: () => null }));

let root: Root; let host: HTMLDivElement; let mounted: boolean;
const original = { apply: useGameStore.getState().applyCloudSynthesisResult, local: useGameStore.getState().synthesizeItems };
const ids = ['one', 'two', 'three'];
function button(text: string) { return [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!; }
async function click(text: string) { const target = button(text); expect(target).toBeTruthy(); await act(async () => target.click()); }
async function select(actionLabel = '合成する') {
    await click('合成');
    for (const row of host.querySelectorAll<HTMLElement>('[aria-label="木の剣を合成対象に選択"]')) await act(async () => row.click());
    expect(button(actionLabel)).toBeTruthy();
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { resolve, promise }; }
beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); resetAuthLifecycleHooks(); await notifyLogin('a'); localStorage.clear();
    vi.clearAllMocks(); mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'a' });
    mocks.synth.mockResolvedValue({ resultId: 'result', templateId: 'iron_sword' });
    mocks.apply.mockReturnValue(createEquipmentFromTemplate('result', EQUIPMENT_POOL.find((t) => t.id === 'iron_sword')!));
    useGameStore.setState({ equipment: ids.map((id) => createEquipmentFromTemplate(id, EQUIPMENT_POOL.find((t) => t.id === 'wooden_sword')!)),
        applyCloudSynthesisResult: mocks.apply, synthesizeItems: mocks.local });
    history.replaceState({}, '', '/character/inventory');
    host = document.createElement('div'); document.body.append(host); root = createRoot(host); mounted = true;
    await act(async () => root.render(createElement(App)));
});
afterEach(async () => {
    if (mounted) await act(async () => root.unmount()); host.remove(); resetAuthLifecycleHooks(); vi.unstubAllGlobals();
    useGameStore.setState({ applyCloudSynthesisResult: original.apply, synthesizeItems: original.local });
    history.replaceState({}, '', '/');
});

describe('Web app synthesis across actual routes', () => {
    it('retains failed ingredients and key when leaving inventory and returning through the character preview', async () => {
        mocks.synth.mockRejectedValueOnce(new TypeError('response lost'));
        await select(); await click('合成する'); expect(button('再送')).toBeTruthy();
        await click('go-tasks'); expect(host.textContent).toContain('tasks-route'); await click('go-character');
        expect(button('再送')).toBeTruthy(); await click('再送');
        expect(mocks.synth).toHaveBeenCalledTimes(2);
        expect(mocks.synth.mock.calls.map(([items]) => items)).toEqual([ids, ids]);
        expect(mocks.synth.mock.calls[0][1]).toBe(mocks.synth.mock.calls[1][1]);
        expect(mocks.apply).toHaveBeenCalledExactlyOnceWith(ids, 'result', 'iron_sword');
        expect(mocks.local).not.toHaveBeenCalled(); expect(button('再送')).toBeUndefined();
    });
    it('keeps an in-flight operation exclusive after route remount and applies it once', async () => {
        const pending = deferred<unknown>(); mocks.synth.mockReturnValueOnce(pending.promise);
        await select(); await click('合成する');
        await click('go-tasks'); await click('go-character'); await select('合成中…');
        expect(button('合成中…').disabled).toBe(true); await click('合成中…'); expect(mocks.synth).toHaveBeenCalledTimes(1);
        await act(async () => { pending.resolve({ resultId: 'result', templateId: 'iron_sword' }); });
        expect(mocks.apply).toHaveBeenCalledExactlyOnceWith(ids, 'result', 'iron_sword');
        expect(mocks.synth).toHaveBeenCalledTimes(1); expect(mocks.local).not.toHaveBeenCalled();
    });
    it('discards a late A result without ending a new B operation after navigation', async () => {
        const old = deferred<unknown>(); const current = deferred<unknown>();
        mocks.synth.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
        await select(); await click('合成する'); await click('go-tasks');
        await act(async () => { mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'b' }); await notifyLogin('b'); });
        await click('go-character/inventory'); await select(); await click('合成する');
        await act(async () => { old.resolve({ resultId: 'old-a', templateId: 'iron_sword' }); });
        expect(mocks.apply).not.toHaveBeenCalled(); expect(button('合成中…').disabled).toBe(true);
        expect(mocks.synth).toHaveBeenCalledTimes(2); expect(mocks.synth.mock.calls[1][2].expectedUserId).toBe('b');
        await act(async () => { current.resolve({ resultId: 'new-b', templateId: 'iron_sword' }); });
        expect(mocks.apply).toHaveBeenCalledExactlyOnceWith(ids, 'new-b', 'iron_sword');
        expect(mocks.local).not.toHaveBeenCalled(); expect(button('再送')).toBeUndefined();
    });
    it('does not apply an old result after the entire app provider unmounts', async () => {
        const pending = deferred<unknown>(); mocks.synth.mockReturnValueOnce(pending.promise);
        await select(); await click('合成する');
        await act(async () => root.unmount()); mounted = false;
        await act(async () => { pending.resolve({ resultId: 'late', templateId: 'iron_sword' }); });
        expect(mocks.synth).toHaveBeenCalledTimes(1); expect(mocks.synth.mock.calls[0][2].isActive()).toBe(false);
        expect(mocks.apply).not.toHaveBeenCalled(); expect(mocks.local).not.toHaveBeenCalled();
    });
    it('clears retry state on account change while away and binds the next operation to B with a new key', async () => {
        mocks.synth.mockRejectedValueOnce(new TypeError('response lost'));
        await select(); await click('合成する'); await click('go-tasks');
        await act(async () => { await notifyLogout(); mocks.auth.mockResolvedValue({ kind: 'authenticated', userId: 'b' }); await notifyLogin('b'); });
        await click('go-character/inventory'); expect(button('再送')).toBeUndefined();
        await select(); await click('合成する');
        expect(mocks.synth).toHaveBeenCalledTimes(2); expect(mocks.synth.mock.calls[0][1]).not.toBe(mocks.synth.mock.calls[1][1]);
        expect(mocks.synth.mock.calls[1][2].expectedUserId).toBe('b');
        expect(mocks.apply).toHaveBeenCalledTimes(1); expect(mocks.local).not.toHaveBeenCalled();
    });
});
