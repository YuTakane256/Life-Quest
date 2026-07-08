import { Tabs } from 'expo-router';
import { Text, useColorScheme } from 'react-native';
import { useMobileSettingsStore } from '../../src/stores/useMobileSettingsStore';
import { getMobileThemePalette, resolveMobileThemeMode } from '../../src/theme/colors';

const tabIcons = { index: '✓', habits: '↻', stats: '▦', character: '⚔', map: '◇' } as const;

export default function TabLayout() {
    const systemScheme = useColorScheme();
    const themeMode = useMobileSettingsStore((state) => state.themeMode);
    const palette = getMobileThemePalette(resolveMobileThemeMode(themeMode, systemScheme));

    return (
        <Tabs screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: palette.accent.primary,
            tabBarInactiveTintColor: palette.text.muted,
            tabBarStyle: { backgroundColor: palette.bg.secondary, borderTopColor: palette.border.default, height: 64, paddingTop: 7 },
            tabBarLabelStyle: { fontSize: 11, fontWeight: '700', paddingBottom: 7 },
        }}>
            <Tabs.Screen name="index" options={{ title: 'タスク', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>{tabIcons.index}</Text> }} />
            <Tabs.Screen name="habits" options={{ title: '習慣', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>{tabIcons.habits}</Text> }} />
            <Tabs.Screen name="stats" options={{ title: '統計', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>{tabIcons.stats}</Text> }} />
            <Tabs.Screen name="character" options={{ title: 'キャラクター', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>{tabIcons.character}</Text> }} />
            <Tabs.Screen name="map" options={{ title: 'マップ', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>{tabIcons.map}</Text> }} />
        </Tabs>
    );
}
