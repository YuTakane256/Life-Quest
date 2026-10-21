import { useCallback, useMemo, useRef, useState } from 'react';
import {
    Keyboard,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { filterHelpSections, HELP_SECTIONS } from '@life-quest/core/help';
import type { ThemePalette } from '@life-quest/core/designTokens';
import { usePalette } from '../theme/usePalette';
import { useReducedMotion } from '../hooks/useReducedMotion';

export default function HelpScreen() {
    const [searchQuery, setSearchQuery] = useState('');
    const scrollRef = useRef<ScrollView>(null);
    const contentRef = useRef<View>(null);
    const searchRef = useRef<TextInput>(null);
    const sections = useRef(new Map<string, View>());
    const navigation = useRef({ active: false, generation: 0, layout: '' });
    const { width, height, fontScale } = useWindowDimensions();
    const layout = `${width}:${height}:${fontScale}`;
    navigation.current.layout = layout;
    const reducedMotion = useReducedMotion();
    useFocusEffect(useCallback(() => {
        navigation.current.active = true;
        return () => { navigation.current.active = false; navigation.current.generation++; };
    }, []));

    const { palette } = usePalette();
    const styles = useMemo(() => createStyles(palette), [palette]);

    const filteredSections = useMemo(
        () => filterHelpSections(HELP_SECTIONS, searchQuery),
        [searchQuery]
    );

    const handleSectionJump = (sectionId: string) => {
        if (!navigation.current.active || !filteredSections.some((section) => section.id === sectionId)) return;
        const section = sections.current.get(sectionId); const content = contentRef.current;
        if (!section || !content) return;
        const generation = ++navigation.current.generation;
        Keyboard.dismiss();
        // Measure against scroll content, not the nested list's cached local y.
        section.measureLayout(content, (_x, y) => {
            if (!navigation.current.active || navigation.current.generation !== generation || navigation.current.layout !== layout
                || sections.current.get(sectionId) !== section || contentRef.current !== content || !Number.isFinite(y)) return;
            scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: !reducedMotion });
        }, () => {});
    };
    const changeSearch = (value: string) => { navigation.current.generation++; setSearchQuery(value); };
    const clearSearch = () => { changeSearch(''); searchRef.current?.focus(); };

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.header}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="戻る"
                    onPress={() => { Keyboard.dismiss(); if (router.canGoBack()) router.back(); else router.replace('/settings'); }}
                    style={({ pressed }) => [styles.backButton, pressed && styles.muted]}
                >
                    <Text style={styles.backSymbol}>‹</Text>
                </Pressable>
                <Text accessibilityRole="header" style={styles.title}>使い方</Text>
            </View>

            <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets onScrollBeginDrag={() => { navigation.current.generation++; }}>
                <View ref={contentRef} collapsable={false} testID="help-scroll-content" style={styles.content}>
                    <View style={styles.searchRow}>
                        <TextInput
                            ref={searchRef}
                            testID="help-search"
                            value={searchQuery}
                            onChangeText={changeSearch}
                            returnKeyType="search"
                            autoCapitalize="none"
                            autoCorrect={false}
                            onSubmitEditing={() => Keyboard.dismiss()}
                            placeholder="キーワードで検索"
                            placeholderTextColor={palette.text.muted}
                            accessibilityLabel="ヘルプをキーワードで検索"
                            style={styles.searchInput}
                        />
                        {searchQuery.length > 0 && (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="検索をクリア"
                                onPress={clearSearch}
                                style={styles.clearButton}
                            >
                                <Text allowFontScaling={false} style={styles.clearButtonText}>×</Text>
                            </Pressable>
                        )}
                    </View>

                    <Text accessibilityLiveRegion="polite" style={styles.resultCount}>{filteredSections.length}件のヘルプセクション</Text>
                    <View accessibilityLabel="ヘルプセクション">
                        <View style={styles.chipRow}>
                            {filteredSections.map((section) => (
                                <Pressable
                                    key={section.id}
                                    accessibilityRole="button"
                                    accessibilityLabel={`${section.title}へ移動する`}
                                    onPress={() => handleSectionJump(section.id)}
                                    style={({ pressed }) => [styles.chip, pressed && styles.muted]}
                                >
                                    <Text style={styles.chipIcon}>{section.icon}</Text>
                                    <Text style={styles.chipText}>{section.title}</Text>
                                </Pressable>
                            ))}
                        </View>
                    </View>

                    {filteredSections.length === 0 && (
                        <View style={styles.emptyCard}>
                            <Text style={styles.emptyText}>一致する項目がありません</Text>
                            <Pressable accessibilityRole="button" accessibilityLabel="すべての使い方を表示" onPress={clearSearch} style={styles.showAllButton}><Text style={styles.showAllText}>すべての使い方を表示</Text></Pressable>
                        </View>
                    )}

                    <View style={styles.sectionList}>
                        {filteredSections.map((section) => (
                            <View
                                key={section.id}
                                ref={(node) => { if (node) sections.current.set(section.id, node); else sections.current.delete(section.id); }}
                                collapsable={false}
                                testID={`help-section-${section.id}`}
                                style={styles.card}
                            >
                                <Text accessibilityRole="header" accessibilityLabel={section.title} style={styles.sectionTitle}>
                                    <Text style={styles.sectionIcon}>{section.icon}</Text> {section.title}
                                </Text>
                                <View style={styles.itemList}>
                                    {section.items.map((item) => (
                                        <View key={item} style={styles.itemRow}>
                                            <Text style={styles.itemBullet}>・</Text>
                                            <Text style={styles.itemText}>{item}</Text>
                                        </View>
                                    ))}
                                </View>
                            </View>
                        ))}
                    </View>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

