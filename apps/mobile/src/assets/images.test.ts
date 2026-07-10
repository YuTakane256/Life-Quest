/**
 * #499 画像レジストリの整合テスト。
 * - 装備アイコンのキーが core EQUIPMENT_POOL の全template_idを網羅する
 * - 宝箱画像のキーが全ChestTypeを網羅する
 * - 未知のキーはnullフォールバック（画面側がプレースホルダーを描画する）
 */
import { describe, expect, it } from 'vitest';
import { EQUIPMENT_POOL, GACHA_CONFIG } from '@life-quest/core/rewards';
import { AVATAR_IMAGES, CHEST_IMAGES, getChestImage, getItemImage, ITEM_IMAGES } from './images';

describe('mobile画像レジストリ（#499）', () => {
    it('全装備テンプレートにアイコン画像が割り当てられている', () => {
        for (const template of EQUIPMENT_POOL) {
            expect(getItemImage(template.id), template.id).not.toBeNull();
        }
        expect(Object.keys(ITEM_IMAGES).sort()).toEqual(EQUIPMENT_POOL.map((t) => t.id).sort());
    });

    it('全宝箱タイプに画像が割り当てられている', () => {
        for (const chestType of Object.keys(GACHA_CONFIG.DROP_RATES)) {
            expect(getChestImage(chestType), chestType).not.toBeNull();
        }
        expect(Object.keys(CHEST_IMAGES).sort()).toEqual(Object.keys(GACHA_CONFIG.DROP_RATES).sort());
    });

    it('アバター両方（female/male）の画像がある', () => {
        expect(AVATAR_IMAGES.female).toBeTruthy();
        expect(AVATAR_IMAGES.male).toBeTruthy();
    });

    it('未知のtemplate_id・宝箱タイプはnull（フォールバック表示用）', () => {
        expect(getItemImage('hacked_sword')).toBeNull();
        expect(getChestImage('diamond')).toBeNull();
    });
});
