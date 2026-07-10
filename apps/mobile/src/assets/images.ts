/**
 * Mobileの共有画像レジストリ（#499）。
 *
 * @life-quest/assets の画像をMetroの静的importで束ね、キーで引けるようにする。
 * キーは packages/assets/manifest.ts と同一（Webと同じ画像を同じキーで参照する）。
 * 未知のキー・template_id は null を返し、呼び出し側がプレースホルダーを出す。
 *
 * ここではキャラクター画面・宝箱・装備アイコンに必要な分だけを束ねる
 * （マップ・バトル画面の敵/背景画像は#509系で拡張する）。
 */
import type { ImageSourcePropType } from 'react-native';
import heroImg from '@life-quest/assets/images/hero.png';
import heroMaleImg from '@life-quest/assets/images/hero_male.png';
import chestBlue from '@life-quest/assets/images/chest_blue.png';
import chestWood from '@life-quest/assets/images/chest_wood.png';
import chestSilver from '@life-quest/assets/images/chest_silver.png';
import chestGold from '@life-quest/assets/images/chest_gold.png';
import chestRedGold from '@life-quest/assets/images/chest_red_gold.png';
import chestRainbow from '@life-quest/assets/images/chest_rainbow.png';
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

/** アバターID → キャラクター画像（Web CharacterPage と同一の対応） */
export const AVATAR_IMAGES: Record<'female' | 'male', ImageSourcePropType> = {
    female: heroImg,
    male: heroMaleImg,
};

/** ChestType → 宝箱画像 */
export const CHEST_IMAGES: Record<string, ImageSourcePropType> = {
    blue: chestBlue,
    wood: chestWood,
    silver: chestSilver,
    gold: chestGold,
    red_gold: chestRedGold,
    rainbow: chestRainbow,
};

/** EquipmentTemplate.id → 装備画像（Web equipmentAssets.ts ITEM_IMAGES と同一キー） */
export const ITEM_IMAGES: Record<string, ImageSourcePropType> = {
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

/** 装備テンプレートIDに対応する画像。未知のIDは null（呼び出し側でフォールバック）。 */
export function getItemImage(templateId: string): ImageSourcePropType | null {
    return ITEM_IMAGES[templateId] ?? null;
}

/** 宝箱タイプに対応する画像。未知のタイプは null。 */
export function getChestImage(chestType: string): ImageSourcePropType | null {
    return CHEST_IMAGES[chestType] ?? null;
}
