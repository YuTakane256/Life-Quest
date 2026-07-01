import { describe, expect, it } from 'vitest';
import { BATTLE_CONFIG, ENEMY_IMAGE_KEYS, MAP_CONFIG } from './gameConfig';
import { ENEMY_IMAGES } from './enemyImages';
import { getBattleBackground, getMapBackground } from './mapAssets';

describe('map and enemy asset coverage', () => {
    it('all configured battle stages resolve to an enemy image', () => {
        for (const stage of BATTLE_CONFIG.STAGES) {
            const imageKey = ENEMY_IMAGE_KEYS[stage.stage];

            expect(imageKey, `stage ${stage.stage} (${stage.name}) has an image key`).toBeTruthy();
            expect(ENEMY_IMAGES[imageKey], `stage ${stage.stage} key "${imageKey}" resolves to an image`).toBeTruthy();
        }
    });

    it('all configured map themes resolve to map and battle backgrounds', () => {
        const mapBackgrounds = new Set<string>();
        const battleBackgrounds = new Set<string>();

        for (const map of MAP_CONFIG) {
            const mapBackground = getMapBackground(map.theme);
            const battleBackground = getBattleBackground(map.theme);
            expect(mapBackground, `${map.name} map background`).toBeTruthy();
            expect(battleBackground, `${map.name} battle background`).toBeTruthy();
            mapBackgrounds.add(mapBackground);
            battleBackgrounds.add(battleBackground);
        }

        expect(mapBackgrounds.size).toBe(MAP_CONFIG.length);
        expect(battleBackgrounds.size).toBe(MAP_CONFIG.length);
    });

    it('unknown themes fall back to grassland backgrounds', () => {
        expect(getMapBackground('unknown-theme')).toBe(getMapBackground('grassland'));
        expect(getBattleBackground('unknown-theme')).toBe(getBattleBackground('grassland'));
    });
});
