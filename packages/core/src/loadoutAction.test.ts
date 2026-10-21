import { describe, expect, it, vi } from 'vitest';
import { captureLoadoutActions, type Equipment } from './equipment.ts';

const items = (): Equipment[] => [0, 1].map((value) => ({ id: `item-${value}`, templateId: 'wooden_sword',
    name: '木の剣', slot: 'weapon', rarity: 'common', attackBonus: value + 1, defenseBonus: 0, hpBonus: 0, equipped: value === 0 }));

describe('rendered loadout actions', () => {
    it('copies once for a group of controls and accepts equal pull data', () => {
        const source = items(); let current = items(); const apply = vi.fn();
        const action = captureLoadoutActions(source, () => current, () => true)(apply);
        source[0].name = 'mutated source'; current = items(); action(); action();
        expect(apply).toHaveBeenCalledOnce();
    });
    it.each(['name', 'templateId', 'slot', 'rarity', 'attackBonus', 'defenseBonus', 'hpBonus', 'equipped', 'id', 'add', 'remove', 'order'] as const)('rejects %s changes', (field) => {
        const source = items(); let current = items(); const apply = vi.fn();
        const action = captureLoadoutActions(source, () => current, () => true)(apply);
        if (field === 'add') current.push({ ...current[0], id: 'new' });
        else if (field === 'remove') current.pop();
        else if (field === 'order') current.reverse();
        else current = current.map((item, index) => index ? item : { ...item, [field]: typeof item[field] === 'number' ? 20 : typeof item[field] === 'boolean' ? false : 'changed' });
        action(); expect(apply).not.toHaveBeenCalled();
    });
    it('rejects inactive scopes and duplicate IDs', () => {
        const source = items(); let active = true; const apply = vi.fn();
        const action = captureLoadoutActions(source, () => source, () => active)(apply);
        active = false; action(); active = true; action(); expect(apply).not.toHaveBeenCalled();
        const duplicate = [source[0], source[0]];
        captureLoadoutActions(duplicate, () => duplicate, () => true)(apply)(); expect(apply).not.toHaveBeenCalled();
    });
    it('another control cannot act on the loadout changed by the first', () => {
        let current = items(); const apply = vi.fn();
        const control = captureLoadoutActions(current, () => current, () => true);
        const first = control(() => { current = current.map((item) => ({ ...item, equipped: !item.equipped })); });
        const second = control(apply); first(); second(); expect(apply).not.toHaveBeenCalled();
    });
});
