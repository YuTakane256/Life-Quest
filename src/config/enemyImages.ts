// ─── 敵キャラ画像インポート ───
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

/** ステージキー → 敵キャラ画像 URL のマッピング */
export const ENEMY_IMAGES: Record<string, string> = {
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

/**
 * 敵キーに対応する画像 URL を返す。未登録キーは null。
 * mapAssets の getMapBackground と同様に、参照側のフォールバック処理を一本化する。
 */
export function getEnemyImageSrc(key: string): string | null {
    return ENEMY_IMAGES[key] ?? null;
}
