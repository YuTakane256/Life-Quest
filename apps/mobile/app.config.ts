import type { ConfigContext, ExpoConfig } from 'expo/config';

const RELEASE_BUNDLE_ID = 'com.yutakane.lifequest';
const PARITY_BUNDLE_ID = 'com.yutakane.lifequest.parity';
const PREVIEW_BUNDLE_ID = 'com.yutakane.lifequest.preview';
const RELEASE_ANDROID_PACKAGE = 'com.yutakane.lifequest';
const PARITY_ANDROID_PACKAGE = 'com.yutakane.lifequest.parity';
const PREVIEW_ANDROID_PACKAGE = 'com.yutakane.lifequest.preview';
const RELEASE_SCHEME = 'lifequest';
const PARITY_SCHEME = 'lifequest-parity';
const PREVIEW_SCHEME = 'lifequest-preview';

type AppVariant = 'release' | 'parity' | 'preview';

function readAppVariant(): AppVariant {
    const variant = process.env.LIFE_QUEST_APP_VARIANT ?? 'release';
    if (variant === 'release' || variant === 'parity' || variant === 'preview') return variant;
    throw new Error('LIFE_QUEST_APP_VARIANT must be "release", "parity", or "preview".');
}

/**
 * Keep the normal app identity as the default. Screenshot captures explicitly
 * select the isolated parity app so Maestro can safely clear only its state.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
    const variant = readAppVariant();
    const isParity = variant === 'parity';
    const isPreview = variant === 'preview';
    const captureTheme = process.env.LIFE_QUEST_PARITY_CAPTURE;
    if (captureTheme && (!isParity || !['light', 'dark'].includes(captureTheme))) {
        throw new Error('LIFE_QUEST_PARITY_CAPTURE must be light/dark and requires LIFE_QUEST_APP_VARIANT=parity.');
    }
    const scheme = isParity ? PARITY_SCHEME : isPreview ? PREVIEW_SCHEME : RELEASE_SCHEME;

    return {
        ...config,
        // Mods run in reverse registration order: parity cleanup must be
        // registered before Apple authentication so it removes stale native
        // entitlements after that plugin has run, without a destructive clean.
        plugins: [
            ...(isParity ? ['./plugins/with-parity-ios.cjs'] : []),
            ...(config.plugins ?? []),
            'expo-web-browser',
            'expo-apple-authentication',
            ...(isParity ? [['expo-build-properties', { ios: { enableSceneSupport: true } }]] : []),
        ],
        name: isParity ? 'Life Quest Parity' : isPreview ? 'Life Quest Preview' : config.name,
        scheme,
        ios: {
            ...config.ios,
            bundleIdentifier: isParity ? PARITY_BUNDLE_ID : isPreview ? PREVIEW_BUNDLE_ID : RELEASE_BUNDLE_ID,
            usesAppleSignIn: !isParity,
        },
        android: {
            ...config.android,
            package: isParity ? PARITY_ANDROID_PACKAGE : isPreview ? PREVIEW_ANDROID_PACKAGE : RELEASE_ANDROID_PACKAGE,
        },
        extra: {
            ...config.extra,
            appVariant: variant,
            parityCaptureTheme: captureTheme || undefined,
        },
    } as ExpoConfig;
};
