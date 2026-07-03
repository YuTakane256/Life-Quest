import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { theme } from '../../src/theme/colors';

const tabIcons = { index: '✓', habits: '↻', stats: '▦', character: '⚔' } as const;

export default function TabLayout() {
    return (
        <Tabs screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: theme.accent.primary,
            tabBarInactiveTintColor: theme.text.muted,
            tabBarStyle: { backgroundColor: theme.bg.secondary, borderTopColor: theme.border.default, height: 64, paddingTop: 7 },
            tabBarLabelStyle: { fontSize: 11, fontWeight: '700', paddingBottom: 7 },
        }}>
            <Tabs.Screen name="index" options={{ title: 'タスク', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>{tabIcons.index}</Text> }} />
            <Tabs.Screen name="habits" options={{ title: '習慣', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>{tabIcons.habits}</Text> }} />
            <Tabs.Screen name="stats" options={{ title: '統計', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>{tabIcons.stats}</Text> }} />
            <Tabs.Screen name="character" options={{ title: 'キャラクター', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>{tabIcons.character}</Text> }} />
        </Tabs>
    );
}
