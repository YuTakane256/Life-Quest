import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Swords } from 'lucide-react-native';
import { ENEMY_IMAGE_KEYS, MAP_CONFIG, isMapUnlocked, type MapDefinition, type StageDefinition } from '@life-quest/core/battle';
import type { ThemePalette } from '@life-quest/core/designTokens';
import { getEnemyImage } from '../assets/mapImages';
import { usePalette } from '../theme/usePalette';
import { PAGE_HEADING } from '../theme/layout';

export function MapOverview({ selectedMap, maxClearedStage, battleUnlocked, onSelect }: {
    selectedMap: MapDefinition;
    maxClearedStage: number;
    battleUnlocked: boolean;
    onSelect: (id: number) => void;
}) {
    const { palette: p } = usePalette();
    const s = createStyles(p);
    return (
        <View>
            <Text style={s.title} accessibilityRole="header">マップ</Text>
            <Text style={s.progress}>最高到達: ステージ {maxClearedStage || '-'}</Text>
            <View style={s.areaRow}>
                {MAP_CONFIG.map((map) => {
                    const locked = !isMapUnlocked(map, maxClearedStage, battleUnlocked);
                    const selected = selectedMap.id === map.id;
                    return (
                        <Pressable key={map.id} accessibilityRole="button"
                            accessibilityLabel={locked ? `${map.name}（未開放）` : map.name}
                            accessibilityState={{ selected, disabled: locked }} disabled={locked}
                            onPress={() => onSelect(map.id)}
                            style={[s.area, selected && s.areaSelected, locked && s.lockedArea]}>
                            <Text style={[s.areaLabel, selected && s.white, locked && s.mutedText]}>
                                {locked ? '🔒 ' : ''}{map.name}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}

export function MapStageCard({ stage, currentStage, maxClearedStage, battleUnlocked, busy, onStart }: {
    stage: StageDefinition;
    currentStage: number;
    maxClearedStage: number;
    battleUnlocked: boolean;
    busy: boolean;
    onStart: () => void;
}) {
    const { palette: p } = usePalette();
    const s = createStyles(p);
    const cleared = stage.stage <= maxClearedStage;
    const current = stage.stage === currentStage;
    const locked = !battleUnlocked || stage.stage > maxClearedStage + 1;
    const enemy = getEnemyImage(ENEMY_IMAGE_KEYS[stage.stage]);
    return (
        <View style={[s.card, cleared && s.cleared, current && s.current, locked && s.lockedStage]}>
            <View style={[s.enemy, cleared && { backgroundColor: p.accent.emerald }, !cleared && current && { backgroundColor: p.accent.primary }]}
                accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {cleared || locked ? <Text style={s.emoji}>{cleared ? '✅' : '🔒'}</Text>
                    : enemy ? <Image source={enemy} style={s.enemyImage} resizeMode="contain" /> : <Text style={s.emoji}>❓</Text>}
            </View>
            <View style={s.description}>
                <Text style={s.stageTitle}>ステージ {stage.stage}: {stage.name}</Text>
                <Text style={s.stats}>HP: {stage.hp} · 攻: {stage.attack} · 防: {stage.defense}</Text>
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
        area: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: p.border.default, backgroundColor: p.bg.card, paddingVertical: 8, paddingHorizontal: 2, justifyContent: 'center' },
        areaSelected: { backgroundColor: p.accent.primary, borderColor: p.accent.primary },
        areaLabel: { color: p.text.secondary, fontSize: 14, fontWeight: '500', lineHeight: 20, textAlign: 'center' },
        white: { color: '#fff' },
        mutedText: { color: p.text.muted },
        lockedArea: { opacity: 0.5 },
        lockedStage: { opacity: 0.4 },
        card: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: p.border.default, backgroundColor: p.bg.card, marginBottom: 8 },
        cleared: { backgroundColor: p.bg.secondary },
        current: { borderColor: p.accent.primary },
        enemy: { width: 48, height: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: p.bg.secondary },
        enemyImage: { width: 40, height: 40 },
        emoji: { fontSize: 20 },
        description: { flex: 1, minWidth: 0 },
        stageTitle: { color: p.text.primary, fontSize: 16, fontWeight: '500', lineHeight: 24 },
        stats: { color: p.text.muted, fontSize: 12, lineHeight: 16 },
        start: { backgroundColor: p.accent.primary, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8, minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
        restart: { backgroundColor: p.bg.card },
        startLabel: { color: '#fff', fontSize: 14, fontWeight: '500', lineHeight: 20 },
    });
}
