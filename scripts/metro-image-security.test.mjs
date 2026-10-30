// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const images = new URL('../packages/assets/images/', import.meta.url);
const files = readdirSync(images).filter((name) => name.endsWith('.png')).sort();
const sample = readFileSync(new URL(files[0], images));
const consumers = [
    { name: 'React Native CLI', packageName: '@react-native/community-cli-plugin' },
    { name: 'Expo CLI', packageName: '@expo/metro' },
];

describe.each(consumers)('$name resolved Metro image parsing', ({ packageName }) => {
    // Exercise the package actually selected for each consumer, including nested copies.
    const consumer = createRequire(require.resolve(`${packageName}/package.json`));
    const { getAssetSize } = consumer('metro/private/Assets');

    it('preserves dimensions for every shipped shared PNG', async () => {
        expect(files.length).toBeGreaterThan(0);
        for (const file of files) {
            const buffer = readFileSync(new URL(file, images));
            const { width, height } = await sharp(buffer).metadata();
            expect(getAssetSize('png', buffer, file), file).toEqual({ width, height });
        }
    });
    it('rejects non-positive image dimensions', () => {
        const invalid = Buffer.from(sample);
        invalid.writeUInt32BE(0, 16);
        invalid.writeUInt32BE(0, 20);
        expect(() => getAssetSize('png', invalid, 'zero-size.png')).toThrow();
    });
    it('preserves the supported-format fallback for an existing PNG with a JPEG extension', () => {
        expect(getAssetSize('jpg', sample, 'mismatched.jpg')).toEqual(getAssetSize('png', sample, 'sample.png'));
    });
    it('rejects truncated input and keeps unsupported formats outside the parser', () => {
        expect(() => getAssetSize('png', sample.subarray(0, 8), 'truncated.png')).toThrow();
        expect(() => getAssetSize('png', Buffer.alloc(0), 'empty.png')).toThrow();
        expect(getAssetSize('heif', Buffer.from('not a supported asset'), 'ignored.heif')).toBeNull();
        expect(getAssetSize('jxl', Buffer.from('not a supported asset'), 'ignored.jxl')).toBeNull();
    });
});
