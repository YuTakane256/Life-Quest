// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const mobile = require('../apps/mobile/package.json');
const root = require('../package.json');
const lock = require('../package-lock.json');
const bundled = require('expo/bundledNativeModules.json');

describe('mobile dependency compatibility', () => {
    it('keeps native SVG pinned to the installed Expo SDK recommendation', () => {
        expect(mobile.dependencies['react-native-svg']).toBe(bundled['react-native-svg']);
        expect(lock.packages['node_modules/react-native-svg'].version)
            .toBe(mobile.dependencies['react-native-svg']);
    });

    it('keeps the mobile lock manifest consistent with package.json', () => {
        expect(lock.packages['apps/mobile'].dependencies).toEqual(mobile.dependencies);
    });

    it('uses the same icon release range on Web and Mobile', () => {
        expect(mobile.dependencies['lucide-react-native']).toBe(root.dependencies['lucide-react']);
    });
});
