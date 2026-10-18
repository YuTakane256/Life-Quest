import { describe, expect, it, vi } from 'vitest';
import { createEquipmentFromTemplate, type Equipment } from './equipment.ts';
import { EQUIPMENT_POOL } from './rewards.ts';
import { createInventoryConfirmation } from './inventory.ts';

const item = (): Equipment => createEquipmentFromTemplate('item', EQUIPMENT_POOL[0]);
describe('approved inventory confirmation', () => {
    it('同値のpull clone/無関係な追加は許可し、確認は1回だけ消費する', () => {
        const approved = item(); let inventory = [approved]; const commit = vi.fn();
        const confirm = createInventoryConfirmation([approved], () => inventory, () => true, commit);
        inventory = [{ ...approved }, { ...approved, id: 'other' }];
        confirm(); confirm(); expect(commit).toHaveBeenCalledOnce();
    });
    it.each(Object.keys(item()) as (keyof Equipment)[])('確認後の%s変更・同ID置換は承認しない', (key) => {
        const approved = item(); const commit = vi.fn();
        const changed = { ...approved, [key]: key === 'equipped' ? true : 'different' } as Equipment;
        createInventoryConfirmation([approved], () => [changed], () => true, commit)();
        expect(commit).not.toHaveBeenCalled();
    });
    it('元オブジェクトのin-place変更も承認内容に混ぜない', () => {
        const approved = item(); const commit = vi.fn();
        const confirm = createInventoryConfirmation([approved], () => [approved], () => true, commit);
        approved.name = 'changed'; confirm(); expect(commit).not.toHaveBeenCalled();
    });
    it.each(['missing', 'equipped', 'scope', 'empty', 'duplicate'])('%sなら何も消費しない', (reason) => {
        const approved = item(); const commit = vi.fn();
        const items = reason === 'empty' ? [] : reason === 'duplicate' ? [approved, approved] : [approved];
        createInventoryConfirmation(items, () => reason === 'missing' ? [] : [{ ...approved, equipped: reason === 'equipped' }],
            () => reason !== 'scope', commit)();
        expect(commit).not.toHaveBeenCalled();
    });
});
