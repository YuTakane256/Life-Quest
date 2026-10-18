import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { type ThemePalette } from '@life-quest/core/designTokens';
import { AVATAR_IMAGES, getChestImage, getItemImage } from '../assets/images';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { usePalette } from '../theme/usePalette';
import { useRewardEventTimers } from '../hooks/useRewardEventTimers';
import { useReducedMotion } from '../hooks/useReducedMotion';

const getReveal = () => useMobileGameStore.getState().pendingChestReveal;
const rarityLabels = { common: 'コモン', uncommon: 'アンコモン', rare: 'レア', epic: 'エピック', legendary: 'レジェンダリー' };
const slotLabels = { weapon: '武器', armor: '防具', accessory: 'アクセサリー' };
type Phase = 'idle' | 'revealing' | 'revealed';

/** Presentation only: rewards are already committed by the existing local/cloud open path. */
export function ChestOpeningOverlay() {
    const event = useMobileGameStore((state) => state.pendingChestReveal);
    const clear = useMobileGameStore((state) => state.clearPendingChestReveal);
    const avatar = useMobileGameStore((state) => state.character.avatar);
    const { palette: p } = usePalette();
    const s = styles(p);
    const router = useRouter();
    const reduced = useReducedMotion();
    const { schedule, isCurrent, active } = useRewardEventTimers(event, getReveal);
    const [phase, setPhase] = useState<Phase>('idle');
    const [canDismiss, setCanDismiss] = useState(false);
    const scale = useRef(new Animated.Value(1)).current;
    const opacity = useRef(new Animated.Value(1)).current;
    const shake = useRef(new Animated.Value(0)).current;

    useEffect(() => { setPhase('idle'); setCanDismiss(false); }, [event]);
    useEffect(() => {
        if (phase === 'revealing') return schedule(() => setPhase('revealed'), 900);
        if (phase === 'revealed') return schedule(() => setCanDismiss(true), 1500);
    }, [phase, schedule]);

    useEffect(() => {
        scale.setValue(phase === 'revealed' && !reduced ? 0.85 : 1); opacity.setValue(1); shake.setValue(0);
        if (!active || reduced) return;
        const animation = phase === 'idle'
            ? Animated.loop(Animated.sequence([
                Animated.timing(shake, { toValue: 1, duration: 400, useNativeDriver: true }),
                Animated.timing(shake, { toValue: -1, duration: 400, useNativeDriver: true }),
            ]))
            : phase === 'revealing'
                ? Animated.parallel([
                    Animated.timing(scale, { toValue: 1.5, duration: 850, useNativeDriver: true }),
                    Animated.timing(opacity, { toValue: 0, duration: 850, useNativeDriver: true }),
                ])
                : Animated.spring(scale, { toValue: 1, useNativeDriver: true });
        animation.start();
        return () => animation.stop();
    }, [active, event, phase, reduced, scale, opacity, shake]);

    if (!event || !active) return null;
    const equipment = event.equipment;
    const starter = event.isStarterCharacter && !equipment;
    const accent = equipment ? p.rarity[equipment.rarity] : starter ? p.chest.blue : p.accent.gold;
    const dismiss = () => { if (isCurrent() && phase === 'revealed' && canDismiss) clear(); };
    const advance = () => {
        if (!isCurrent()) return;
        if (phase === 'idle') setPhase('revealing'); else dismiss();
    };
    const goToBattle = () => {
        if (!isCurrent() || phase !== 'revealed') return;
        clear();
        router.push('/(tabs)/map');
    };
    return (
        <Modal visible transparent animationType={reduced ? 'none' : 'fade'} onRequestClose={dismiss}>
            <View style={s.backdrop}>
                <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button"
                    accessibilityLabel={phase === 'idle' ? '宝箱を開ける' : '宝箱の演出を閉じる'} onPress={advance} />
                {phase !== 'idle' && <View pointerEvents="none" style={[s.glow, { backgroundColor: accent }]} />}
                {phase === 'revealed' && !reduced && <Text pointerEvents="none" style={[s.sparkles, { color: accent }]} accessibilityElementsHidden>✨ ✦ ✨</Text>}
                <Animated.View pointerEvents={phase === 'revealed' ? 'auto' : 'none'} style={[s.content, {
                    opacity, transform: [{ scale }, { rotate: shake.interpolate({ inputRange: [-1, 1], outputRange: ['-4deg', '4deg'] }) }],
                }]}>
                    {phase !== 'revealed' ? (
                        <>
                            <Animated.Image source={getChestImage(event.chestType)!} style={s.chest} resizeMode="contain" accessibilityLabel={event.label} />
                            <Text style={s.label}>{event.label}</Text>
                            <Text style={s.hint}>{phase === 'idle' ? 'タップして開ける' : '開封中…'}</Text>
                        </>
                    ) : (
                        <ScrollView style={[s.card, { borderColor: accent }]} contentContainerStyle={s.cardContent} accessibilityViewIsModal>
                            {starter ? (
                                <>
                                    <Animated.Image source={AVATAR_IMAGES[avatar]} style={s.item} resizeMode="cover" accessibilityLabel="解放したキャラクター" />
                                    <Text style={[s.title, { color: accent }]} accessibilityRole="header">キャラクター解放！</Text>
                                    <Text style={s.description}>バトルが解放されました</Text>
                                    <Pressable accessibilityRole="button" accessibilityLabel="バトルへ" onPress={goToBattle} style={[s.primary, { marginBottom: 8 }]}>
                                        <Text style={s.primaryText}>⚔️ バトルへ</Text>
                                    </Pressable>
                                </>
                            ) : equipment ? (
                                <>
                                    {getItemImage(equipment.templateId) ? <Animated.Image source={getItemImage(equipment.templateId)!} style={s.item} resizeMode="contain" accessibilityLabel={equipment.name} /> : <Text style={s.fallback}>⚔️</Text>}
                                    <Text style={[s.badge, { color: accent }]}>{rarityLabels[equipment.rarity]} · {slotLabels[equipment.slot]}</Text>
                                    <Text style={[s.title, { color: accent }]} accessibilityRole="header">{equipment.name}</Text>
                                    {([['攻撃', equipment.attackBonus], ['防御', equipment.defenseBonus], ['HP', equipment.hpBonus]] as const)
                                        .filter(([, value]) => value > 0).map(([label, value]) => (
                                            <View key={label} style={s.stat}><Text style={s.statLabel}>{label}</Text><Text style={s.statValue}>+{value}</Text></View>
                                        ))}
                                </>
                            ) : <Text style={[s.title, { color: accent }]} accessibilityRole="header">宝箱を開封しました</Text>}
                            <Pressable accessibilityRole="button" accessibilityLabel={equipment ? 'インベントリに追加' : '閉じる'}
                                disabled={!canDismiss} accessibilityState={{ disabled: !canDismiss }} onPress={dismiss}
                                style={[equipment ? s.primary : s.secondary, !canDismiss && { opacity: 0.5 }]}>
                                <Text style={equipment ? s.primaryText : s.secondaryText}>{equipment ? 'インベントリに追加' : '閉じる'}</Text>
                            </Pressable>
                        </ScrollView>
                    )}
                </Animated.View>
            </View>
        </Modal>
    );
}

