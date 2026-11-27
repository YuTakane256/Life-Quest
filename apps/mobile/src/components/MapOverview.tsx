import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Swords } from 'lucide-react-native';
import { ENEMY_IMAGE_KEYS, MAP_CONFIG, isMapUnlocked, type MapDefinition, type StageDefinition } from '@life-quest/core/battle';
import type { ThemePalette } from '@life-quest/core/designTokens';
import { getEnemyImage } from '../assets/mapImages';
import { usePalette } from '../theme/usePalette';
import { PAGE_HEADING } from '../theme/layout';

export function MapOverview({ selectedMap, maxClearedStage, battleUnlocked, areaColumns, onSelect }: {
    selectedMap: MapDefinition;
    maxClearedStage: number;
    battleUnlocked: boolean;
    areaColumns: 1 | 2 | 4;
    onSelect: (id: number) => void;
}) {
    const { palette: p } = usePalette();
    const s = createStyles(p);
    return (
        <View>
            <Text style={s.title} accessibilityRole="header">マップ</Text>
            <Text style={s.progress}>最高到達: ステージ {maxClearedStage || '-'}</Text>
            <View style={[s.areaRow, areaColumns === 2 && s.areaWrap, areaColumns === 1 && s.areaColumn]}>
                {MAP_CONFIG.map((map) => {
                    const locked = !isMapUnlocked(map, maxClearedStage, battleUnlocked);
                    const selected = selectedMap.id === map.id;
                    return (
                        <Pressable key={map.id} accessibilityRole="button"
                            accessibilityLabel={locked ? `${map.name}（未開放）` : map.name}
                            accessibilityState={{ selected, disabled: locked }} disabled={locked}
                            onPress={() => onSelect(map.id)}
                            style={[s.area, areaColumns === 2 && s.areaHalf, areaColumns === 1 && s.areaFull,
                                areaColumns !== 4 && s.compactArea, selected && s.areaSelected, locked && s.lockedArea]}>
                            {locked && areaColumns !== 4 && (
                                <Text style={s.areaLock} allowFontScaling={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">🔒</Text>
                            )}
                            <Text style={[s.areaLabel, selected && s.white, locked && s.mutedText]}>
                                {locked && areaColumns === 4 ? '🔒 ' : ''}{map.name}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

export function MapStageCard({ stage, currentStage, maxClearedStage, battleUnlocked, busy, stacked, onStart }: {
    stage: StageDefinition;
    currentStage: number;
    maxClearedStage: number;
    battleUnlocked: boolean;
    busy: boolean;
    stacked: boolean;
    onStart: () => void;
}) {
    const { palette: p } = usePalette();
    const s = createStyles(p);
    const cleared = stage.stage <= maxClearedStage;
    const current = stage.stage === currentStage;
    const locked = !battleUnlocked || stage.stage > maxClearedStage + 1;
    const enemy = getEnemyImage(ENEMY_IMAGE_KEYS[stage.stage]);
    return (
        <View style={[s.card, stacked && s.stackedCard, cleared && s.cleared, current && s.current, locked && s.lockedStage]}>
            <View style={[s.stageHeader, !stacked && s.stageHeaderInRow]}>
                <View style={[s.enemy, cleared && { backgroundColor: p.accent.emerald }, !cleared && current && { backgroundColor: p.accent.primary }]}
                    accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    {cleared || locked ? <Text style={s.emoji} allowFontScaling={false}>{cleared ? '✅' : '🔒'}</Text>
                        : enemy ? <Image source={enemy} style={s.enemyImage} resizeMode="contain" /> : <Text style={s.emoji} allowFontScaling={false}>❓</Text>}
                </View>
                <View style={s.description}>
                    <Text style={s.stageTitle}>ステージ {stage.stage}: {stage.name}</Text>
                    <Text style={s.stats}>HP: {stage.hp} · 攻: {stage.attack} · 防: {stage.defense}</Text>
                </View>
            </View>
            {!locked && (
                <Pressable accessibilityRole="button" accessibilityLabel={`ステージ ${stage.stage} ${cleared ? '再挑戦' : 'スタート'}`}
                    accessibilityState={{ disabled: busy }} disabled={busy} onPress={onStart}
                    style={({ pressed }) => [s.start, cleared && s.restart, (pressed || busy) && s.lockedArea]}>
                    <Swords size={14} color={cleared ? p.text.secondary : '#fff'} />
                    <Text style={[s.startLabel, cleared && { color: p.text.secondary }]}>{cleared ? '再挑戦' : 'スタート'}</Text>
                </Pressable>
            )}
        </View>
    );
}

function createStyles(p: ThemePalette) {
    return StyleSheet.create({
        title: { ...PAGE_HEADING, color: p.text.primary, marginBottom: 4 },
        progress: { color: p.text.muted, fontSize: 16, lineHeight: 24, marginBottom: 16 },
        areaRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
        areaWrap: { flexWrap: 'wrap' },
        areaColumn: { flexDirection: 'column' },
        area: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: p.border.default, backgroundColor: p.bg.card, paddingVertical: 8, paddingHorizontal: 2, justifyContent: 'center' },
        areaHalf: { flexBasis: '48%' },
        areaFull: { flex: 0 },
        compactArea: { alignItems: 'center', gap: 3, paddingHorizontal: 4 },
        areaLock: { fontSize: 14 },
        areaSelected: { backgroundColor: p.accent.primary, borderColor: p.accent.primary },
        areaLabel: { color: p.text.secondary, fontSize: 14, fontWeight: '500', lineHeight: 20, textAlign: 'center', flexShrink: 1 },
        white: { color: '#fff' },
        mutedText: { color: p.text.muted },
        lockedArea: { opacity: 0.5 },
        lockedStage: { opacity: 0.4 },
        card: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: p.border.default, backgroundColor: p.bg.card, marginBottom: 8 },
        stackedCard: { flexDirection: 'column', alignItems: 'stretch', gap: 12 },
        stageHeader: { flexDirection: 'row', alignItems: 'center', minWidth: 0, gap: 16 },
        stageHeaderInRow: { flex: 1 },
        cleared: { backgroundColor: p.bg.secondary },
        current: { borderColor: p.accent.primary },
        enemy: { flexShrink: 0, width: 48, height: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: p.bg.secondary },
        enemyImage: { width: 40, height: 40 },
        emoji: { fontSize: 20 },
        description: { flex: 1, minWidth: 0 },
        stageTitle: { color: p.text.primary, fontSize: 16, fontWeight: '500', lineHeight: 24 },
        stats: { color: p.text.muted, fontSize: 12, lineHeight: 16 },
        start: { backgroundColor: p.accent.primary, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
        restart: { backgroundColor: p.bg.card },
        startLabel: { color: '#fff', fontSize: 14, fontWeight: '500', lineHeight: 20, flexShrink: 1, textAlign: 'center' },
    });
}
