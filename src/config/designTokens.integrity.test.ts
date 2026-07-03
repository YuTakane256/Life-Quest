/**
 * Web `src/index.css` のCSS変数と core のデザイントークンが一致することを検証する。
 * どちらか一方だけを変更するとこのテストが失敗し、WebとMobileの配色乖離を防ぐ。
 */
import { describe, expect, it } from 'vitest';
import { DARK_THEME, LIGHT_THEME, FONT_SANS, themeToCssVariables } from '@life-quest/core/designTokens';

// vitestは `.css?raw` importを空文字へ変換し、webのtsconfigはNode型定義を含まない。
// モジュール名を変数へ逃がした動的importでnode:fsを読み、CSSの原文を取得する。
const fsModuleName = 'node:fs';
const { readFileSync } = await import(fsModuleName) as {
    readFileSync: (path: string, encoding: 'utf8') => string;
};
// vitestはリポジトリルートをcwdとして実行される
const css = readFileSync('src/index.css', 'utf8');

/** セレクタ以降の最初のブロックからCSS変数を抽出する */
function extractVariables(selector: string): Record<string, string> {
    const start = css.indexOf(selector);
    if (start < 0) throw new Error(`selector not found: ${selector}`);
    const open = css.indexOf('{', start);
    const close = css.indexOf('}', open);
    const block = css.slice(open + 1, close);

    const variables: Record<string, string> = {};
    for (const match of block.matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g)) {
        variables[match[1]] = match[2].trim();
    }
    return variables;
}

function colorVariables(variables: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
        Object.entries(variables).filter(([name]) => name.startsWith('--color-') && name !== '--color-scheme')
    );
}

describe('designTokens integrity', () => {
    it('ダークテーマのCSS変数がcoreトークンと完全に一致する', () => {
        const cssVars = colorVariables(extractVariables(":root[data-theme='dark']"));
        expect(cssVars).toEqual(themeToCssVariables(DARK_THEME));
    });

    it('ライトテーマのCSS変数がcoreトークンと完全に一致する', () => {
        const cssVars = colorVariables(extractVariables(":root[data-theme='light']"));
        expect(cssVars).toEqual(themeToCssVariables(LIGHT_THEME));
    });

    it('@themeブロック（Tailwind）のCSS変数もダークテーマと一致する', () => {
        const themeBlock = extractVariables('@theme');
        const cssVars = colorVariables(themeBlock);
        expect(cssVars).toEqual(themeToCssVariables(DARK_THEME));
        expect(themeBlock['--font-sans']).toBe(FONT_SANS);
    });
});
