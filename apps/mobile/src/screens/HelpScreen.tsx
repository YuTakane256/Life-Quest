import { useMemo, useRef, useState } from 'react';
import {
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
    type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { filterHelpSections, HELP_SECTIONS } from '@life-quest/core/help';
import type { ThemePalette } from '@life-quest/core/designTokens';
import { usePalette } from '../theme/usePalette';

export default function HelpScreen() {
    const [searchQuery, setSearchQuery] = useState('');
    const scrollRef = useRef<ScrollView>(null);
    const sectionOffsets = useRef<Record<string, number>>({});

    const { palette } = usePalette();
    const styles = useMemo(() => createStyles(palette), [palette]);

    const filteredSections = useMemo(
        () => filterHelpSections(HELP_SECTIONS, searchQuery),
        [searchQuery]
    );

    const handleSectionLayout = (sectionId: string, event: LayoutChangeEvent) => {
        sectionOffsets.current[sectionId] = event.nativeEvent.layout.y;
    };

    const handleSectionJump = (sectionId: string) => {
        const y = sectionOffsets.current[sectionId];
        if (y === undefined) return;
        scrollRef.current?.scrollTo({ y, animated: true });
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.header}>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="戻る"
                    onPress={() => router.back()}
                    style={({ pressed }) => [styles.backButton, pressed && styles.muted]}
                >
                    <Text style={styles.backSymbol}>‹</Text>
                </Pressable>
                <Text style={styles.title}>使い方</Text>
            </View>

            <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll}>
                <View style={styles.content}>
                    <View style={styles.searchRow}>
                        <TextInput
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            placeholder="キーワードで検索"
                            placeholderTextColor={palette.text.muted}
                            accessibilityLabel="ヘルプをキーワードで検索"
                            style={styles.searchInput}
                        />
                        {searchQuery.length > 0 && (
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="検索をクリア"
                                onPress={() => setSearchQuery('')}
                                hitSlop={8}
                                style={styles.clearButton}
                            >
                                <Text style={styles.clearButtonText}>×</Text>
                            </Pressable>
                        )}
                    </View>

                    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel="ヘルプセクション">
                        <View style={styles.chipRow}>
                            {HELP_SECTIONS.map((section) => (
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
                    </ScrollView>

                    {filteredSections.length === 0 && (
                        <View style={styles.emptyCard}>
                            <Text style={styles.emptyText}>一致する項目がありません</Text>
                        </View>
                    )}

                    <View style={styles.sectionList}>
                        {filteredSections.map((section) => (
                            <View
                                key={section.id}
                                onLayout={(event) => handleSectionLayout(section.id, event)}
                                style={styles.card}
                            >
                                <Text style={styles.sectionTitle}>
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
    backButton: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg.card, borderColor: palette.border.default, borderWidth: 1 },
    backSymbol: { color: palette.text.secondary, fontSize: 22, lineHeight: 22, marginLeft: -2 },
    title: { color: palette.text.primary, fontSize: 22, fontWeight: '800' },
    scroll: { paddingBottom: 32 },
    content: { width: '100%', maxWidth: 640, alignSelf: 'center', paddingHorizontal: 20, gap: 12 },
    searchRow: { position: 'relative', justifyContent: 'center' },
    searchInput: { height: 44, borderRadius: 10, paddingHorizontal: 14, paddingRight: 36, color: palette.text.primary, backgroundColor: palette.bg.card, borderColor: palette.border.default, borderWidth: 1, fontSize: 14 },
    clearButton: { position: 'absolute', right: 8, width: 26, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
    clearButtonText: { color: palette.text.muted, fontSize: 18, lineHeight: 18 },
    chipRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
    chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: 8, backgroundColor: palette.bg.card, borderColor: palette.border.default, borderWidth: 1 },
    chipIcon: { fontSize: 13 },
    chipText: { color: palette.text.secondary, fontSize: 12, fontWeight: '700' },
    emptyCard: { backgroundColor: palette.bg.card, borderColor: palette.border.default, borderWidth: 1, borderRadius: 10, padding: 16 },
    emptyText: { color: palette.text.muted, fontSize: 13 },
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
