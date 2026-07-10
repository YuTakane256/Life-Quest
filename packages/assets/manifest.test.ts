// @vitest-environment node
/**
 * マニフェストと実ファイルの整合検証（#498の受け入れ条件）。
 * - マニフェストの全キーに対応するPNGが実在する
 * - images/ 配下の全PNGがマニフェストに登録されている（登録漏れ検出）
 * - 最適化後の合計サイズが目標15MB以下に収まっている
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IMAGE_KEYS, IMAGE_MANIFEST } from './manifest';

const packageRoot = fileURLToPath(new URL('.', import.meta.url));
const imagesDir = join(packageRoot, 'images');

describe('IMAGE_MANIFEST', () => {
    it('全キーに対応するファイルが実在する', () => {
        for (const key of IMAGE_KEYS) {
            const filePath = join(packageRoot, IMAGE_MANIFEST[key]);
            expect(() => statSync(filePath), `${key} -> ${IMAGE_MANIFEST[key]}`).not.toThrow();
        }
    });

    it('images/配下の全PNGがマニフェストに登録されている', () => {
        const files = readdirSync(imagesDir).filter((file) => file.endsWith('.png')).sort();
        const manifestFiles = IMAGE_KEYS.map((key) => IMAGE_MANIFEST[key].replace('images/', '')).sort();
        expect(manifestFiles).toEqual(files);
    });

    it('キーはファイル名から拡張子を除いたものと一致する', () => {
        for (const key of IMAGE_KEYS) {
            expect(IMAGE_MANIFEST[key]).toBe(`images/${key}.png`);
        }
    });

    it('最適化後の合計サイズが15MB以下（#498の受け入れ条件）', () => {
        const total = readdirSync(imagesDir)
            .filter((file) => file.endsWith('.png'))
            .reduce((sum, file) => sum + statSync(join(imagesDir, file)).size, 0);
        expect(total).toBeLessThanOrEqual(15 * 1024 * 1024);
    });
});
