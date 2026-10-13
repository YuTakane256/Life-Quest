import { useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LAYOUT_TOKENS, type ThemePalette } from '@life-quest/core/designTokens';
import { TAB_SCREEN_EDGES } from '../theme/layout';
import {
    MAP_CONFIG,
    getMapForStage,
    getMapStages,
    isMapUnlocked,
    type BattleAction,
    type BattleOutcome,
    type StageDefinition,
} from '@life-quest/core/battle';
import { getUnlockedBattleSkills } from '@life-quest/core/battleSkills';
import { getHpBarA11y } from '@life-quest/core/progressA11y';
import { createBattleStartGate, getBattleStartMessage, requestBattleStart } from '@life-quest/core/battleStartPolicy';
import { startCloudBattleAttempt } from '../platform/battleCloud';
import { getBattleAuthState } from '../platform/auth';
import { createMobileId } from '../utils/createMobileId';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { usePalette } from '../theme/usePalette';
import { useCloudBattleResolve } from '../hooks/useCloudBattleResolve';
import { MapOverview, MapStageCard } from '../components/MapOverview';
import { getMapImage } from '../assets/mapImages';

const OUTCOME_LABELS: Record<BattleOutcome, string> = {
    ongoing: '戦闘中',
    victory: '勝利',
    defeat: '敗北',
};

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
    const unlockedSkills = useMemo(() => getUnlockedBattleSkills(character.level), [character.level]);

    const handleStart = async (stage: number, idempotencyKey = createMobileId()) => {
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
                setNotice('クラウド同期されたバトルを開始しました');
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
        const battleBeforeAction = activeBattle;
        const beforeOutcome = battleBeforeAction?.state.outcome;
        const outcome = performBattleAction(action);
        // クラウド報酬モードの決着同期は useCloudBattleResolve が自動で行い、
        // 同期状況はバトルカード内に表示する（ここではローカル報酬のみ通知する）。
        if (battleBeforeAction?.rewardMode === 'cloud') return;
        if (outcome === 'victory' && beforeOutcome !== 'victory') {
            setNotice(`${battleBeforeAction?.actors.enemy.name ?? '敵'}を倒して ${battleBeforeAction?.actors.enemy.xpReward ?? 0} XP 獲得`);
        } else if (outcome === 'defeat') {
            setNotice('敗北しました。装備やレベルを整えて再挑戦しましょう');
        }
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
            <Image source={getMapImage(selectedArea.theme)} style={styles.background} resizeMode="cover"
                accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <SafeAreaView edges={TAB_SCREEN_EDGES} style={styles.screen}>
                <FlatList
                    ref={listRef}
                    data={activeBattle || !battleProgress.battleUnlocked ? [] : getMapStages(selectedArea)}
                    keyExtractor={(stage) => String(stage.stage)}
                    ListHeaderComponent={(
                        <View style={styles.headerContent}>
                            {battleProgress.battleUnlocked ? (
                                <MapOverview selectedMap={selectedArea} maxClearedStage={battleProgress.maxClearedStage}
                                    battleUnlocked={battleProgress.battleUnlocked} onSelect={setSelectedMapId} />
                            ) : (
                                <View style={styles.lockedMap}>
                                    <Text style={styles.lockedIcon}>🔒</Text>
                                    <Text style={styles.sectionTitle}>マップ未解放</Text>
                                    <Text style={styles.mutedText}>タスクを5つ消化して青色の宝箱を{'\n'}手に入れると解放されます！</Text>
                                </View>
                            )}

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
                                <View style={styles.battleCard}>
                                    <View style={styles.battleHeader}>
                                        <View>
                                            <Text style={styles.sectionTitle}>
                                                Stage {activeBattle.stage}: {activeBattle.actors.enemy.name}
                                            </Text>
                                            <Text style={styles.mutedText}>{OUTCOME_LABELS[activeBattle.state.outcome]}</Text>
                                            {activeBattle.rewardMode === 'cloud' && activeBattle.state.outcome !== 'ongoing' && (
                                                <Text style={styles.mutedText}>
                                                    {resolveState === 'syncing' && '報酬を同期中…'}
                                                    {resolveState === 'done' && activeBattle.state.outcome === 'victory' && (granted
                                                        ? `${activeBattle.actors.enemy.xpReward} XP を獲得！`
                                                        : '同期済み（既に付与済みです）')}
                                                    {resolveState === 'done' && activeBattle.state.outcome === 'defeat' && '敗北としてクラウド同期しました'}
                                                </Text>
                                            )}
                                        </View>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="戦闘を閉じる"
                                            onPress={clearActiveBattle}
                                            style={styles.closeButton}
                                        >
                                            <Text style={styles.closeButtonText}>閉じる</Text>
                                        </Pressable>
                                    </View>

                                    {activeBattle.rewardMode === 'cloud' && resolveState === 'error' && (
                                        <View style={styles.resolveErrorRow}>
                                            <Text style={styles.dangerButtonText}>報酬の同期に失敗しました。</Text>
                                            <Pressable
                                                accessibilityRole="button"
                                                accessibilityLabel="バトル結果の同期を再送する"
                                                onPress={retryResolve}
                                                style={({ pressed }) => [styles.dangerButton, pressed && styles.muted]}
                                            >
                                                <Text style={styles.dangerButtonText}>再送</Text>
                                            </Pressable>
                                        </View>
                                    )}

                                    <View style={styles.hpGrid}>
                                        <HpBar
                                            label={character.name}
                                            current={activeBattle.state.playerHp}
                                            max={activeBattle.actors.player.maxHp}
                                            styles={styles}
                                        />
                                        <HpBar
                                            label={activeBattle.actors.enemy.name}
                                            current={activeBattle.state.enemyHp}
                                            max={activeBattle.actors.enemy.maxHp}
                                            styles={styles}
                                        />
                                    </View>

                                    <View style={styles.actionRow}>
                                        <Pressable
                                            accessibilityRole="button"
                                            accessibilityLabel="通常攻撃"
                                            disabled={busy || activeBattle.state.outcome !== 'ongoing'}
                                            onPress={() => handleAction({ type: 'attack' })}
                                            style={({ pressed }) => [
                                                styles.primaryButton,
                                                (pressed || busy || activeBattle.state.outcome !== 'ongoing') && styles.muted,
                                            ]}
                                        >
                                            <Text style={styles.primaryButtonText}>攻撃</Text>
                                        </Pressable>
                                        {unlockedSkills.map((skill) => {
                                            const cooldown = activeBattle.state.skillCooldowns[skill.id] ?? 0;
                                            const disabled = busy || activeBattle.state.outcome !== 'ongoing' || cooldown > 0;
                                            return (
                                                <Pressable
                                                    key={skill.id}
                                                    accessibilityRole="button"
                                                    accessibilityLabel={`${skill.name}${cooldown > 0 ? ` クールダウン${cooldown}` : ''}`}
                                                    disabled={disabled}
                                                    onPress={() => handleAction({ type: 'skill', skillId: skill.id })}
                                                    style={({ pressed }) => [styles.secondaryButton, (pressed || disabled) && styles.muted]}
                                                >
                                                    <Text style={styles.secondaryButtonText}>
                                                        {skill.name}{cooldown > 0 ? ` ${cooldown}` : ''}
                                                    </Text>
                                                </Pressable>
                                            );
                                        })}
                                    </View>

                                    <ScrollView style={styles.logBox} nestedScrollEnabled>
                                        {activeBattle.state.logs.length === 0 ? (
                                            <Text style={styles.mutedText}>行動するとログが表示されます</Text>
                                        ) : activeBattle.state.logs.slice(-8).map((log, index) => (
                                            <Text key={`${log.turn}-${index}`} style={styles.logText}>{log.message}</Text>
                                        ))}
                                    </ScrollView>
                                </View>
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

function HpBar({ label, current, max, styles }: { label: string; current: number; max: number; styles: Styles }) {
    const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
    const a11y = getHpBarA11y(current, max);
    return (
        <View style={styles.hpBlock}>
            <View style={styles.hpHeader} accessibilityElementsHidden>
                <Text style={styles.hpLabel}>{label}</Text>
                <Text style={styles.hpValue}>{current}/{max}</Text>
            </View>
            <View
                style={styles.hpTrack}
                accessibilityRole={a11y.max > 0 ? 'progressbar' : undefined}
                accessibilityLabel={`${label}のHP`}
                accessibilityValue={a11y.max > 0 ? { min: 0, max: a11y.max, now: a11y.current, text: a11y.text } : undefined}
            >
                <View style={[styles.hpFill, { width: `${Math.round(ratio * 100)}%` }]} />
            </View>
        </View>
    );
}

type Styles = ReturnType<typeof createStyles>;

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
        primaryButton: { minHeight: 40, paddingHorizontal: 18, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.accent.primary },
        primaryButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
        secondaryButton: { minHeight: 38, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg.secondary, borderWidth: 1, borderColor: palette.border.default },
        secondaryButtonText: { color: palette.text.primary, fontSize: 12, fontWeight: '800' },
        muted: { opacity: 0.45 },
        notice: { marginBottom: 16, borderRadius: 8, borderWidth: 1, borderColor: palette.border.active, backgroundColor: palette.bg.secondary, padding: 12, gap: 8 },
        noticeText: { color: palette.text.secondary, fontSize: 13, lineHeight: 18 },
        noticeRetryButton: { alignSelf: 'flex-start', minHeight: 32, paddingHorizontal: 10, borderRadius: 8, justifyContent: 'center', backgroundColor: palette.bg.card, borderWidth: 1, borderColor: palette.border.active },
        noticeRetryText: { color: palette.text.primary, fontSize: 12, fontWeight: '800' },
        battleCard: { backgroundColor: palette.bg.card, borderWidth: 1, borderColor: palette.border.default, borderRadius: LAYOUT_TOKENS.card.radius, padding: LAYOUT_TOKENS.card.padding, gap: 12 },
        battleHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
        closeButton: { minHeight: 34, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: palette.border.default, justifyContent: 'center' },
        closeButtonText: { color: palette.text.secondary, fontSize: 12, fontWeight: '700' },
        resolveErrorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        dangerButton: { height: 32, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg.tertiary, borderWidth: 1, borderColor: palette.text.danger },
        dangerButtonText: { color: palette.text.danger, fontSize: 12, fontWeight: '700' },
        hpGrid: { gap: 10 },
        hpBlock: { gap: 5 },
        hpHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
        hpLabel: { color: palette.text.secondary, fontSize: 12, fontWeight: '700' },
        hpValue: { color: palette.text.muted, fontSize: 12 },
        hpTrack: { height: 8, borderRadius: 999, backgroundColor: palette.bg.secondary, overflow: 'hidden' },
        hpFill: { height: '100%', borderRadius: 999, backgroundColor: palette.accent.primary },
        actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
        logBox: { maxHeight: 150, borderRadius: 8, backgroundColor: palette.bg.secondary, padding: 10 },
        logText: { color: palette.text.secondary, fontSize: 12, lineHeight: 18, marginBottom: 4 },
    });
}
