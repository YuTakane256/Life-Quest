import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ThemePalette } from '@life-quest/core/designTokens';
import {
    BATTLE_CONFIG,
    MAP_CONFIG,
    type BattleAction,
    type BattleOutcome,
    type StageDefinition,
} from '@life-quest/core/battle';
import { getUnlockedBattleSkills } from '@life-quest/core/battleSkills';
import { resolveCloudBattleAttempt, startCloudBattleAttempt } from '../platform/battleCloud';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { usePalette } from '../theme/usePalette';

const OUTCOME_LABELS: Record<BattleOutcome, string> = {
    ongoing: '戦闘中',
    victory: '勝利',
    defeat: '敗北',
};

function getAreaForStage(stage: number) {
    return MAP_CONFIG.find((area) => stage >= area.stageRange[0] && stage <= area.stageRange[1]) ?? MAP_CONFIG[0];
}

export default function MapScreen() {
    const character = useMobileGameStore((state) => state.character);
    const battleProgress = useMobileGameStore((state) => state.battleProgress);
    const activeBattle = useMobileGameStore((state) => state.activeBattle);
    const hasHydrated = useMobileGameStore((state) => state.hasHydrated);
    const startBattle = useMobileGameStore((state) => state.startBattle);
    const startCloudBattle = useMobileGameStore((state) => state.startCloudBattle);
    const performBattleAction = useMobileGameStore((state) => state.performBattleAction);
    const applyResolvedCloudBattle = useMobileGameStore((state) => state.applyResolvedCloudBattle);
    const clearActiveBattle = useMobileGameStore((state) => state.clearActiveBattle);
    const getEffectiveStats = useMobileGameStore((state) => state.getEffectiveStats);

    const { palette } = usePalette();
    const styles = useMemo(() => createStyles(palette), [palette]);

    const [selectedStage, setSelectedStage] = useState(() => Math.max(1, battleProgress.currentStage));
    const [notice, setNotice] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const stats = getEffectiveStats();
    const selectedArea = getAreaForStage(selectedStage);
    const unlockedSkills = useMemo(() => getUnlockedBattleSkills(character.level), [character.level]);

    const selectedDefinition = BATTLE_CONFIG.STAGES.find((stage) => stage.stage === selectedStage);
    const canChallenge = battleProgress.battleUnlocked
        && selectedDefinition !== undefined
        && selectedStage <= battleProgress.maxClearedStage + 1;

    const handleStart = async () => {
        setNotice(null);
        if (!battleProgress.battleUnlocked) {
            setNotice('青色の宝箱を開封するとマップバトルが解放されます');
            return;
        }
        setBusy(true);
        try {
            const cloudAttempt = await startCloudBattleAttempt(selectedStage);
            if (cloudAttempt) {
                startCloudBattle(selectedStage, cloudAttempt.battleAttemptId, cloudAttempt.actors);
                setNotice('クラウド同期されたバトルを開始しました');
                return;
            }
            if (!startBattle(selectedStage)) {
                setNotice('このステージはまだ解放されていません');
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'クラウドバトルを開始できませんでした';
            setNotice(`${message}。端末内バトルへ切り替えます`);
            if (!startBattle(selectedStage)) {
                setNotice('このステージはまだ解放されていません');
            }
        } finally {
            setBusy(false);
        }
    };

    const handleAction = async (action: BattleAction) => {
        const battleBeforeAction = activeBattle;
        const beforeOutcome = battleBeforeAction?.state.outcome;
        const outcome = performBattleAction(action);
        if (outcome === 'victory' && beforeOutcome !== 'victory') {
            if (battleBeforeAction?.rewardMode === 'cloud' && battleBeforeAction.battleAttemptId) {
                setBusy(true);
                try {
                    const resolution = await resolveCloudBattleAttempt(
                        battleBeforeAction.battleAttemptId,
                        [...battleBeforeAction.actions, action],
                    );
                    applyResolvedCloudBattle(
                        battleBeforeAction.battleAttemptId,
                        resolution.outcome,
                        resolution.granted,
                    );
                    if (resolution.outcome === 'victory') {
                        setNotice(
                            resolution.granted
                                ? `${battleBeforeAction.actors.enemy.name}を倒して ${battleBeforeAction.actors.enemy.xpReward} XP 獲得`
                                : `${battleBeforeAction.actors.enemy.name}の戦闘結果を同期しました`,
                        );
                    } else {
                        setNotice('敗北としてクラウド同期しました');
                    }
                } catch (error) {
                    const message = error instanceof Error ? error.message : 'バトル結果を同期できませんでした';
                    setNotice(message);
                } finally {
                    setBusy(false);
                }
                return;
            }
            setNotice(`${battleBeforeAction?.actors.enemy.name ?? '敵'}を倒して ${battleBeforeAction?.actors.enemy.xpReward ?? 0} XP 獲得`);
        } else if (outcome === 'defeat') {
            if (battleBeforeAction?.rewardMode === 'cloud' && battleBeforeAction.battleAttemptId) {
                setBusy(true);
                try {
                    const resolution = await resolveCloudBattleAttempt(
                        battleBeforeAction.battleAttemptId,
                        [...battleBeforeAction.actions, action],
                    );
                    applyResolvedCloudBattle(
                        battleBeforeAction.battleAttemptId,
                        resolution.outcome,
                        resolution.granted,
                    );
                    setNotice('敗北としてクラウド同期しました');
                } catch (error) {
                    const message = error instanceof Error ? error.message : 'バトル結果を同期できませんでした';
                    setNotice(message);
                } finally {
                    setBusy(false);
                }
                return;
            }
            setNotice('敗北しました。装備やレベルを整えて再挑戦しましょう');
        }
    };

    if (!hasHydrated) {
        return (
            <SafeAreaView style={styles.safeArea}>
                <View style={styles.loading}>
                    <Text style={styles.loadingText}>保存データを読み込み中…</Text>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <FlatList
                data={BATTLE_CONFIG.STAGES}
                keyExtractor={(stage) => String(stage.stage)}
                numColumns={5}
                columnWrapperStyle={styles.stageRow}
                ListHeaderComponent={(
                    <View style={styles.headerContent}>
                        <Text style={styles.title}>マップ</Text>

                        <View style={styles.heroCard}>
                            <View style={styles.heroTop}>
                                <View>
                                    <Text style={styles.areaName}>{selectedArea.name}</Text>
                                    <Text style={styles.mutedText}>
                                        進行: {battleProgress.maxClearedStage}/40
                                    </Text>
                                </View>
                                <View style={styles.statusPill}>
                                    <Text style={styles.statusPillText}>
                                        {busy ? '同期中' : battleProgress.battleUnlocked ? '解放済み' : '未解放'}
                                    </Text>
                                </View>
                            </View>
                            <View style={styles.statsRow}>
                                <Stat label="攻撃" value={stats.attack} styles={styles} />
                                <Stat label="防御" value={stats.defense} styles={styles} />
                                <Stat label="HP" value={stats.maxHp} styles={styles} />
                                <Stat label="Lv" value={character.level} styles={styles} />
                            </View>
                            <Text style={styles.hint}>
                                バトルXPは再攻略ごとに獲得できます。同じ戦闘結果の二重送信だけを防ぐ方針です。
                            </Text>
                        </View>

                        {selectedDefinition && (
                            <StageDetail
                                stage={selectedDefinition}
                                locked={!canChallenge}
                                onStart={handleStart}
                                styles={styles}
                            />
                        )}

                        {notice && (
                            <View style={styles.notice} accessibilityRole="alert">
                                <Text style={styles.noticeText}>{notice}</Text>
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
                                        onPress={() => { void handleAction({ type: 'attack' }); }}
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
                                                onPress={() => { void handleAction({ type: 'skill', skillId: skill.id }); }}
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

                        <Text style={styles.sectionTitle}>ステージ</Text>
                    </View>
                )}
                renderItem={({ item }) => (
                    <StageTile
                        stage={item}
                        selected={item.stage === selectedStage}
                        locked={!battleProgress.battleUnlocked || item.stage > battleProgress.maxClearedStage + 1}
                        cleared={item.stage <= battleProgress.maxClearedStage}
                        onPress={() => setSelectedStage(item.stage)}
                        styles={styles}
                    />
                )}
                contentContainerStyle={styles.listContent}
            />
        </SafeAreaView>
    );
}

function StageDetail({ stage, locked, onStart, styles }: { stage: StageDefinition; locked: boolean; onStart: () => void; styles: Styles }) {
    return (
        <View style={styles.card}>
            <View style={styles.stageDetailTop}>
                <View>
                    <Text style={styles.sectionTitle}>Stage {stage.stage}: {stage.name}</Text>
                    <Text style={styles.mutedText}>勝利報酬 {stage.xpReward} XP</Text>
                </View>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Stage ${stage.stage}へ挑戦する`}
                    disabled={locked}
                    onPress={onStart}
                    style={({ pressed }) => [styles.primaryButton, (pressed || locked) && styles.muted]}
                >
                    <Text style={styles.primaryButtonText}>{locked ? '未解放' : '挑戦'}</Text>
                </Pressable>
            </View>
            <View style={styles.statsRow}>
                <Stat label="HP" value={stage.hp} styles={styles} />
                <Stat label="攻撃" value={stage.attack} styles={styles} />
                <Stat label="防御" value={stage.defense} styles={styles} />
            </View>
        </View>
    );
}

function StageTile({
    stage,
    selected,
    locked,
    cleared,
    onPress,
    styles,
}: {
    stage: StageDefinition;
    selected: boolean;
    locked: boolean;
    cleared: boolean;
    onPress: () => void;
    styles: Styles;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected, disabled: locked }}
            accessibilityLabel={`Stage ${stage.stage} ${stage.name}`}
            onPress={onPress}
            style={[
                styles.stageTile,
                selected && styles.stageTileSelected,
                locked && styles.stageTileLocked,
                cleared && styles.stageTileCleared,
            ]}
        >
            <Text style={[styles.stageNumber, selected && styles.stageNumberSelected]}>{stage.stage}</Text>
        </Pressable>
    );
}

function Stat({ label, value, styles }: { label: string; value: number; styles: Styles }) {
    return (
        <View style={styles.statCell}>
            <Text style={styles.statLabel}>{label}</Text>
            <Text style={styles.statValue}>{value}</Text>
        </View>
    );
}

function HpBar({ label, current, max, styles }: { label: string; current: number; max: number; styles: Styles }) {
    const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
    return (
        <View style={styles.hpBlock}>
            <View style={styles.hpHeader}>
                <Text style={styles.hpLabel}>{label}</Text>
                <Text style={styles.hpValue}>{current}/{max}</Text>
            </View>
            <View style={styles.hpTrack}>
                <View style={[styles.hpFill, { width: `${Math.round(ratio * 100)}%` }]} />
            </View>
        </View>
    );
}

type Styles = ReturnType<typeof createStyles>;

function createStyles(palette: ThemePalette) {
    return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: palette.bg.primary },
    loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    loadingText: { color: palette.text.secondary, fontSize: 14 },
    listContent: { paddingBottom: 36 },
    headerContent: { padding: 20, gap: 12 },
    title: { color: palette.text.primary, fontSize: 26, fontWeight: '800' },
    heroCard: { backgroundColor: palette.bg.card, borderWidth: 1, borderColor: palette.border.default, borderRadius: 10, padding: 16, gap: 12 },
    heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
    areaName: { color: palette.text.primary, fontSize: 18, fontWeight: '800' },
    statusPill: { borderRadius: 999, borderWidth: 1, borderColor: palette.border.active, paddingHorizontal: 10, paddingVertical: 5 },
    statusPillText: { color: palette.text.primary, fontSize: 11, fontWeight: '800' },
    hint: { color: palette.text.muted, fontSize: 12, lineHeight: 17 },
    mutedText: { color: palette.text.muted, fontSize: 12, lineHeight: 17 },
    sectionTitle: { color: palette.text.primary, fontSize: 15, fontWeight: '800' },
    card: { backgroundColor: palette.bg.card, borderWidth: 1, borderColor: palette.border.default, borderRadius: 10, padding: 16, gap: 12 },
    stageDetailTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
    statsRow: { flexDirection: 'row', gap: 8 },
    statCell: { flex: 1, minHeight: 58, borderRadius: 8, backgroundColor: palette.bg.secondary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
    statLabel: { color: palette.text.muted, fontSize: 10, fontWeight: '700' },
    statValue: { color: palette.text.primary, fontSize: 15, fontWeight: '800', marginTop: 4 },
    primaryButton: { minHeight: 40, paddingHorizontal: 18, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.accent.primary },
    primaryButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
    secondaryButton: { minHeight: 38, paddingHorizontal: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bg.secondary, borderWidth: 1, borderColor: palette.border.default },
    secondaryButtonText: { color: palette.text.primary, fontSize: 12, fontWeight: '800' },
    muted: { opacity: 0.45 },
    notice: { borderRadius: 8, borderWidth: 1, borderColor: palette.border.active, backgroundColor: palette.bg.secondary, padding: 12 },
    noticeText: { color: palette.text.secondary, fontSize: 13, lineHeight: 18 },
    battleCard: { backgroundColor: palette.bg.card, borderWidth: 1, borderColor: palette.border.default, borderRadius: 10, padding: 16, gap: 12 },
    battleHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    closeButton: { minHeight: 34, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: palette.border.default, justifyContent: 'center' },
    closeButtonText: { color: palette.text.secondary, fontSize: 12, fontWeight: '700' },
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
    stageRow: { paddingHorizontal: 20, gap: 8, marginBottom: 8 },
    stageTile: { flex: 1, aspectRatio: 1, borderRadius: 8, borderWidth: 1, borderColor: palette.border.default, backgroundColor: palette.bg.card, alignItems: 'center', justifyContent: 'center' },
    stageTileSelected: { borderColor: palette.border.active, backgroundColor: palette.bg.cardHover },
    stageTileLocked: { opacity: 0.35 },
    stageTileCleared: { borderColor: palette.accent.primary },
    stageNumber: { color: palette.text.muted, fontSize: 13, fontWeight: '800' },
    stageNumberSelected: { color: palette.text.primary },
    });
}
