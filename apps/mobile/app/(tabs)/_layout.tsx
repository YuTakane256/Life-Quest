import { Tabs } from 'expo-router';
import { Text } from 'react-native';

const tabIcons = { index: '✓', habits: '↻' } as const;

export default function TabLayout() {
    return (
        <Tabs screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: '#43d6a2',
            tabBarInactiveTintColor: '#747d8e',
            tabBarStyle: { backgroundColor: '#151821', borderTopColor: '#303746', height: 64, paddingTop: 7 },
            tabBarLabelStyle: { fontSize: 11, fontWeight: '700', paddingBottom: 7 },
        }}>
            <Tabs.Screen name="index" options={{ title: 'タスク', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>{tabIcons.index}</Text> }} />
            <Tabs.Screen name="habits" options={{ title: '習慣', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>{tabIcons.habits}</Text> }} />
        </Tabs>
    );
}
