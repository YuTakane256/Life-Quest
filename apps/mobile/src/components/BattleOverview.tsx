import { useRef } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, RotateCcw, Skull, Trophy } from 'lucide-react-native';
import { ENEMY_IMAGE_KEYS, getMapForStage, type BattleAction } from '@life-quest/core/battle';
import { getUnlockedBattleSkills } from '@life-quest/core/battleSkills';
import { getHpDisplayState } from '@life-quest/core/hp';
import { getHpBarA11y } from '@life-quest/core/progressA11y';
import type { AvatarId } from '@life-quest/core/gameState';
import type { ThemePalette } from '@life-quest/core/designTokens';
import type { ActiveMobileBattle } from '../stores/useMobileGameStore';
import type { CloudBattleResolveState } from '../hooks/useCloudBattleResolve';
import { AVATAR_IMAGES } from '../assets/images';
import { getEnemyImage } from '../assets/mapImages';
import { getBattleResultView } from '../screens/battleScreenModel';
import { usePalette } from '../theme/usePalette';

export function BattleOverview({ battle, avatar, busy, resolveState, granted, onAction, onStart, onMap, onRetryResolve }: {
    battle: ActiveMobileBattle;
    avatar: AvatarId;
    busy: boolean;
    resolveState: CloudBattleResolveState;
    granted: boolean | null;
    onAction: (action: BattleAction) => void;
    onStart: (stage: number) => void;
    onMap: () => void;
    onRetryResolve: () => void;
}) {
    const { palette: p } = usePalette();
    const s = createStyles(p);
    const logRef = useRef<ScrollView>(null);
    const { actors, state } = battle;
    const ongoing = state.outcome === 'ongoing';
    const victory = state.outcome === 'victory';
    const skills = getUnlockedBattleSkills(actors.playerLevel);
    const enemyImage = getEnemyImage(ENEMY_IMAGE_KEYS[battle.stage]);
    const result = getBattleResultView({ outcome: state.outcome, rewardMode: battle.rewardMode,
        attemptId: battle.battleAttemptId, resolveState, granted, xpReward: actors.enemy.xpReward, stage: battle.stage, busy });

    return (
        <View>
            <Text style={s.title} accessibilityRole="header">⚔️ {getMapForStage(battle.stage).name} — ステージ {battle.stage}: {actors.enemy.name}</Text>
            <View style={s.actors}>
                <View style={s.actorCard}>
                    <View style={[s.portrait, { backgroundColor: p.accent.primary,
                        experimental_backgroundImage: `linear-gradient(135deg, ${p.accent.primary}, ${p.accent.secondary})` }]}>
                        <Image source={AVATAR_IMAGES[avatar]} style={s.heroImage} resizeMode="cover" accessibilityLabel={actors.playerName} />
                    </View>
                    <Text style={s.actorName} numberOfLines={1}>{actors.playerName} <Text style={s.level}>Lv.{actors.playerLevel}</Text></Text>
                    <BattleHp label={`${actors.playerName} のHP`} current={state.playerHp} max={actors.player.maxHp} enemy={false} palette={p} />
                </View>
                <View style={s.actorCard}>
                    <View style={s.portrait}>
                        {enemyImage ? <Image source={enemyImage} style={s.enemyImage} resizeMode="contain" accessibilityLabel={actors.enemy.name} />
                            : <Text style={s.unknownEnemy}>❓</Text>}
                    </View>
                    <Text style={[s.actorName, s.enemyName]}>{actors.enemy.name}</Text>
                    <BattleHp label={`${actors.enemy.name} のHP`} current={state.enemyHp} max={actors.enemy.maxHp} enemy palette={p} />
                </View>
            </View>

            {ongoing && skills.length > 0 && (
                <View style={s.skillsCard}>
                    <View style={s.skillsHeader}>
                        <Text style={s.smallHeading} accessibilityRole="header">スキル</Text>
                        {state.guardTurnsRemaining > 0 && <Text style={s.guard}>防御 {state.guardTurnsRemaining}T</Text>}
                    </View>
                    <View style={s.skillRow}>
                        {skills.map((skill) => {
                            const cooldown = state.skillCooldowns[skill.id] ?? 0;
                            const disabled = busy || cooldown > 0;
                            const tone = skill.type === 'damage' ? p.accent.rose : skill.type === 'heal' ? p.accent.emerald : p.accent.sky;
                            return (
                                <Pressable key={skill.id} accessibilityRole="button" accessibilityLabel={`${skill.name}${cooldown > 0 ? ` クールダウン${cooldown}` : ''}`}
                                    accessibilityHint={skill.description} accessibilityState={{ disabled }} disabled={disabled}
                                    onPress={() => onAction({ type: 'skill', skillId: skill.id })}
                                    style={({ pressed }) => [s.skill, { borderColor: cooldown > 0 ? p.border.default : tone }, (disabled || pressed) && s.disabled]}>
                                    <Text style={s.skillEmoji}>{skill.type === 'damage' ? '⚔️' : skill.type === 'heal' ? '💚' : '🛡️'}</Text>
                                    <Text style={[s.skillName, { color: cooldown > 0 ? p.text.muted : tone }]}>{skill.name}</Text>
                                    <Text style={s.cooldown}>{cooldown > 0 ? `あと${cooldown}T` : '使用可'}</Text>
                                </Pressable>
                            );
                        })}
                        {Array.from({ length: Math.max(0, 3 - skills.length) }, (_, index) => (
                            <View key={`locked-skill-slot-${index}`} style={s.skillSlot} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                        ))}
                    </View>
                </View>
            )}

            <ScrollView ref={logRef} style={[s.log, !ongoing && { height: 128 }]} nestedScrollEnabled accessibilityLabel="バトルログ"
                onContentSizeChange={() => logRef.current?.scrollToEnd({ animated: false })}>
                {state.logs.map((entry, index) => (
                    <Text key={`${entry.turn}-${index}`} style={s.logLine} accessibilityLabel={`ターン ${entry.turn}: ${entry.message}`}>
                        <Text style={s.logTurn}>[{entry.turn}] </Text>{entry.message}
                    </Text>
                ))}
            </ScrollView>

            {!ongoing && (
                <View style={[s.result, { borderColor: victory ? p.accent.gold : p.text.danger }]}>
                    {victory ? <Trophy size={48} color={p.accent.gold} style={s.resultIcon} /> : <Skull size={48} color={p.text.danger} style={s.resultIcon} />}
                    <Text style={[s.resultTitle, { color: victory ? p.accent.gold : p.text.danger }]} accessibilityRole="header">{victory ? '勝利！' : '敗北...'}</Text>
                    <Text style={[s.resultMessage, battle.rewardMode === 'cloud' && resolveState === 'error' && s.enemyName]} accessibilityLiveRegion="polite">{result.message}</Text>
                    {result.canResend && (
                        <Pressable accessibilityRole="button" accessibilityLabel="バトル結果の同期を再送する" onPress={onRetryResolve} style={s.resend}>
                            <Text style={s.resendLabel}>再送</Text>
                        </Pressable>
                    )}
                    <View style={s.resultActions}>
                        <Pressable accessibilityRole="button" accessibilityLabel={victory ? result.nextLabel : 'リトライ'}
                            disabled={!result.canContinue} accessibilityState={{ disabled: !result.canContinue }}
                            onPress={() => onStart(victory ? result.nextStage : battle.stage)}
                            style={({ pressed }) => [s.next, (!result.canContinue || pressed) && s.disabled]}>
                            {victory ? <ChevronRight size={18} color="#fff" /> : <RotateCcw size={18} color="#fff" />}
                            <Text style={s.nextLabel}>{victory ? result.nextLabel : 'リトライ'}</Text>
                        </Pressable>
                        <Pressable accessibilityRole="button" accessibilityLabel="マップへ" accessibilityState={{ disabled: !result.canContinue }}
                            disabled={!result.canContinue} onPress={onMap} style={({ pressed }) => [s.back, (!result.canContinue || pressed) && s.disabled]}>
                            <Text style={s.backLabel}>マップへ</Text>
                        </Pressable>
                    </View>
                </View>
            )}
        </View>
    );
}

