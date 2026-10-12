import { Tabs } from 'expo-router';
import { QuestTabBar } from '../../src/components/QuestTabBar';

export default function TabLayout() {
    return (
        <Tabs tabBar={(props) => <QuestTabBar {...props} />} screenOptions={{ headerShown: false }}>
            <Tabs.Screen name="index" options={{ title: 'タスク' }} />
            <Tabs.Screen name="habits" options={{ title: '習慣' }} />
            <Tabs.Screen name="stats" options={{ title: '統計' }} />
            <Tabs.Screen name="character" options={{ title: 'キャラ' }} />
            <Tabs.Screen name="map" options={{ title: 'マップ' }} />
            <Tabs.Screen name="settings" options={{ title: '設定' }} />
        </Tabs>
    );
}
