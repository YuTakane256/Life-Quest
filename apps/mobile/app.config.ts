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
    const scheme = isParity ? PARITY_SCHEME : isPreview ? PREVIEW_SCHEME : RELEASE_SCHEME;

    return {
        ...config,
        plugins: [...(config.plugins ?? []), 'expo-web-browser'],
        name: isParity ? 'Life Quest Parity' : isPreview ? 'Life Quest Preview' : config.name,
        scheme,
        ios: {
            ...config.ios,
            bundleIdentifier: isParity ? PARITY_BUNDLE_ID : isPreview ? PREVIEW_BUNDLE_ID : RELEASE_BUNDLE_ID,
        },
        android: {
            ...config.android,
            package: isParity ? PARITY_ANDROID_PACKAGE : isPreview ? PREVIEW_ANDROID_PACKAGE : RELEASE_ANDROID_PACKAGE,
        },
        extra: {
            ...config.extra,
            appVariant: variant,
        },
    } as ExpoConfig;
};