function styles(p: ThemePalette) {
    return StyleSheet.create({
        backdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16, backgroundColor: 'rgba(0,0,0,0.82)' },
        content: { width: '100%', maxWidth: 384, maxHeight: '90%', alignItems: 'center' },
        chest: { width: 192, height: 192 },
        label: { color: p.text.primary, fontSize: 18, fontWeight: '700', marginTop: 32, textAlign: 'center' },
        hint: { color: p.text.muted, fontSize: 14, marginTop: 8 },
        glow: { position: 'absolute', width: 300, height: 300, borderRadius: 150, opacity: 0.2 },
        card: { width: '100%', borderWidth: 2, borderRadius: 24, backgroundColor: p.bg.card },
        cardContent: { paddingHorizontal: 28, paddingVertical: 32, alignItems: 'center' },
        sparkles: { position: 'absolute', top: '20%', fontSize: 28, textAlign: 'center' },
        item: { width: 96, height: 96, borderRadius: 12, marginBottom: 12 },
        fallback: { fontSize: 64 },
        badge: { fontSize: 12, fontWeight: '700', marginBottom: 8 },
        title: { fontSize: 24, fontWeight: '800', textAlign: 'center', marginBottom: 4 },
        description: { color: p.text.secondary, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 20 },
        stat: { width: '100%', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, backgroundColor: p.bg.secondary, marginBottom: 8 },
        statLabel: { color: p.text.secondary, fontSize: 14 }, statValue: { color: p.accent.emerald, fontSize: 14, fontWeight: '700' },
        primary: { width: '100%', minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 12, padding: 12, backgroundColor: p.accent.primary },
        secondary: { width: '100%', minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 12, padding: 12, backgroundColor: p.bg.secondary },
        primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' }, secondaryText: { color: p.text.secondary, fontSize: 14 },
    });
}
