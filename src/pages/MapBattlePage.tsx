import { blocksBattleStart, type BattleResultRecoveryState } from '@life-quest/core/battleResultRecovery';
import { battleResultRecovery, withWebBattleRecoverySession } from '../platform/battleResultRecovery';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useGameStore } from '../stores/useGameStore';
import { useBattleHistoryStore } from '../stores/useBattleHistoryStore';
import { BATTLE_CONFIG, MAP_CONFIG, ENEMY_IMAGE_KEYS } from '../config/gameConfig';
import { getMapForStage, getMapStages, hasPendingBattleResult, isMapUnlocked } from '@life-quest/core/battle';
import { Swords, Trophy, Skull, RotateCcw, ChevronRight } from 'lucide-react';
import { BattleReplayModal } from '../components/ui/BattleReplayModal';
import { HpBar } from '../components/ui/HpBar';
import { BattleLogList } from '../components/ui/BattleLogList';
import { BattleHistoryPanel } from '../components/ui/BattleHistoryPanel';
import type { BattleHistoryEntry } from '../types';
import type { BattleSkillDefinition } from '../config/battleSkills';
import { getUnlockedBattleSkills } from '../utils/battleSkills';
import { getBattleBackground, getMapBackground } from '../config/mapAssets';
import heroImg from '@life-quest/assets/images/hero.png';
import heroMaleImg from '@life-quest/assets/images/hero_male.png';
import { getEnemyImageSrc } from '../config/enemyImages';
import { useBattleResult } from '../hooks/useBattleResult';
import { useBattleStart } from '../hooks/useBattleStart';
import { useAutomaticBattle } from '../hooks/useAutomaticBattle';


function getEnemyImage(stage: number) {
    const key = ENEMY_IMAGE_KEYS[stage];
    const src = key ? getEnemyImageSrc(key) : null;
    if (src) return { type: 'image' as const, src };
    return { type: 'emoji' as const, emoji: '❓' };
}

function getSkillTone(skill: BattleSkillDefinition): { icon: string; color: string } {
    if (skill.type === 'damage') return { icon: '⚔️', color: 'var(--color-accent-rose)' };
    if (skill.type === 'heal') return { icon: '💚', color: 'var(--color-accent-emerald)' };
    return { icon: '🛡️', color: 'var(--color-accent-sky)' };
}

