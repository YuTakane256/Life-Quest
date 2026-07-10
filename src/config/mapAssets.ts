import bgGrassland from '@life-quest/assets/images/bg_grassland.png';
import bgCastle from '@life-quest/assets/images/bg_castle.png';
import bgBattleGrassland from '@life-quest/assets/images/bg_battle_grassland.png';
import bgBattleCastle from '@life-quest/assets/images/bg_battle_castle.png';
import bgHeaven from '@life-quest/assets/images/bg_heaven.png';
import bgBattleHeaven from '@life-quest/assets/images/bg_battle_heaven.png';
import bgDeepSea from '@life-quest/assets/images/bg_deep_sea.png';
import bgBattleDeepSea from '@life-quest/assets/images/bg_battle_deep_sea.png';

const FALLBACK_THEME = 'grassland';

const MAP_BACKGROUNDS: Record<string, string> = {
    grassland: bgGrassland,
    castle: bgCastle,
    heaven: bgHeaven,
    deep_sea: bgDeepSea,
};

const BATTLE_BACKGROUNDS: Record<string, string> = {
    grassland: bgBattleGrassland,
    castle: bgBattleCastle,
    heaven: bgBattleHeaven,
    deep_sea: bgBattleDeepSea,
};

export function getMapBackground(theme: string): string {
    return MAP_BACKGROUNDS[theme] ?? MAP_BACKGROUNDS[FALLBACK_THEME];
}

export function getBattleBackground(theme: string): string {
    return BATTLE_BACKGROUNDS[theme] ?? BATTLE_BACKGROUNDS[FALLBACK_THEME];
}
