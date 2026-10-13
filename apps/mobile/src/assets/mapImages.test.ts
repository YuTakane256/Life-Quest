import { describe, expect, it } from 'vitest';
import { ENEMY_IMAGE_KEYS, MAP_CONFIG } from '@life-quest/core/battle';
import { getEnemyImage, getMapImage } from './mapImages';

describe('Mobile map shared assets', () => {
    it('covers every stage, including deep-sea aliases', () => {
        for (const key of Object.values(ENEMY_IMAGE_KEYS)) {
            expect(getEnemyImage(key), key).toBeTruthy();
        }
        expect(getEnemyImage('unknown')).toBeNull();
    });
    it('covers every area with a grassland fallback', () => {
        for (const map of MAP_CONFIG) expect(getMapImage(map.theme)).toBeTruthy();
        expect(getMapImage('unknown')).toEqual(getMapImage('grassland'));
    });
});
