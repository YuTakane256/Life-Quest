/**
 * Mobileのテーマ。Web `src/index.css` と同じ値を持つ core のデザイントークンを
 * 参照する（Webが製品上の正）。画面のStyleSheetはhexを直書きせず必ずここを通す。
 * 現状はダークテーマ固定。ライトテーマ対応時は LIGHT_THEME への切り替えを足す。
 */
import { DARK_THEME, type ThemePalette } from '@life-quest/core/designTokens';

export const theme: ThemePalette = DARK_THEME;
