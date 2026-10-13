import type { ImageSourcePropType } from "react-native";
import enemySlime from '@life-quest/assets/images/enemy_slime.png';
import enemyGoblin from '@life-quest/assets/images/enemy_goblin.png';
import enemyBat from '@life-quest/assets/images/enemy_bat.png';
import enemyRabbit from '@life-quest/assets/images/enemy_rabbit.png';
import enemySnake from '@life-quest/assets/images/enemy_snake.png';
import enemyOrc from '@life-quest/assets/images/enemy_orc.png';
import enemyBoar from '@life-quest/assets/images/enemy_boar.png';
import enemyTreant from '@life-quest/assets/images/enemy_treant.png';
import enemyWolf from '@life-quest/assets/images/enemy_wolf.png';
import enemyMinotaur from '@life-quest/assets/images/enemy_minotaur.png';
import enemySkeleton from '@life-quest/assets/images/enemy_skeleton.png';
import enemyZombie from '@life-quest/assets/images/enemy_zombie.png';
import enemyGhost from '@life-quest/assets/images/enemy_ghost.png';
import enemyGargoyle from '@life-quest/assets/images/enemy_gargoyle.png';
import enemyLivingArmor from '@life-quest/assets/images/enemy_living_armor.png';
import enemyWight from '@life-quest/assets/images/enemy_wight.png';
import enemyGolem from '@life-quest/assets/images/enemy_golem.png';
import enemyVampire from '@life-quest/assets/images/enemy_vampire.png';
import enemyDemon from '@life-quest/assets/images/enemy_demon.png';
import enemyDeathKnight from '@life-quest/assets/images/enemy_death_knight.png';
import enemyCherub from '@life-quest/assets/images/enemy_cherub.png';
import enemyPegasus from '@life-quest/assets/images/enemy_pegasus.png';
import enemyLightElemental from '@life-quest/assets/images/enemy_light_elemental.png';
import enemyAngel from '@life-quest/assets/images/enemy_angel.png';
import enemyValkyrie from '@life-quest/assets/images/enemy_valkyrie.png';
import enemyGriffin from '@life-quest/assets/images/enemy_griffin.png';
import enemySeraph from '@life-quest/assets/images/enemy_seraph.png';
import enemyHolyKnight from '@life-quest/assets/images/enemy_holy_knight.png';
import enemyArchangel from '@life-quest/assets/images/enemy_archangel.png';
import enemyGodOfLight from '@life-quest/assets/images/enemy_god_of_light.png';
import enemyMerman from '@life-quest/assets/images/enemy_merman.png';
import enemySiren from '@life-quest/assets/images/enemy_siren.png';
import enemyWaterElemental from '@life-quest/assets/images/enemy_water_elemental.png';
import enemyKillerShark from '@life-quest/assets/images/enemy_killer_shark.png';
import enemySeaSerpent from '@life-quest/assets/images/enemy_sea_serpent.png';
import enemyKraken from '@life-quest/assets/images/enemy_kraken.png';
import enemyWaterDragon from '@life-quest/assets/images/enemy_water_dragon.png';
import enemyLeviathan from '@life-quest/assets/images/enemy_leviathan.png';


import grassland from "@life-quest/assets/images/bg_grassland.png";
import castle from "@life-quest/assets/images/bg_castle.png";
import heaven from "@life-quest/assets/images/bg_heaven.png";
import deepSea from "@life-quest/assets/images/bg_deep_sea.png";
import battleGrassland from '@life-quest/assets/images/bg_battle_grassland.png';
import battleCastle from '@life-quest/assets/images/bg_battle_castle.png';
import battleHeaven from '@life-quest/assets/images/bg_battle_heaven.png';
import battleDeepSea from '@life-quest/assets/images/bg_battle_deep_sea.png';

// Static imports keep Metro and Web on the same existing shared assets.
export const ENEMY_IMAGES: Record<string, ImageSourcePropType> = {
    slime: enemySlime,
    goblin: enemyGoblin,
    bat: enemyBat,
    rabbit: enemyRabbit,
    snake: enemySnake,
    orc: enemyOrc,
    boar: enemyBoar,
    treant: enemyTreant,
    wolf: enemyWolf,
    minotaur: enemyMinotaur,
    skeleton: enemySkeleton,
    zombie: enemyZombie,
    ghost: enemyGhost,
    gargoyle: enemyGargoyle,
    living_armor: enemyLivingArmor,
    wight: enemyWight,
    golem: enemyGolem,
    vampire: enemyVampire,
    demon: enemyDemon,
    death_knight: enemyDeathKnight,
    cherub: enemyCherub,
    pegasus: enemyPegasus,
    light_elemental: enemyLightElemental,
    angel: enemyAngel,
    valkyrie: enemyValkyrie,
    griffin: enemyGriffin,
    seraph: enemySeraph,
    holy_knight: enemyHolyKnight,
    archangel: enemyArchangel,
    god_of_light: enemyGodOfLight,
    giant_crab: enemyKillerShark,
    sahagin: enemyMerman,
    merman: enemyMerman,
    siren: enemySiren,
    water_elemental: enemyWaterElemental,
    killer_shark: enemyKillerShark,
    sea_serpent: enemySeaSerpent,
    kraken: enemyKraken,
    water_dragon: enemyWaterDragon,
    leviathan: enemyLeviathan,
};


const MAP_IMAGES: Record<string, ImageSourcePropType> = { grassland, castle, heaven, deep_sea: deepSea };
const BATTLE_IMAGES: Record<string, ImageSourcePropType> = {
    grassland: battleGrassland, castle: battleCastle, heaven: battleHeaven, deep_sea: battleDeepSea,
};

export function getBattleImage(theme: string): ImageSourcePropType {
    return BATTLE_IMAGES[theme] ?? battleGrassland;
}

export function getMapImage(theme: string): ImageSourcePropType {
    return MAP_IMAGES[theme] ?? grassland;
}

export function getEnemyImage(key: string): ImageSourcePropType | null {
    return ENEMY_IMAGES[key] ?? null;
}
