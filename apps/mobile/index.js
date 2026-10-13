// Capture isolation must run before any route/store is imported and hydrated.
const Constants = require('expo-constants').default;
const theme = Constants.expoConfig?.extra?.parityCaptureTheme;
const profile = Constants.expoConfig?.extra?.parityCaptureProfile;
if (theme || profile) {
    const { getCaptureTheme, getCaptureProfile, installCaptureRuntime } = require('./src/parity/captureRuntime');
    const context = {
        development: __DEV__,
        variant: Constants.expoConfig?.extra?.appVariant,
        applicationId: require('expo-application').applicationId,
        theme,
        supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
        supabaseKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    };
    const captureTheme = getCaptureTheme(context);
    const captureProfile = getCaptureProfile(context, profile);
    installCaptureRuntime(require('@react-native-async-storage/async-storage').default, captureTheme, captureProfile);
}
require('expo-router/entry');
