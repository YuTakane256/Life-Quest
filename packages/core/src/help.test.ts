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
});
