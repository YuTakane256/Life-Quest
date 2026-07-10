#!/usr/bin/env node
/**
 * 共有画像アセットの最適化（#498）。
 * packages/assets/images/ の PNG をパレット量子化（sharp）で再圧縮し、上書きする。
 * 生成AI由来の未圧縮PNG（約59MB）をモバイル配布に耐えるサイズ（目標15MB以下）へ落とす。
 * 冪等: 最適化済みの画像に再実行してもサイズはほぼ変わらない。
 *
 * 使い方: node scripts/optimize-images.mjs
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const IMAGES_DIR = new URL('../packages/assets/images/', import.meta.url).pathname;
const QUALITY = 80;

const files = (await readdir(IMAGES_DIR)).filter((file) => file.endsWith('.png')).sort();
let beforeTotal = 0;
let afterTotal = 0;

for (const file of files) {
    const filePath = path.join(IMAGES_DIR, file);
    const before = (await stat(filePath)).size;
    const optimized = await sharp(await readFile(filePath))
        .png({ palette: true, quality: QUALITY, compressionLevel: 9 })
        .toBuffer();
    // 最適化で大きくなる場合（既に十分小さい等）は元を維持する
    const output = optimized.length < before ? optimized : await readFile(filePath);
    await writeFile(filePath, output);
    beforeTotal += before;
    afterTotal += output.length;
}

const toMb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
console.log(`optimized ${files.length} images: ${toMb(beforeTotal)}MB -> ${toMb(afterTotal)}MB`);
if (afterTotal > 15 * 1024 * 1024) {
    console.error('WARNING: total exceeds 15MB target');
    process.exit(1);
}
