import type { ComponentProps } from 'react';
import type { Tabs } from 'expo-router';
import { CheckSquare, Repeat, BarChart3, User, Map, Settings, LockKeyhole } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LAYOUT_TOKENS } from '@life-quest/core/designTokens';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { useMobileTaskStore } from '../stores/useMobileTaskStore';
import { getTabBarHeight, getTaskBadge, shouldNavigateTab } from '../theme/layout';
import { usePalette } from '../theme/usePalette';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];
// Same Lucide glyphs and order as Web BottomNav; no emoji/font glyph substitution.
const ITEMS = {
    index: { label: 'タスク', Icon: CheckSquare },
    habits: { label: '習慣', Icon: Repeat },
    stats: { label: '統計', Icon: BarChart3 },
    character: { label: 'キャラ', Icon: User },
    map: { label: 'マップ', Icon: Map },
    settings: { label: '設定', Icon: Settings },
} as const;
const metrics = LAYOUT_TOKENS.navigation;

export function QuestTabBar({ state, navigation }: TabBarProps) {
    const { palette } = usePalette();
    const insets = useSafeAreaInsets();
    const { width, fontScale } = useWindowDimensions();
    const battleUnlocked = useMobileGameStore((store) => store.battleProgress.battleUnlocked);
    const pendingCount = useMobileTaskStore((store) => store.tasks.filter((task) => !task.completed).length);
    const height = getTabBarHeight(width - insets.left - insets.right, fontScale);

    return (
        <View style={{ backgroundColor: palette.bg.secondary, borderTopColor: palette.border.default, borderTopWidth: 1, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }}>
            <View style={[styles.row, { height }]}>
                {state.routes.map((route, index) => {
                    const item = ITEMS[route.name as keyof typeof ITEMS];
                    if (!item) return null;
                    const focused = state.index === index;
                    const locked = route.name === 'map' && !battleUnlocked;
                    const color = focused ? palette.accent.primary : palette.text.muted;
                    const badge = route.name === 'index' ? getTaskBadge(pendingCount) : undefined;
                    return (
                        <Pressable
                            key={route.key}
                            accessibilityRole="tab"
                            accessibilityLabel={locked ? `${item.label}（未解放）` : item.label}
                            accessibilityHint={badge ? `未完了タスク${pendingCount}件` : undefined}
                            accessibilityState={{ selected: focused, disabled: locked }}
                            disabled={locked}
                            onPress={() => {
                                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                                if (shouldNavigateTab(locked, focused, event.defaultPrevented)) navigation.navigate(route.name, route.params);
                            }}
                            onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
                            style={[styles.item, { opacity: locked ? 0.4 : 1 }]}
                        >
                            {focused && <View style={[styles.indicator, { backgroundColor: palette.accent.primary }]} />}
                            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ transform: [{ scale: focused ? metrics.activeScale : 1 }] }}>
                                <item.Icon size={metrics.iconSize} color={color} />
                                {badge && <View style={[styles.badge, { backgroundColor: palette.text.danger }]}><Text allowFontScaling={false} style={styles.badgeText}>{badge}</Text></View>}
                            </View>
                            <Text style={[styles.label, { color }]}>{item.label}</Text>
                            {locked && <LockKeyhole accessible={false} size={metrics.lockSize} color={color} style={styles.lock} />}
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: metrics.horizontal, width: '100%', maxWidth: LAYOUT_TOKENS.page.maxWidth, alignSelf: 'center' },
    item: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 8, gap: metrics.gap },
    label: { fontSize: metrics.labelSize, lineHeight: metrics.labelLineHeight, fontWeight: '500', textAlign: 'center' },
    indicator: { position: 'absolute', top: -2, width: metrics.indicatorWidth, height: metrics.indicatorHeight, borderRadius: 1 },
    badge: { position: 'absolute', top: -4, right: -8, minWidth: metrics.badgeSize, height: metrics.badgeSize, paddingHorizontal: 4, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
    badgeText: { color: 'white', fontSize: metrics.badgeFontSize, fontWeight: '700' },
    lock: { position: 'absolute', right: 8, top: 7 },
});
