import { useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LAYOUT_TOKENS, type ThemePalette } from '@life-quest/core/designTokens';
import { TAB_SCREEN_EDGES } from '../theme/layout';
import {
    MAP_CONFIG,
    getMapForStage,
    getMapStages,
    isMapUnlocked,
    hasPendingBattleResult,
    type BattleAction,
    type StageDefinition,
} from '@life-quest/core/battle';
import { createBattleStartGate, getBattleStartMessage, requestBattleStart } from '@life-quest/core/battleStartPolicy';
import { startCloudBattleAttempt } from '../platform/battleCloud';
import { getBattleAuthState } from '../platform/auth';
import { createMobileId } from '../utils/createMobileId';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { usePalette } from '../theme/usePalette';
import { useCloudBattleResolve } from '../hooks/useCloudBattleResolve';
import { MapOverview, MapStageCard } from '../components/MapOverview';
import { getBattleImage, getMapImage } from '../assets/mapImages';
import { BattleOverview } from '../components/BattleOverview';

export default function MapScreen() {
    const character = useMobileGameStore((state) => state.character);
    const battleProgress = useMobileGameStore((state) => state.battleProgress);
    const activeBattle = useMobileGameStore((state) => state.activeBattle);
    const hasHydrated = useMobileGameStore((state) => state.hasHydrated);
    const startBattle = useMobileGameStore((state) => state.startBattle);
    const startCloudBattle = useMobileGameStore((state) => state.startCloudBattle);
    const performBattleAction = useMobileGameStore((state) => state.performBattleAction);
    const clearActiveBattle = useMobileGameStore((state) => state.clearActiveBattle);
    const { resolveState, granted, retry: retryResolve } = useCloudBattleResolve();

    const { palette } = usePalette();
    const styles = useMemo(() => createStyles(palette), [palette]);

    const [selectedMapId, setSelectedMapId] = useState(() => getMapForStage(battleProgress.currentStage).id);
    const [notice, setNotice] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const startGateRef = useRef(createBattleStartGate());
    const listRef = useRef<FlatList<StageDefinition>>(null);
    const retryStartRef = useRef<{ stage: number; idempotencyKey: string } | null>(null);
    const requestedMap = MAP_CONFIG.find((map) => map.id === selectedMapId) ?? MAP_CONFIG[0];
    // A restored account can have less progress than the previously selected area.
    const selectedArea = isMapUnlocked(requestedMap, battleProgress.maxClearedStage, battleProgress.battleUnlocked)
        ? requestedMap : MAP_CONFIG[0];

    const handleStart = async (stage: number, idempotencyKey = createMobileId()) => {
        if (activeBattle && hasPendingBattleResult(activeBattle.state.outcome, activeBattle.rewardMode, activeBattle.battleAttemptId)) return;
        setNotice(null);
        if (!battleProgress.battleUnlocked) {
            setNotice('青色の宝箱を開封するとマップバトルが解放されます');
            return;
        }
        if (!startGateRef.current.tryEnter()) return;
        setBusy(true);
        try {
            const result = await requestBattleStart(
                await getBattleAuthState(),
                getBattleAuthState,
                (expectedUserId) => startCloudBattleAttempt(stage, idempotencyKey, expectedUserId),
            );
            if (result.kind === 'cloud-started') {
                startCloudBattle(stage, result.attempt.battleAttemptId, result.attempt.actors);
                listRef.current?.scrollToOffset({ offset: 0, animated: false });
                retryStartRef.current = null;
                return;
            }
            if (result.kind === 'local-started' && !startBattle(stage)) {
                setNotice('このステージはまだ解放されていません');
                return;
            }
            if (result.kind !== 'local-started') {
                retryStartRef.current = { stage, idempotencyKey };
                setNotice(getBattleStartMessage(result));
            } else {
                retryStartRef.current = null;
                listRef.current?.scrollToOffset({ offset: 0, animated: false });
            }
        } finally {
            startGateRef.current.leave();
            setBusy(false);
        }
    };

    const handleAction = (action: BattleAction) => {
        performBattleAction(action);
    };
    const handleMap = () => {
        if (activeBattle && hasPendingBattleResult(activeBattle.state.outcome, activeBattle.rewardMode, activeBattle.battleAttemptId)) return;
        if (activeBattle) setSelectedMapId(getMapForStage(activeBattle.stage).id);
        clearActiveBattle();
        setNotice(null);
        retryStartRef.current = null;
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
    };

    if (!hasHydrated) {
        return (
            <SafeAreaView edges={TAB_SCREEN_EDGES} style={styles.safeArea}>
                <View style={styles.loading}>
                    <Text style={styles.loadingText}>保存データを読み込み中…</Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <View style={styles.safeArea}>
            <Image source={activeBattle ? getBattleImage(getMapForStage(activeBattle.stage).theme) : getMapImage(selectedArea.theme)}
                style={[styles.background, activeBattle && { opacity: 0.5 }]} resizeMode="cover"
                accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <SafeAreaView edges={TAB_SCREEN_EDGES} style={styles.screen}>
                {/* Reset map/combat/result viewports, not on every turn. */}
                <FlatList
                    key={activeBattle ? `battle-${activeBattle.stage}-${activeBattle.state.outcome}` : `map-${selectedArea.id}`}
                    ref={listRef}
                    data={activeBattle || !battleProgress.battleUnlocked ? [] : getMapStages(selectedArea)}
                    keyExtractor={(stage) => String(stage.stage)}
                    ListHeaderComponent={(
                        <View style={styles.headerContent}>
                            {!activeBattle && (battleProgress.battleUnlocked ? (
                                <MapOverview selectedMap={selectedArea} maxClearedStage={battleProgress.maxClearedStage}
                                    battleUnlocked={battleProgress.battleUnlocked} onSelect={setSelectedMapId} />
                            ) : (
                                <View style={styles.lockedMap}>
                                    <Text style={styles.lockedIcon}>🔒</Text>
                                    <Text style={styles.sectionTitle}>マップ未解放</Text>
                                    <Text style={styles.mutedText}>タスクを5つ消化して青色の宝箱を{'\n'}手に入れると解放されます！</Text>
                                </View>
                            ))}

                            {busy && <Text style={styles.noticeText} accessibilityRole="alert">バトルを開始中…</Text>}

                            {notice && (
                                <View style={styles.notice} accessibilityRole="alert">
                                    <Text style={styles.noticeText}>{notice}</Text>
                                    {retryStartRef.current && (
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="バトル開始を再試行する"
                                            disabled={busy}
                                            onPress={() => {
                                                const pending = retryStartRef.current;
                                                if (pending) void handleStart(pending.stage, pending.idempotencyKey);
                                            }}
                                            style={({ pressed }) => [styles.noticeRetryButton, (pressed || busy) && styles.muted]}
                                        >
                                            <Text style={styles.noticeRetryText}>再試行</Text>
                                        </Pressable>
                                    )}
                                </View>
                            )}

                            {activeBattle && (
                                <BattleOverview battle={activeBattle} avatar={character.avatar} busy={busy}
                                    resolveState={resolveState} granted={granted} onAction={handleAction}
                                    onStart={(stage) => void handleStart(stage)} onMap={handleMap} onRetryResolve={retryResolve} />
                            )}

                        </View>
                    )}
                    renderItem={({ item }) => (
                        <MapStageCard
                            stage={item}
                            currentStage={battleProgress.currentStage}
                            maxClearedStage={battleProgress.maxClearedStage}
                            battleUnlocked={battleProgress.battleUnlocked}
                            busy={busy}
                            onStart={() => void handleStart(item.stage)}
                        />
                    )}
                    contentContainerStyle={styles.listContent}
                />
            </SafeAreaView>
        </View>
    );
}

function createStyles(palette: ThemePalette) {
    return StyleSheet.create({
        safeArea: { flex: 1, backgroundColor: palette.bg.primary },
        screen: { flex: 1 },
        loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
        loadingText: { color: palette.text.secondary, fontSize: 14 },
        listContent: { paddingHorizontal: LAYOUT_TOKENS.page.detailHorizontal, paddingTop: LAYOUT_TOKENS.page.top, paddingBottom: 36, width: "100%", maxWidth: LAYOUT_TOKENS.page.maxWidth, alignSelf: "center" },
        background: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0.35 },
        lockedMap: { paddingVertical: 80, alignItems: "center", gap: 8 },
        lockedIcon: { fontSize: 40, padding: 16, backgroundColor: palette.bg.card, borderRadius: 16 },
        headerContent: { gap: 0 },
        mutedText: { color: palette.text.muted, fontSize: 12, lineHeight: 17 },
        sectionTitle: { color: palette.text.primary, fontSize: 15, fontWeight: '800' },
        muted: { opacity: 0.45 },
        notice: { marginBottom: 16, borderRadius: 8, borderWidth: 1, borderColor: palette.border.active, backgroundColor: palette.bg.secondary, padding: 12, gap: 8 },
        noticeText: { color: palette.text.secondary, fontSize: 13, lineHeight: 18 },
        noticeRetryButton: { alignSelf: 'flex-start', minHeight: 32, paddingHorizontal: 10, borderRadius: 8, justifyContent: 'center', backgroundColor: palette.bg.card, borderWidth: 1, borderColor: palette.border.active },
        noticeRetryText: { color: palette.text.primary, fontSize: 12, fontWeight: '800' },
    });
}
