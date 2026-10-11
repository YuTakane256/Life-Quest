// Capture isolation must run before any route/store is imported and hydrated.
const Constants = require('expo-constants').default;
const theme = Constants.expoConfig?.extra?.parityCaptureTheme;
if (theme) {
    const { getCaptureTheme, installCaptureRuntime } = require('./src/parity/captureRuntime');
    const captureTheme = getCaptureTheme({
        development: __DEV__,
        variant: Constants.expoConfig?.extra?.appVariant,
        applicationId: require('expo-application').applicationId,
        theme,
        supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
        supabaseKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    });
    installCaptureRuntime(require('@react-native-async-storage/async-storage').default, captureTheme);
}
require('expo-router/entry');
