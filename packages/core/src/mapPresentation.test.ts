import { describe, expect, it } from 'vitest';
import { BATTLE_CONFIG, MAP_CONFIG, getMapForStage, getMapStages, isMapUnlocked } from './battle';

describe('shared map presentation', () => {
    it.each(MAP_CONFIG)('$name unlocks at its previous area boundary, not before', (map) => {
        const boundary = map.stageRange[0] - 1;
        expect(isMapUnlocked(map, boundary, true)).toBe(true);
        expect(isMapUnlocked(map, boundary - 1, true)).toBe(false);
        expect(isMapUnlocked(map, boundary, false)).toBe(false);
        expect(isMapUnlocked(map, NaN, true)).toBe(false);
        expect(isMapUnlocked(map, Infinity, true)).toBe(false);
    });

    it('groups all 40 stages once and selects the correct area at boundaries', () => {
        expect(MAP_CONFIG.flatMap((map) => getMapStages(map))).toEqual(BATTLE_CONFIG.STAGES);
        for (const map of MAP_CONFIG) {
            expect(getMapStages(map)).toHaveLength(10);
            expect(getMapForStage(map.stageRange[0])).toBe(map);
            expect(getMapForStage(map.stageRange[1])).toBe(map);
        }
        expect(getMapForStage(0)).toBe(MAP_CONFIG[0]);
        expect(getMapForStage(41)).toBe(MAP_CONFIG[0]);
    });

    it('does not change stage definitions or progress when browsing', () => {
        const before = JSON.stringify(BATTLE_CONFIG.STAGES);
        MAP_CONFIG.forEach((map) => { getMapStages(map); isMapUnlocked(map, 30, true); });
        expect(JSON.stringify(BATTLE_CONFIG.STAGES)).toBe(before);
    });
});
