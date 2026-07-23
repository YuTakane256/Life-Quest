import { describe, expect, it } from 'vitest';
import { getEquipmentRowA11y } from './equipmentRowA11y';

describe('getEquipmentRowA11y', () => {
    it('normalモードは非対話（roleを付けない、内側の実buttonとのネストを避ける）', () => {
        expect(getEquipmentRowA11y({ mode: 'normal', itemName: '木の剣', isSelected: false, isSynthDisabled: false, sellXp: 5 }))
            .toEqual({});
    });

    it('sellモードはrole="button"＋具体的なaria-labelを持つ（一回性アクション）', () => {
        expect(getEquipmentRowA11y({ mode: 'sell', itemName: '木の剣', isSelected: false, isSynthDisabled: false, sellXp: 5 }))
            .toEqual({ role: 'button', tabIndex: 0, 'aria-label': '木の剣を売却して+5XP獲得' });
    });

    it('synthesizeモード・未選択・有効時はrole="checkbox"でaria-checked=false、tabIndex=0', () => {
        expect(getEquipmentRowA11y({ mode: 'synthesize', itemName: '鉄の剣', isSelected: false, isSynthDisabled: false, sellXp: 10 }))
            .toEqual({ role: 'checkbox', tabIndex: 0, 'aria-checked': false, 'aria-disabled': false, 'aria-label': '鉄の剣を合成対象に選択' });
    });

    it('synthesizeモード・選択済みはaria-checked=true、ラベルが「選択中」になる', () => {
        expect(getEquipmentRowA11y({ mode: 'synthesize', itemName: '鉄の剣', isSelected: true, isSynthDisabled: false, sellXp: 10 }))
            .toEqual({ role: 'checkbox', tabIndex: 0, 'aria-checked': true, 'aria-disabled': false, 'aria-label': '鉄の剣を合成対象に選択中' });
    });

    it('synthesizeモード・無効時はtabIndex=-1・aria-disabled=trueになる（フォーカス順から除外）', () => {
        expect(getEquipmentRowA11y({ mode: 'synthesize', itemName: '伝説の剣', isSelected: false, isSynthDisabled: true, sellXp: 50 }))
            .toEqual({ role: 'checkbox', tabIndex: -1, 'aria-checked': false, 'aria-disabled': true, 'aria-label': '伝説の剣を合成対象に選択' });
    });

    it('synthesizeモードで選択済みのアイテムは無効化されない仕様（isSynthDisabled=falseのまま渡される）', () => {
        // isSynthDisabledの計算自体はEquipmentRow側の責務（選択済みは常にfalseで渡す）だが、
        // ヘルパーはisSelected=true・isSynthDisabled=falseの組み合わせを正しく扱えることを確認する
        const result = getEquipmentRowA11y({ mode: 'synthesize', itemName: '鉄の剣', isSelected: true, isSynthDisabled: false, sellXp: 10 });
        expect(result['aria-disabled']).toBe(false);
        expect(result.tabIndex).toBe(0);
    });
});