function createStyles(palette: ThemePalette) {
    return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.bg.primary },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
    backButton: { minWidth: 44, minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg.card, borderColor: palette.border.default, borderWidth: 1 },
    backSymbol: { color: palette.text.secondary, fontSize: 22 },
    title: { flexShrink: 1, color: palette.text.primary, fontSize: 22, fontWeight: '800' },
    scroll: { paddingBottom: 32 },
    content: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 20, gap: 12 },
    searchRow: { position: 'relative', justifyContent: 'center' },
    searchInput: { minHeight: 44, paddingVertical: 10, borderRadius: 10, paddingHorizontal: 14, paddingRight: 52, color: palette.text.primary, backgroundColor: palette.bg.card, borderColor: palette.border.default, borderWidth: 1, fontSize: 14 },
    clearButton: { position: 'absolute', right: 4, width: 44, height: 44, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
    clearButtonText: { color: palette.text.muted, fontSize: 18, lineHeight: 18 },
    resultCount: { color: palette.text.muted, fontSize: 12 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 2 },
    chip: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, backgroundColor: palette.bg.card, borderColor: palette.border.default, borderWidth: 1 },
    chipIcon: { fontSize: 13 },
    chipText: { flexShrink: 1, color: palette.text.secondary, fontSize: 12, fontWeight: '700' },
    emptyCard: { backgroundColor: palette.bg.card, borderColor: palette.border.default, borderWidth: 1, borderRadius: 10, padding: 16 },
    emptyText: { color: palette.text.muted, fontSize: 13 },
    showAllButton: { minHeight: 44, justifyContent: 'center', marginTop: 8 },
    showAllText: { color: palette.accent.primary, fontSize: 13, textDecorationLine: 'underline' },
    sectionList: { gap: 12 },
    card: { backgroundColor: palette.bg.card, borderColor: palette.border.default, borderWidth: 1, borderRadius: 10, padding: 16, gap: 8 },
    sectionTitle: { color: palette.text.primary, fontSize: 14, fontWeight: '800' },
    sectionIcon: { fontSize: 15 },
    itemList: { gap: 6 },
    itemRow: { flexDirection: 'row', gap: 6 },
    itemBullet: { color: palette.text.muted, fontSize: 12 },
    itemText: { flex: 1, color: palette.text.secondary, fontSize: 12, lineHeight: 18 },
    muted: { opacity: 0.5 },
    });
}