function BattleHp({ label, current, max, enemy, palette: p }: { label: string; current: number; max: number; enemy: boolean; palette: ThemePalette }) {
    const s = createStyles(p);
    const hp = getHpDisplayState(current, max);
    const a11y = getHpBarA11y(current, max);
    return (
        <View style={s.hpRow}>
            <View style={s.hpTrack} accessibilityRole={a11y.max > 0 ? 'progressbar' : undefined} accessibilityLabel={label}
                accessibilityValue={a11y.max > 0 ? { min: 0, max: a11y.max, now: a11y.current, text: a11y.text } : undefined}>
                <View style={[s.hpFill, { width: `${hp.ratio * 100}%`, backgroundColor: enemy || hp.ratio <= 0.3 ? p.text.danger : p.accent.emerald }]} />
            </View>
            <Text style={s.hpNumber} accessibilityElementsHidden>{hp.current}</Text>
        </View>
    );
}

function createStyles(p: ThemePalette) {
    return StyleSheet.create({
        title: { color: p.text.primary, fontSize: 20, lineHeight: 28, fontWeight: '700', marginBottom: 16 },
        actors: { flexDirection: 'row', gap: 16, marginBottom: 16 },
        actorCard: { flex: 1, minWidth: 0, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: p.border.default, backgroundColor: p.bg.card },
        portrait: { width: 112, maxWidth: '100%', aspectRatio: 1, alignSelf: 'center', borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: p.bg.secondary, marginBottom: 8 },
        heroImage: { width: '100%', height: '100%' },
        enemyImage: { width: 96, maxWidth: '100%', aspectRatio: 1 },
        unknownEnemy: { fontSize: 48 },
        actorName: { color: p.text.primary, fontSize: 14, fontWeight: '700', lineHeight: 20, textAlign: 'center', marginBottom: 4 },
        level: { color: p.accent.gold },
        enemyName: { color: p.text.danger },
        hpRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        hpTrack: { flex: 1, height: 12, borderRadius: 999, overflow: 'hidden', backgroundColor: p.bg.secondary },
        hpFill: { height: '100%', borderRadius: 999 },
        hpNumber: { color: p.text.primary, fontSize: 14, lineHeight: 20, fontWeight: '700', minWidth: 40, textAlign: 'right' },
        skillsCard: { backgroundColor: p.bg.card, borderColor: p.border.default, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 16 },
        skillsHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
        smallHeading: { color: p.text.primary, fontSize: 14, fontWeight: '700', flex: 1 },
        guard: { color: '#fff', backgroundColor: p.accent.sky, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, fontSize: 10 },
        skillRow: { flexDirection: 'row', gap: 8 },
        skillSlot: { flex: 1, minWidth: 0 },
        skill: { flex: 1, minWidth: 0, minHeight: 64, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8, gap: 4, justifyContent: 'center', alignItems: 'center', borderWidth: 1, backgroundColor: p.bg.secondary },
        skillEmoji: { fontSize: 16 },
        skillName: { fontSize: 11, lineHeight: 14, fontWeight: '700', textAlign: 'center' },
        cooldown: { color: p.text.muted, fontSize: 10 },
        log: { height: 208, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: p.border.default, backgroundColor: p.bg.card, marginBottom: 16 },
        logLine: { color: p.text.secondary, fontSize: 14, lineHeight: 20, paddingVertical: 4 },
        logTurn: { color: p.text.muted },
        result: { borderRadius: 12, borderWidth: 2, backgroundColor: p.bg.card, padding: 20, marginBottom: 16 },
        resultIcon: { alignSelf: 'center', marginBottom: 8 },
        resultTitle: { fontSize: 20, lineHeight: 28, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
        resultMessage: { color: p.text.secondary, fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 16 },
        resend: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', marginBottom: 8 },
        resendLabel: { color: p.accent.primary, fontSize: 14, textDecorationLine: 'underline' },
        resultActions: { flexDirection: 'row', gap: 8 },
        next: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 48, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 8, backgroundColor: p.accent.primary },
        nextLabel: { color: '#fff', fontSize: 16, fontWeight: '500' },
        back: { minHeight: 48, paddingHorizontal: 20, paddingVertical: 12, justifyContent: 'center', alignItems: 'center', borderRadius: 8, backgroundColor: p.bg.secondary },
        backLabel: { color: p.text.muted, fontSize: 16 },
        disabled: { opacity: 0.45 },
    });
}
