import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Tabs } from 'expo-router';
import { Pressable, View, type ColorValue } from 'react-native';
import { useMobileGameStore } from '../../src/stores/useMobileGameStore';
import { useMobileTaskStore } from '../../src/stores/useMobileTaskStore';
import { usePalette } from '../../src/theme/usePalette';

// 絵文字・テキストグリフを廃止し、ベクターアイコンへ統一（#499）。
// タブ構成・ラベルはWeb BottomNav（src/components/layout/BottomNav.tsx）と1:1対応させる（#510）。
const renderIcon = {
    index: (color: ColorValue) => <Ionicons name="checkmark-circle-outline" size={22} color={color} />,
    habits: (color: ColorValue) => <Ionicons name="repeat" size={22} color={color} />,
    stats: (color: ColorValue) => <Ionicons name="stats-chart" size={20} color={color} />,
    character: (color: ColorValue) => <MaterialCommunityIcons name="sword-cross" size={21} color={color} />,
    map: (color: ColorValue) => <Ionicons name="map-outline" size={21} color={color} />,
    settings: (color: ColorValue) => <Ionicons name="settings-outline" size={21} color={color} />,
} as const;

export default function TabLayout() {
    const { palette } = usePalette();
    const battleUnlocked = useMobileGameStore((state) => state.battleProgress.battleUnlocked);
    const pendingTaskCount = useMobileTaskStore((state) => state.tasks.filter((task) => !task.completed).length);
    const taskBadge = pendingTaskCount > 0 ? (pendingTaskCount > 99 ? '99+' : String(pendingTaskCount)) : undefined;

    return (
        <Tabs screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: palette.accent.primary,
            tabBarInactiveTintColor: palette.text.muted,
            tabBarStyle: { backgroundColor: palette.bg.secondary, borderTopColor: palette.border.default, height: 64, paddingTop: 7 },
            tabBarLabelStyle: { fontSize: 11, fontWeight: '700', paddingBottom: 7 },
            tabBarBadgeStyle: { backgroundColor: palette.text.danger, fontSize: 9, fontWeight: '800' },
        }}>
            <Tabs.Screen
                name="index"
                options={{
                    title: 'タスク',
                    tabBarIcon: ({ color }) => renderIcon.index(color),
                    tabBarBadge: taskBadge,
                    tabBarAccessibilityLabel: pendingTaskCount > 0 ? `タスク（未完了${pendingTaskCount}件）` : 'タスク',
                }}
            />
            <Tabs.Screen name="habits" options={{ title: '習慣', tabBarIcon: ({ color }) => renderIcon.habits(color) }} />
            <Tabs.Screen name="stats" options={{ title: '統計', tabBarIcon: ({ color }) => renderIcon.stats(color) }} />
            {/* Webのnavラベルは「キャラ」（BottomNav.tsx NAV_ITEMS）。画面内見出しは既存の「キャラクター」を維持する。 */}
            <Tabs.Screen name="character" options={{ title: 'キャラ', tabBarIcon: ({ color }) => renderIcon.character(color) }} />
            <Tabs.Screen
                name="map"
                options={{
                    title: 'マップ',
                    tabBarIcon: ({ color }) => (
                        <View>
                            {renderIcon.map(color)}
                            {!battleUnlocked && (
                                <View style={{ position: 'absolute', bottom: -2, right: -6 }}>
                                    <Ionicons name="lock-closed" size={11} color={palette.text.muted} />
                                </View>
                            )}
                        </View>
                    ),
                    tabBarAccessibilityLabel: battleUnlocked ? 'マップ' : 'マップ（未解放）',
                    // Webのマップタブは未解放時disabledでクリック不可（BottomNav.tsx isLocked）。
                    // Mobileも同じ挙動にし、遷移だけ止める（タブ自体は表示したまま）。
                    tabBarButton: battleUnlocked
                        ? undefined
                        : ({ style, children, accessibilityLabel }) => (
                            <Pressable
                                disabled
                                accessibilityState={{ disabled: true }}
                                accessibilityLabel={accessibilityLabel}
                                style={[style, { opacity: 0.4 }]}
                            >
                                {children}
                            </Pressable>
                        ),
                }}
            />
            <Tabs.Screen name="settings" options={{ title: '設定', tabBarIcon: ({ color }) => renderIcon.settings(color) }} />
        </Tabs>
    );
}