export function MapBattlePage() {
    const { battle, character, getEffectiveStats, resetBattle, advanceStage, activateBattleSkill } = useGameStore();
    const history = useBattleHistoryStore((s) => s.history);
    const [showVictoryDialog, setShowVictoryDialog] = useState(false);
    const [selectedMapId, setSelectedMapId] = useState(() => {
        // 初期選択マップ: 現在のステージに対応するマップ
        const map = getMapForStage(battle.currentStage);
        return map.id;
    });
    const [replayEntry, setReplayEntry] = useState<BattleHistoryEntry | null>(null);
    const [showAllHistory, setShowAllHistory] = useState(false);
    const logEndRef = useRef<HTMLDivElement>(null);
    const effectiveStats = getEffectiveStats();
    const { resolveState, granted, retry } = useBattleResult();
    const recovery = useSyncExternalStore(battleResultRecovery.subscribe, battleResultRecovery.getState);
    const recoveryBlocksStart = blocksBattleStart(recovery);
    const [busyRecovery, setBusyRecovery] = useState<BattleResultRecoveryState | null>(null);
    const runRecovery = (work: () => Promise<unknown>) => {
        setBusyRecovery(null);
        void withWebBattleRecoverySession(recovery, work).then((acquired) => {
            if (!acquired) setBusyRecovery(recovery);
        });
    };
    const recoveryBlocked = recovery.phase === 'blocked';
    const recoverySending = recovery.phase === 'sending';
    const recoveryNotice = (recoveryBlocked || (recovery.pending && recovery.pending.attemptId !== battle.battleAttemptId)) && (
        <div className="mb-4 rounded-xl p-4" role="status" style={{ backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-primary)' }}>
            <p className="text-sm">{recoveryBlocked ? '保存した戦闘結果を読み込めませんでした。' : recoverySending ? '保存した戦闘結果を送信中…' : recovery.phase === 'failed' ? '戦闘結果の送信に失敗しました。同じ結果を再送できます。' : '保存した戦闘結果を再送できます。'}</p>
            {busyRecovery === recovery && <p className="mt-2 text-sm">別のタブで戦闘中か、結果を確認中です。</p>}
            <button type="button" className="mt-2 text-sm font-semibold underline disabled:opacity-50" disabled={recoverySending}
                style={{ color: 'var(--color-accent-primary)' }}
                onClick={() => { if (recoveryBlocked) void battleResultRecovery.load();
                    else if (recovery.pending) runRecovery(() => battleResultRecovery.retry(recovery.pending!)); }}>
                {recoveryBlocked ? '保存データを再確認する' : '保存した戦闘結果を再送する'}
            </button>
            {battleResultRecovery.canDiscard(recovery) && (
                <button type="button" className="ml-4 mt-2 text-sm underline"
                    onClick={() => {
                        if (window.confirm('端末に残った戦闘結果を破棄しますか？未送信の報酬は受け取れなくなります。')) {
                            runRecovery(async () => {
                                if (!await battleResultRecovery.discard(recovery)) await battleResultRecovery.load();
                            });
                        }
                    }}>
                    保存した結果を破棄する
                </button>
            )}
        </div>
    );
    const isSyncingResult = hasPendingBattleResult(battle.status === 'victory' || battle.status === 'defeat' ? battle.status : 'ongoing', battle.rewardMode, battle.battleAttemptId)
        || (battle.rewardMode === 'cloud' && resolveState === 'syncing');
    const { isStarting, startError, startStage, retry: retryStart } = useBattleStart();

    const handleNextStage = async () => {
        const nextStage = Math.min(battle.currentStage + 1, BATTLE_CONFIG.STAGES.length);
        // Keep legacy victory progress compatible, without retaining a route-local state setter.
        await startStage(nextStage, advanceStage);
    };

    const requestedMap = MAP_CONFIG.find(m => m.id === selectedMapId) || MAP_CONFIG[0];
    const selectedMap = isMapUnlocked(requestedMap, battle.maxClearedStage, battle.battleUnlocked)
        ? requestedMap : MAP_CONFIG[0];
    const mapStages = getMapStages(selectedMap);

    useAutomaticBattle(battle);

    useEffect(() => {
        if (battle.status === 'victory') setShowVictoryDialog(true);
    }, [battle.status]);

    useEffect(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), [battle.logs]);

    // マップ未解放
    if (!battle.battleUnlocked) {
        return (
            <div className="app-page max-w-lg mx-auto px-4 pt-6">
                {recoveryNotice}
                <div className="text-center py-20">
                    <div className="w-20 h-20 mx-auto rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: 'var(--color-bg-card)' }}>
                        <span className="text-4xl">🔒</span>
                    </div>
                    <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>マップ未解放</h2>
                    <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                        タスクを5つ消化して青色の宝箱を<br />手に入れると解放されます！
                    </p>
                </div>
            </div>
        );
    }

    // バトル中・勝利・敗北
    if (battle.status === 'fighting' || battle.status === 'victory' || battle.status === 'defeat') {
        const currentMap = getMapForStage(battle.currentStage);
        const enemyVisual = getEnemyImage(battle.currentStage);
        const unlockedSkills = getUnlockedBattleSkills(battle.playerSnapshot?.level ?? character.level);
        const playerName = battle.playerSnapshot?.name ?? character.name;
        const playerLevel = battle.playerSnapshot?.level ?? character.level;

        return (
            <div className="app-page max-w-lg mx-auto px-5 pt-6 pb-4 relative z-0">
                {recoveryNotice}
                {/* 背景画像オーバーレイ */}
                <div className="fixed inset-0 -z-10 bg-cover bg-center"
                    style={{
                        backgroundImage: `url(${getBattleBackground(currentMap.theme)})`,
                        opacity: 0.5
                    }} />

                <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>
                    ⚔️ {currentMap.name} — ステージ {battle.currentStage}: {battle.enemy?.name}
                </h2>

                {/* バトルフィールド */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                    {/* プレイヤー */}
                    <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
                        <div className="flex justify-center mb-2">
                            <div className="w-28 h-28 rounded-lg overflow-hidden shadow-lg" style={{ background: 'linear-gradient(135deg, var(--color-accent-primary), var(--color-accent-secondary))' }}>
                                <img src={character.avatar === 'male' ? heroMaleImg : heroImg} alt="Player" className="w-full h-full object-cover" />
                            </div>
                        </div>
                        <div className="text-sm font-bold mb-1 text-center truncate" style={{ color: 'var(--color-text-primary)' }}>{playerName} <span style={{ color: 'var(--color-accent-gold)' }}>Lv.{playerLevel}</span></div>
                        <HpBar current={battle.playerHp} max={battle.playerSnapshot?.maxHp ?? effectiveStats.maxHp} color="player" height="md" label={`${playerName} のHP`} />
                    </div>

                    {/* 敵 */}
                    <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
                        <div className="flex justify-center mb-2">
                            <div className="w-28 h-28 rounded-lg overflow-hidden flex items-center justify-center shadow-lg" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                                {enemyVisual.type === 'image' ? (
                                    <img src={enemyVisual.src} alt={battle.enemy?.name || 'Enemy'} className="w-24 h-24 object-contain animate-pulse" style={{ animationDuration: '3s' }} />
                                ) : (
                                    <span className="text-5xl">{enemyVisual.emoji}</span>
                                )}
                            </div>
                        </div>
                        <div className="text-sm font-bold mb-1 text-center" style={{ color: 'var(--color-text-danger)' }}>{battle.enemy?.name}</div>
                        <HpBar current={battle.enemy?.hp ?? 0} max={battle.enemy?.maxHp ?? 1} color="enemy" height="md" label={`${battle.enemy?.name ?? '敵'} のHP`} />
                    </div>
                </div>

                {battle.status === 'fighting' && unlockedSkills.length > 0 && (
                    <div className="rounded-xl p-3 mb-4" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
                        <div className="flex items-center justify-between gap-2 mb-2">
                            <h3 className="text-sm font-bold" style={{ color: 'var(--color-text-primary)' }}>スキル</h3>
                            {battle.guardTurnsRemaining > 0 && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--color-accent-sky)', color: 'white' }}>
                                    防御 {battle.guardTurnsRemaining}T
                                </span>
                            )}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {unlockedSkills.map((skill) => {
                                const cooldown = battle.skillCooldowns[skill.id] ?? 0;
                                const tone = getSkillTone(skill);
                                return (
                                    <button
                                        key={skill.id}
                                        type="button"
                                        onClick={() => activateBattleSkill(skill.id)}
                                        disabled={cooldown > 0}
                                        title={skill.description}
                                        className="min-h-[64px] rounded-lg px-2 py-2 flex flex-col items-center justify-center gap-1 transition-all active:scale-95 disabled:opacity-45 disabled:cursor-not-allowed"
                                        style={{
                                            backgroundColor: 'var(--color-bg-secondary)',
                                            color: cooldown > 0 ? 'var(--color-text-muted)' : tone.color,
                                            border: `1px solid ${cooldown > 0 ? 'var(--color-border-default)' : tone.color}`,
                                        }}
                                    >
                                        <span className="text-base" aria-hidden="true">{tone.icon}</span>
                                        <span className="text-[11px] font-bold leading-tight">{skill.name}</span>
                                        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                                            {cooldown > 0 ? `あと${cooldown}T` : '使用可'}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* バトルログ */}
                <BattleLogList
                    logs={battle.logs}
                    autoScroll={true}
                    className={`rounded-xl p-4 mb-4 ${battle.status === 'fighting' ? 'h-52' : 'h-32'}`}
                    style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
                />

                {startError && battle.status !== 'victory' && (
                    <p role="alert" className="text-sm mb-4" style={{ color: 'var(--color-text-danger)' }}>
                        {startError}
                        <button onClick={() => void retryStart()} disabled={isStarting || recoveryBlocksStart} className="underline ml-2 disabled:opacity-50" style={{ color: 'var(--color-accent-primary)' }}>再試行</button>
                    </p>
                )}

                {/* 勝利ダイアログ */}
                {battle.status === 'victory' && showVictoryDialog && (
                    <div className="rounded-xl p-5 text-center animate-fade-in mb-4" style={{ backgroundColor: 'var(--color-bg-card)', border: '2px solid var(--color-accent-gold)' }}>
                        <Trophy size={48} className="mx-auto mb-2" style={{ color: 'var(--color-accent-gold)' }} />
                        <h3 className="text-xl font-bold mb-1" style={{ color: 'var(--color-accent-gold)' }}>勝利！</h3>
                        {battle.rewardMode === 'cloud' ? (
                            <p className="text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>
                                {resolveState === 'syncing' && '報酬を同期中…'}
                                {resolveState === 'idle' && (battle.battleAttemptId ? '報酬を同期中…' : '同期済み')}
                                {resolveState === 'done' && (granted
                                    ? `${battle.enemy?.xpReward} XP を獲得！`
                                    : '同期済み（既に付与済みです）')}
                                {resolveState === 'error' && (
                                    <span style={{ color: 'var(--color-text-danger)' }}>
                                        報酬の同期に失敗しました。
                                        <button onClick={retry} className="underline ml-1" style={{ color: 'var(--color-accent-primary)' }}>再送</button>
                                    </span>
                                )}
                            </p>
                        ) : (
                            <p className="text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>{battle.enemy?.xpReward} XP を獲得！</p>
                        )}
                        <div className="flex gap-2">
                            <button onClick={() => void handleNextStage()}
                                disabled={isSyncingResult || isStarting || recoveryBlocksStart}
                                className="flex-1 py-3 rounded-lg text-base font-medium flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                                style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>
                                <ChevronRight size={18} /> {battle.currentStage < BATTLE_CONFIG.STAGES.length ? '次へ' : '再挑戦'}
                            </button>
                            <button onClick={() => { resetBattle(); setShowVictoryDialog(false); }}
                                disabled={isSyncingResult}
                                className="px-5 py-3 rounded-lg text-base disabled:opacity-50 disabled:cursor-not-allowed"
                                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}>
                                マップへ
                            </button>
                        </div>
                        {startError && (
                            <p role="alert" className="text-sm mt-3" style={{ color: 'var(--color-text-danger)' }}>
                                {startError}
                                <button onClick={() => void retryStart()} disabled={isStarting || recoveryBlocksStart} className="underline ml-2 disabled:opacity-50" style={{ color: 'var(--color-accent-primary)' }}>再試行</button>
                            </p>
                        )}
                    </div>
                )}

                {/* 敗北ダイアログ */}
                {battle.status === 'defeat' && (
                    <div className="rounded-xl p-5 text-center animate-fade-in" style={{ backgroundColor: 'var(--color-bg-card)', border: '2px solid var(--color-text-danger)' }}>
                        <Skull size={48} className="mx-auto mb-2" style={{ color: 'var(--color-text-danger)' }} />
                        <h3 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text-danger)' }}>敗北...</h3>
                        <p className="text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>
                            {battle.rewardMode === 'cloud' && resolveState === 'error' ? (
                                <span style={{ color: 'var(--color-text-danger)' }}>
                                    結果の同期に失敗しました。
                                    <button onClick={retry} className="underline ml-1" style={{ color: 'var(--color-accent-primary)' }}>再送</button>
                                </span>
                            ) : isSyncingResult ? '結果を同期中…' : 'レベルを上げて再挑戦しましょう！'}
                        </p>
                        <div className="flex gap-2">
                            <button onClick={() => void startStage(battle.currentStage)}
                                disabled={isSyncingResult || isStarting || recoveryBlocksStart}
                                className="flex-1 py-3 rounded-lg text-base font-medium flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                                style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>
                                <RotateCcw size={18} /> リトライ
                            </button>
                            <button onClick={resetBattle}
                                disabled={isSyncingResult}
                                className="px-5 py-3 rounded-lg text-base disabled:opacity-50 disabled:cursor-not-allowed"
                                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}>
                                マップへ
                            </button>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ─── マップ一覧 ───
    return (
        <div className="app-page max-w-lg mx-auto px-5 pt-6 pb-4 relative overflow-hidden z-0">
            {recoveryNotice}
            {/* 背景画像 */}
            <div className="fixed inset-0 -z-10 bg-cover bg-center"
                style={{ backgroundImage: `url(${getMapBackground(selectedMap.theme)})`, opacity: 0.35 }} />

            <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>マップ</h1>
            <p className="text-base mb-4" style={{ color: 'var(--color-text-muted)' }}>最高到達: ステージ {battle.maxClearedStage || '-'}</p>
            {startError && (
                <p role="alert" className="text-sm mb-4" style={{ color: 'var(--color-text-danger)' }}>
                    {startError}
                    <button onClick={() => void retryStart()} disabled={isStarting || recoveryBlocksStart} className="underline ml-2 disabled:opacity-50" style={{ color: 'var(--color-accent-primary)' }}>再試行</button>
                </p>
            )}

            {/* マップ切り替えタブ */}
            <div className="flex gap-2 mb-4">
                {MAP_CONFIG.map((map) => {
                    const isLocked = !isMapUnlocked(map, battle.maxClearedStage, battle.battleUnlocked);
                    const isSelected = map.id === selectedMap.id;
                    return (
                        <button
                            key={map.id}
                            onClick={() => !isLocked && setSelectedMapId(map.id)}
                            disabled={isLocked}
                            aria-pressed={isSelected}
                            aria-label={isLocked ? `${map.name}（未開放）` : map.name}
                            className="flex-1 py-2 rounded-xl text-sm font-medium transition-all duration-200"
                            style={{
                                backgroundColor: isSelected ? 'var(--color-accent-primary)' : 'var(--color-bg-card)',
                                color: isSelected ? 'white' : isLocked ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
                                border: `1px solid ${isSelected ? 'var(--color-accent-primary)' : 'var(--color-border-default)'}`,
                                opacity: isLocked ? 0.5 : 1,
                                cursor: isLocked ? 'not-allowed' : 'pointer',
                            }}>
                            {isLocked ? '🔒 ' : ''}{map.name}
                        </button>
                    );
                })}
            </div>

            <BattleHistoryPanel
                history={history}
                showAll={showAllHistory}
                onToggleShowAll={() => setShowAllHistory((v) => !v)}
                onSelectEntry={setReplayEntry}
            />

            {/* ステージ一覧 */}
            <div className="flex flex-col gap-2">
                {mapStages.map((stage) => {
                    const isCleared = stage.stage <= battle.maxClearedStage;
                    const isCurrent = stage.stage === battle.currentStage;
                    const isLocked = stage.stage > battle.maxClearedStage + 1;
                    const visual = getEnemyImage(stage.stage);

                    return (
                        <div key={stage.stage}
                            className={`flex items-center gap-4 px-4 py-3.5 rounded-xl transition-all duration-200 ${isCurrent ? 'animate-pulse-glow' : ''}`}
                            style={{
                                backgroundColor: isCleared ? 'var(--color-bg-secondary)' : 'var(--color-bg-card)',
                                border: `1px solid ${isCurrent ? 'var(--color-accent-primary)' : 'var(--color-border-default)'}`,
                                opacity: isLocked ? 0.4 : 1
                            }}>
                            <div className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden"
                                style={{ backgroundColor: isCleared ? 'var(--color-accent-emerald)' : isCurrent ? 'var(--color-accent-primary)' : 'var(--color-bg-secondary)' }}>
                                {isCleared ? '✅' : isLocked ? '🔒' : (
                                    visual.type === 'image' ? (
                                        <img src={visual.src} alt={stage.name} className="w-10 h-10 object-contain" />
                                    ) : (
                                        <span className="text-xl">{visual.emoji}</span>
                                    )
                                )}
                            </div>
                            <div className="flex-1">
                                <div className="text-base font-medium" style={{ color: 'var(--color-text-primary)' }}>
                                    ステージ {stage.stage}: {stage.name}
                                </div>
                                <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                                    HP: {stage.hp} · 攻: {stage.attack} · 防: {stage.defense}
                                </div>
                            </div>
                            {!isLocked && (
                                <button onClick={() => void startStage(stage.stage)}
                                    disabled={isStarting || recoveryBlocksStart}
                                    className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    style={{
                                        backgroundColor: isCleared ? 'var(--color-bg-card)' : 'var(--color-accent-primary)',
                                        color: isCleared ? 'var(--color-text-secondary)' : 'white'
                                    }}>
                                    <Swords size={14} />{isCleared ? '再挑戦' : 'スタート'}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* バトルリプレイモーダル */}
            <BattleReplayModal entry={replayEntry} onClose={() => setReplayEntry(null)} />
        </div>
    );
}
