/**
 * 装備品・宝箱の画像アセットと、レアリティ表示用の定数を一元管理する。
 * CharacterPage と ChestOpeningOverlay など複数箇所から参照される。
 */

import type { Rarity, ChestType } from '../types';

// ─── 装備アイコン import ───
import itemWoodenSword from '@life-quest/assets/images/item_wooden_sword.png';
import itemIronSword from '@life-quest/assets/images/item_iron_sword.png';
import itemSteelBlade from '@life-quest/assets/images/item_steel_blade.png';
import itemMysticStaff from '@life-quest/assets/images/item_mystic_staff.png';
import itemExcalibur from '@life-quest/assets/images/item_excalibur.png';
import itemLeatherArmor from '@life-quest/assets/images/item_leather_armor.png';
import itemChainMail from '@life-quest/assets/images/item_chain_mail.png';
import itemPlateArmor from '@life-quest/assets/images/item_plate_armor.png';
import itemDragonArmor from '@life-quest/assets/images/item_dragon_armor.png';
import itemAegisShield from '@life-quest/assets/images/item_aegis_shield.png';
import itemWoodenRing from '@life-quest/assets/images/item_wooden_ring.png';
import itemSilverRing from '@life-quest/assets/images/item_silver_ring.png';
import itemGoldAmulet from '@life-quest/assets/images/item_gold_amulet.png';
import itemPhoenixRing from '@life-quest/assets/images/item_phoenix_ring.png';
import itemRingOfGod from '@life-quest/assets/images/item_ring_of_god.png';

// ─── 宝箱画像 import ───
import chestGoldImg from '@life-quest/assets/images/chest_gold.png';
import chestWoodImg from '@life-quest/assets/images/chest_wood.png';
import chestSilverImg from '@life-quest/assets/images/chest_silver.png';
import chestBlueImg from '@life-quest/assets/images/chest_blue.png';
import chestRedGoldImg from '@life-quest/assets/images/chest_red_gold.png';
import chestRainbowImg from '@life-quest/assets/images/chest_rainbow.png';

/** EquipmentTemplate.id → 装備画像 */
export const ITEM_IMAGES: Record<string, string> = {
    wooden_sword: itemWoodenSword,
    iron_sword: itemIronSword,
    steel_blade: itemSteelBlade,
    mystic_staff: itemMysticStaff,
    excalibur: itemExcalibur,
    leather_armor: itemLeatherArmor,
    chain_mail: itemChainMail,
    plate_armor: itemPlateArmor,
    dragon_armor: itemDragonArmor,
    aegis_shield: itemAegisShield,
    wooden_ring: itemWoodenRing,
    silver_ring: itemSilverRing,
    gold_amulet: itemGoldAmulet,
    phoenix_ring: itemPhoenixRing,
    ring_of_god: itemRingOfGod,
};

/** ChestType → 宝箱画像 */
export const CHEST_IMAGES: Record<ChestType, string> = {
    wood: chestWoodImg,
    silver: chestSilverImg,
    gold: chestGoldImg,
    blue: chestBlueImg,
    red_gold: chestRedGoldImg,
    rainbow: chestRainbowImg,
};

/** デフォルトの宝箱画像（未知のタイプ用フォールバック） */
export const CHEST_FALLBACK_IMAGE = chestWoodImg;

/** レアリティ → CSS変数の色 */
export const RARITY_COLORS: Record<Rarity, string> = {
    common: 'var(--color-rarity-common)',
    uncommon: 'var(--color-rarity-uncommon)',
    rare: 'var(--color-rarity-rare)',
    epic: 'var(--color-rarity-epic)',
    legendary: 'var(--color-rarity-legendary)',
};

/** レアリティ → 日本語ラベル */
export const RARITY_LABELS: Record<Rarity, string> = {
    common: 'コモン',
    uncommon: 'アンコモン',
    rare: 'レア',
    epic: 'エピック',
    legendary: 'レジェンダリー',
};
