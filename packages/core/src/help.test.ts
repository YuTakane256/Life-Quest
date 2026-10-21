import { describe, expect, it } from 'vitest';
import { filterHelpSections, HELP_SECTIONS, type HelpSection } from './help.ts';

const sections: HelpSection[] = [
    { id: 'a', icon: '📋', title: 'タスク', items: ['優先度で並び替え', 'タグで分類'] },
    { id: 'b', icon: '🔁', title: '習慣', items: ['ストリーク表示', 'お休み設定'] },
];

describe('filterHelpSections', () => {
    it('空クエリは全セクションをそのまま返す', () => {
        expect(filterHelpSections(sections, '')).toEqual(sections);
        expect(filterHelpSections(sections, '   ')).toEqual(sections);
    });

    it('タイトルに一致する場合は全項目を返す', () => {
        const result = filterHelpSections(sections, 'タスク');
        expect(result).toEqual([sections[0]]);
    });

    it('項目に一致する場合はその項目のみ返す', () => {
        const result = filterHelpSections(sections, 'ストリーク');
        expect(result).toEqual([{ ...sections[1], items: ['ストリーク表示'] }]);
    });

    it('該当なしの場合は空配列を返す', () => {
        expect(filterHelpSections(sections, '存在しないキーワード')).toEqual([]);
    });

    it('元配列を変更しない', () => {
        const original = JSON.parse(JSON.stringify(sections));
        filterHelpSections(sections, 'ストリーク');
        expect(sections).toEqual(original);
    });
    it('空白・大文字小文字を正規化して項目を絞る', () => {
        expect(filterHelpSections([{ id: 'xp', icon: '', title: '成長', items: ['XP獲得', '装備'] }], ' xp ')).toEqual([{ id: 'xp', icon: '', title: '成長', items: ['XP獲得'] }]);
    });
});

describe('HELP_SECTIONS', () => {
    it('全セクションが一意なidを持つ', () => {
        const ids = HELP_SECTIONS.map((section) => section.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('各セクションが少なくとも1つの項目を持つ', () => {
        for (const section of HELP_SECTIONS) {
            expect(section.items.length).toBeGreaterThan(0);
        }
    });
    it('通知説明は選択した日本時間と端末の許可に対応する', () => {
        const items = HELP_SECTIONS.find((section) => section.id === 'notifications')!.items;
        expect(items.join('')).toContain('設定した時刻'); expect(items.join('')).toContain('日本時間、初期値20:00'); expect(items.join('')).toContain('ブラウザまたは端末');
        expect(filterHelpSections(HELP_SECTIONS, '20:00').map((section) => section.id)).toEqual(['notifications']);
    });
});
