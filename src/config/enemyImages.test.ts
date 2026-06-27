import { describe, it, expect } from 'vitest';
import { ENEMY_IMAGES, getEnemyImageSrc } from './enemyImages';

describe('getEnemyImageSrc', () => {
    it('登録済みキーは対応する画像URLを返す', () => {
        const key = Object.keys(ENEMY_IMAGES)[0];
        expect(getEnemyImageSrc(key)).toBe(ENEMY_IMAGES[key]);
    });

    it('すべての登録済みキーが値を返す', () => {
        for (const key of Object.keys(ENEMY_IMAGES)) {
            expect(getEnemyImageSrc(key)).toBe(ENEMY_IMAGES[key]);
        }
    });

    it('未登録キーはnullを返す', () => {
        expect(getEnemyImageSrc('__unknown_enemy__')).toBeNull();
    });

    it('空文字はnullを返す', () => {
        expect(getEnemyImageSrc('')).toBeNull();
    });
});
