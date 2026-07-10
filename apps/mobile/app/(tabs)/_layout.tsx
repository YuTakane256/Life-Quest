import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Tabs } from 'expo-router';
import { useColorScheme, type ColorValue } from 'react-native';
import { useMobileSettingsStore } from '../../src/stores/useMobileSettingsStore';
import { getMobileThemePalette, resolveMobileThemeMode } from '../../src/theme/colors';

// 絵文字・テキストグリフを廃止し、ベクターアイコンへ統一（#499）
const renderIcon = {
    index: (color: ColorValue) => <Ionicons name="checkmark-circle-outline" size={22} color={color} />,
    habits: (color: ColorValue) => <Ionicons name="repeat" size={22} color={color} />,
    stats: (color: ColorValue) => <Ionicons name="stats-chart" size={20} color={color} />,
    character: (color: ColorValue) => <MaterialCommunityIcons name="sword-cross" size={21} color={color} />,
    map: (color: ColorValue) => <Ionicons name="map-outline" size={21} color={color} />,
} as const;

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
            <Tabs.Screen name="index" options={{ title: 'タスク', tabBarIcon: ({ color }) => renderIcon.index(color) }} />
            <Tabs.Screen name="habits" options={{ title: '習慣', tabBarIcon: ({ color }) => renderIcon.habits(color) }} />
            <Tabs.Screen name="stats" options={{ title: '統計', tabBarIcon: ({ color }) => renderIcon.stats(color) }} />
            <Tabs.Screen name="character" options={{ title: 'キャラクター', tabBarIcon: ({ color }) => renderIcon.character(color) }} />
            <Tabs.Screen name="map" options={{ title: 'マップ', tabBarIcon: ({ color }) => renderIcon.map(color) }} />
        </Tabs>
    );
}
