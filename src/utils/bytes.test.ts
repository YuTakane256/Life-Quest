import { describe, it, expect } from 'vitest';
import { utf8ByteLength } from './bytes';

describe('utf8ByteLength', () => {
    it('空文字は0バイト', () => expect(utf8ByteLength('')).toBe(0));
    it('ASCIIは1文字1バイト', () => expect(utf8ByteLength('abc')).toBe(3));
    it('日本語は1文字3バイト', () => expect(utf8ByteLength('あ')).toBe(3));
    it('サロゲートペアの絵文字は4バイト', () => expect(utf8ByteLength('😀')).toBe(4));
    it('混在文字列も正しく合算する', () => expect(utf8ByteLength('a あ')).toBe(1 + 1 + 3));
});
