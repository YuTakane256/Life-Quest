/**
 * インベントリ装備行（`EquipmentRow`）のARIA属性算出。
 *
 * モードによって行の意味が変わるため、role/aria-*もモード別に出し分ける
 * 必要がある: normalは内側に実`<button>`（装備ボタン）を持つため、外側行
 * には何も付けない（対話要素のネストを避ける）。sellは行全体クリックで
 * 即座に売却する一回性アクションなのでrole="button"。synthesizeは複数選択
 * のトグルで、視覚表現もチェックボックス風（チェックマーク付きの枠）なので
 * role="checkbox"（PR #599のトグルボタン群がaria-pressedを採用したのとは
 * 意味が異なる — あちらは「押し込み状態を持つアクション」、こちらは
 * 「選択肢集合からの複数選択」）。
 *
 * `InventoryMode`が将来増えた場合にこの分岐が更新漏れにならないよう、
 * switch文のdefaultでnever型チェックを行う。新しいモードを追加する際は
 * 必ずここのARIA契約を見直すこと。
 */
export type InventoryMode = 'normal' | 'sell' | 'synthesize';

export interface EquipmentRowA11yInput {
    mode: InventoryMode;
    itemName: string;
    isSelected: boolean;
    isSynthDisabled: boolean;
    sellXp: number;
}

export interface EquipmentRowA11yProps {
    role?: 'button' | 'checkbox';
    tabIndex?: number;
    'aria-label'?: string;
    'aria-checked'?: boolean;
    'aria-disabled'?: boolean;
}

export function getEquipmentRowA11y(input: EquipmentRowA11yInput): EquipmentRowA11yProps {
    switch (input.mode) {
        case 'normal':
            return {};
        case 'sell':
            return {
                role: 'button',
                tabIndex: 0,
                'aria-label': `${input.itemName}を売却して+${input.sellXp}XP獲得`,
            };
        case 'synthesize':
            return {
                role: 'checkbox',
                tabIndex: input.isSynthDisabled ? -1 : 0,
                'aria-checked': input.isSelected,
                'aria-disabled': input.isSynthDisabled,
                'aria-label': `${input.itemName}を合成対象に${input.isSelected ? '選択中' : '選択'}`,
            };
        default: {
            const exhaustiveCheck: never = input.mode;
            return exhaustiveCheck;
        }
    }
}
