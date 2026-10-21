import { act, createElement, StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyLogin, notifyLogout, resetAuthLifecycleHooks } from '@life-quest/core/authLifecycle';
import { PROFILE_CHANGED_MESSAGE } from '@life-quest/core/characterProfile';
import type { ProfileEditorProps } from './ProfileEditor';
import { useGameStore } from '../../stores/useGameStore';
import { useMobileGameStore } from '../../../apps/mobile/src/stores/useMobileGameStore';
import { CharacterPage } from '../../pages/CharacterPage';
const nativeModule = '../../../apps/mobile/src/components/CharacterOverview';
const { CharacterOverview } = await import(nativeModule);
const mocks = vi.hoisted(() => ({ enqueue: vi.fn(async () => true), editor: null as ProfileEditorProps | null,
    blur: new Set<() => void>(), focus: new Set<() => void>(),
}));
vi.mock('../../platform/cloudOutbox', () => ({ enqueueCloudOperation: mocks.enqueue, isWebCloudOutboxActive: () => false }));
vi.mock('../../../apps/mobile/src/platform/cloudOutbox', () => ({ enqueueCloudOperation: mocks.enqueue, isCloudOutboxActive: () => false }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) } }));
vi.mock('./InventorySection', () => ({ InventorySection: () => null }));
vi.mock('../../hooks/useCloudChestOpen', () => ({ useCloudChestOpen: () => ({ openingChestId: null, errorChestId: null, openChest: vi.fn(), retry: vi.fn() }) }));
vi.mock('./ProfileEditor', async (original) => {
    const { ProfileEditor } = await original<typeof import('./ProfileEditor')>();
    return { ProfileEditor: (props: ProfileEditorProps) => { mocks.editor = props; return createElement(ProfileEditor, props); } };
});
vi.mock('../../../apps/mobile/src/components/CharacterProfileEditor', async (original) => {
    const module = await original();
    return { CharacterProfileEditor: (props: ProfileEditorProps) => { mocks.editor = props; return createElement((module as { CharacterProfileEditor: typeof import('./ProfileEditor').ProfileEditor }).CharacterProfileEditor, props); } };
});
vi.mock('../../../apps/mobile/src/assets/images', () => ({ AVATAR_IMAGES: { female: 'female', male: 'male' }, getChestImage: () => null, getItemImage: () => null }));
vi.mock('../../../apps/mobile/src/theme/usePalette', async () => { const { LIGHT_THEME } = await import('@life-quest/core/designTokens'); return { usePalette: () => ({ palette: LIGHT_THEME }) }; });
vi.mock('lucide-react-native', () => import('lucide-react'));
vi.mock('expo-router', () => ({ useFocusEffect: (setup: () => void | (() => void)) => {
    useEffect(() => {
        let cleanup = setup(); const blur = () => { cleanup?.(); cleanup = undefined; }; const focus = () => { cleanup = setup(); };
        mocks.blur.add(blur); mocks.focus.add(focus);
        return () => { cleanup?.(); mocks.blur.delete(blur); mocks.focus.delete(focus); };
    }, [setup]);
} }));
vi.mock('react-native', () => {
    type Props = { children?: ReactNode; accessibilityLabel?: string; accessibilityRole?: string; onPress?: () => void; disabled?: boolean };
    const box = ({ children, accessibilityRole }: Props) => createElement('div', { role: accessibilityRole }, children);
    return { View: box, ScrollView: box, KeyboardAvoidingView: box,
        Modal: ({ children }: Props) => createElement('div', { role: 'dialog' }, children),
        Image: () => null, Text: ({ children }: Props) => createElement('span', null, children),
        Pressable: ({ children, accessibilityLabel, onPress, disabled }: Props) => createElement('button', { 'aria-label': accessibilityLabel, onClick: onPress, disabled }, children),
        TextInput: ({ value, accessibilityLabel, onChangeText }: { value: string; accessibilityLabel?: string; onChangeText: (text: string) => void }) => createElement('input', { value, 'aria-label': accessibilityLabel, onChange: (event) => onChangeText(event.target.value) }),
        Keyboard: { dismiss: vi.fn() }, Platform: { OS: 'ios' }, StyleSheet: { create: <T,>(value: T) => value },
    };
});
let root: Root | null; let host: HTMLDivElement;
const unmount = () => { if (root) act(() => { root!.unmount(); root = null; }); };
beforeEach(async () => {
    resetAuthLifecycleHooks(); await notifyLogin('a'); vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); localStorage.clear(); mocks.editor = null;
    useGameStore.setState({ ...useGameStore.getInitialState(), character: { ...useGameStore.getInitialState().character, name: '編集前', avatar: 'female' } });
    useMobileGameStore.setState({ ...useMobileGameStore.getInitialState(), hasHydrated: true, character: { ...useMobileGameStore.getInitialState().character, name: '編集前', avatar: 'female' } });
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { unmount(); host.remove(); resetAuthLifecycleHooks(); vi.unstubAllGlobals(); });
for (const mobile of [false, true]) describe(`profile edit mobile=${mobile}`, () => {
    const store = () => mobile ? useMobileGameStore.getState() : useGameStore.getState();
    const replace = (updates: Partial<ReturnType<typeof useGameStore.getState>['character']>) => {
        if (mobile) useMobileGameStore.setState({ character: { ...useMobileGameStore.getState().character, ...updates } });
        else useGameStore.setState({ character: { ...useGameStore.getState().character, ...updates } });
    };
    const mount = () => act(() => root!.render(createElement(StrictMode, null, createElement(MemoryRouter, null, mobile ? createElement(CharacterOverview, { openingChestId: null, errorChestId: null, onOpenChest: () => {}, onRetryChest: () => {} }) : createElement(CharacterPage)))));
    const open = () => act(() => host.querySelector<HTMLButtonElement>('[aria-label="プロフィールを編集"]')!.click());
    const editor = () => mocks.editor!;
    it('normal save changes only profile, sends once and ignores the same old callback', () => {
        mount(); open(); act(() => { editor().onNameChange('  保存した名前  '); editor().onAvatarChange('male'); });
        const before = { ...store().character }; const save = editor().onSave; act(() => { save(); save(); });
        expect(store().character).toEqual({ ...before, name: '保存した名前', avatar: 'male' }); expect(mocks.enqueue).toHaveBeenCalledOnce();
        expect(mocks.enqueue).toHaveBeenCalledWith('update_character_profile', { p_name: '保存した名前', p_avatar: 'male', p_base_version: null }); expect(host.querySelector('[role="dialog"]')).toBeNull();
    });
    it.each(['switch', 'logout', 'roundtrip', 'unmount'] as const)('%s invalidates old save and does not send', async (transition) => {
        mount(); open(); act(() => editor().onNameChange('古い入力')); const save = editor().onSave;
        await act(async () => {
            if (transition === 'switch') await notifyLogin('b'); if (transition === 'logout') await notifyLogout();
            if (transition === 'roundtrip') { await notifyLogout(); await notifyLogin('a'); } if (transition === 'unmount') unmount();
            replace({ name: '新アカウント' }); save();
        });
        expect(store().character.name).toBe('新アカウント'); expect(mocks.enqueue).not.toHaveBeenCalled(); expect(host.querySelector('[role="dialog"]')).toBeNull();
    });
    it('rejects save before a switch has committed a new render', async () => {
        mount(); open(); const save = editor().onSave;
        await act(async () => { const transition = notifyLogin('b'); save(); await transition; }); expect(mocks.enqueue).not.toHaveBeenCalled();
    });
    it('closes an anonymous draft on first sign-in', async () => {
        await notifyLogout(); mount(); open(); const save = editor().onSave;
        await act(async () => { await notifyLogin('a'); save(); }); expect(mocks.enqueue).not.toHaveBeenCalled(); expect(host.querySelector('[role="dialog"]')).toBeNull();
    });
    it('preserves equal pull / same-user notification and ignores XP or level changes', async () => {
        mount(); open(); act(() => editor().onNameChange('入力を維持'));
        await act(async () => { await notifyLogin('a'); replace({ totalXp: 500, level: 5 }); });
        expect(editor().name).toBe('入力を維持'); act(editor().onSave); expect(store().character).toMatchObject({ name: '入力を維持', totalXp: 500, level: 5 }); expect(mocks.enqueue).toHaveBeenCalledOnce();
    });
    it.each(['name', 'avatar'] as const)('keeps draft on changed %s and requires reopening', (field) => {
        mount(); open(); act(() => editor().onNameChange('残す下書き'));
        act(() => replace(field === 'name' ? { name: '同期の名前' } : { avatar: 'male' })); const changed = { ...store().character };
        act(editor().onSave); expect(editor().name).toBe('残す下書き'); expect(editor().error).toBe(PROFILE_CHANGED_MESSAGE); expect(store().character).toEqual(changed); expect(mocks.enqueue).not.toHaveBeenCalled();
        act(editor().onClose); open(); expect(editor().name).toBe(changed.name); act(editor().onSave); expect(mocks.enqueue).toHaveBeenCalledOnce();
    });
    it('old input, close and save cannot affect a reopened draft', () => {
        mount(); open(); const old = editor(); act(old.onClose); open(); act(() => editor().onNameChange('新しい入力'));
        act(() => { old.onNameChange('古い入力'); old.onAvatarChange('male'); old.onSave(); old.onClose(); });
        expect(editor().name).toBe('新しい入力'); expect(host.querySelector('[role="dialog"]')).not.toBeNull(); expect(mocks.enqueue).not.toHaveBeenCalled(); act(editor().onSave); expect(store().character.name).toBe('新しい入力');
    });
    if (mobile) {
        it('invalidates draft on blur even if refocused before old save', () => {
            mount(); open(); const save = editor().onSave;
            act(() => { mocks.blur.forEach((fn) => fn()); mocks.focus.forEach((fn) => fn()); save(); });
            expect(mocks.enqueue).not.toHaveBeenCalled(); expect(host.querySelector('[role="dialog"]')).toBeNull(); open(); expect(editor().name).toBe('編集前');
        });
        it('keeps input while hydration is incomplete, then saves normally', () => {
            mount(); open(); act(() => editor().onNameChange('読み込み待ち')); act(() => useMobileGameStore.setState({ hasHydrated: false })); act(editor().onSave);
            expect(editor().name).toBe('読み込み待ち'); expect(mocks.enqueue).not.toHaveBeenCalled(); act(() => useMobileGameStore.setState({ hasHydrated: true })); act(editor().onSave); expect(store().character.name).toBe('読み込み待ち');
        });
    }
});
