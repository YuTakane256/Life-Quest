import type { ConfigContext, ExpoConfig } from 'expo/config';

const RELEASE_BUNDLE_ID = 'com.yutakane.lifequest';
const PARITY_BUNDLE_ID = 'com.yutakane.lifequest.parity';

/**
 * Keep the normal app identity as the default. Screenshot captures explicitly
 * select the isolated parity app so Maestro can safely clear only its state.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
    const bundleIdentifier = process.env.LIFE_QUEST_APP_VARIANT === 'parity'
        ? PARITY_BUNDLE_ID
        : RELEASE_BUNDLE_ID;

    return {
        ...config,
        plugins: [...(config.plugins ?? []), 'expo-web-browser'],
        ios: {
            ...config.ios,
            bundleIdentifier,
        },
    } as ExpoConfig;
};
