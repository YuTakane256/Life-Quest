import { useColorScheme } from 'react-native';
import { useMobileSettingsStore } from '../stores/useMobileSettingsStore';
import { getMobileThemePalette, resolveMobileThemeMode, type ResolvedMobileTheme } from './colors';

/** 現在の設定（テーマモード）とOSのカラースキームから、実際に適用するパレットを返す。 */
export function usePalette() {
    const systemScheme = useColorScheme();
    const themeMode = useMobileSettingsStore((state) => state.themeMode);
    const resolvedTheme: ResolvedMobileTheme = resolveMobileThemeMode(themeMode, systemScheme);
    return { palette: getMobileThemePalette(resolvedTheme), resolvedTheme };
}
