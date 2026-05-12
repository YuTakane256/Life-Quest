import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../stores/useGameStore';
import { BATTLE_CONFIG, MAP_CONFIG, ENEMY_IMAGE_KEYS } from '../config/gameConfig';
import { MapPin, Swords, Trophy, Skull, RotateCcw, ChevronRight } from 'lucide-react';
import heroImg from '../assets/images/hero.png';
import heroMaleImg from '../assets/images/hero_male.png';

// ─── 背景画像インポート ───
import bgGrassland from '../assets/images/bg_grassland.png';
import bgCastle from '../assets/images/bg_castle.png';
import bgBattleGrassland from '../assets/images/bg_battle_grassland.png';
import bgBattleCastle from '../assets/images/bg_battle_castle.png';
import bgHeaven from '../assets/images/bg_heaven.png';
import bgBattleHeaven from '../assets/images/bg_battle_heaven.png';

// ─── 敵キャラ画像インポート ───
import enemySlime from '../assets/images/enemy_slime.png';
import enemyGoblin from '../assets/images/enemy_goblin.png';
import enemyBat from '../assets/images/enemy_bat.png';
import enemyRabbit from '../assets/images/enemy_rabbit.png';
import enemySnake from '../assets/images/enemy_snake.png';
import enemyOrc from '../assets/images/enemy_orc.png';
import enemyBoar from '../assets/images/enemy_boar.png';
import enemyTreant from '../assets/images/enemy_treant.png';
import enemyWolf from '../assets/images/enemy_wolf.png';
import enemyMinotaur from '../assets/images/enemy_minotaur.png';
import enemySkeleton from '../assets/images/enemy_skeleton.png';
import enemyZombie from '../assets/images/enemy_zombie.png';
import enemyGhost from '../assets/images/enemy_ghost.png';
import enemyGargoyle from '../assets/images/enemy_gargoyle.png';
import enemyLivingArmor from '../assets/images/enemy_living_armor.png';
import enemyWight from '../assets/images/enemy_wight.png';
import enemyGolem from '../assets/images/enemy_golem.png';
import enemyVampire from '../assets/images/enemy_vampire.png';
import enemyDemon from '../assets/images/enemy_demon.png';
import enemyDeathKnight from '../assets/images/enemy_death_knight.png';
import enemyCherub from '../assets/images/enemy_cherub.png';
import enemyPegasus from '../assets/images/enemy_pegasus.png';
import enemyLightElemental from '../assets/images/enemy_light_elemental.png';
import enemyAngel from '../assets/images/enemy_angel.png';
import enemyValkyrie from '../assets/images/enemy_valkyrie.png';
import enemyGriffin from '../assets/images/enemy_griffin.png';
import enemySeraph from '../assets/images/enemy_seraph.png';
import enemyHolyKnight from '../assets/images/enemy_holy_knight.png';
import enemyArchangel from '../assets/images/enemy_archangel.png';
import enemyGodOfLight from '../assets/images/enemy_god_of_light.png';

// ─── 画像マッピング ───
const MAP_BACKGROUNDS: Record<string, string> = {
    grassland: bgGrassland,
    castle: bgCastle,
    heaven: bgHeaven,
};

const BATTLE_BACKGROUNDS: Record<string, string> = {
    grassland: bgBattleGrassland,
    castle: bgBattleCastle,
    heaven: bgBattleHeaven,
};

const ENEMY_IMAGES: Record<string, string> = {
    slime: enemySlime,
    goblin: enemyGoblin,
    bat: enemyBat,
    rabbit: enemyRabbit,
    snake: enemySnake,
    orc: enemyOrc,
    boar: enemyBoar,
    treant: enemyTreant,
    wolf: enemyWolf,
    minotaur: enemyMinotaur,
    skeleton: enemySkeleton,
    zombie: enemyZombie,
    ghost: enemyGhost,
    gargoyle: enemyGargoyle,
    living_armor: enemyLivingArmor,
    wight: enemyWight,
    golem: enemyGolem,
    vampire: enemyVampire,
    demon: enemyDemon,
    death_knight: enemyDeathKnight,
    cherub: enemyCherub,
    pegasus: enemyPegasus,
    light_elemental: enemyLightElemental,
    angel: enemyAngel,
    valkyrie: enemyValkyrie,
    griffin: enemyGriffin,
    seraph: enemySeraph,
    holy_knight: enemyHolyKnight,
    archangel: enemyArchangel,
    god_of_light: enemyGodOfLight,
};

function getEnemyImage(stage: number) {
    const key = ENEMY_IMAGE_KEYS[stage];
    if (key && ENEMY_IMAGES[key]) return { type: 'image' as const, src: ENEMY_IMAGES[key] };
    return { type: 'emoji' as const, emoji: '❓' };
}

function getMapForStage(stage: number) {
    return MAP_CONFIG.find(m => stage >= m.stageRange[0] && stage <= m.stageRange[1]) || MAP_CONFIG[0];
}

export function MapBattlePage() {
    const { battle, character, getEffectiveStats, startBattle, processBattleTurn, resetBattle, advanceStage } = useGameStore();
    const [showVictoryDialog, setShowVictoryDialog] = useState(false);
    const [selectedMapId, setSelectedMapId] = useState(() => {
        // 初期選択マップ: 現在のステージに対応するマップ
        const map = getMapForStage(battle.currentStage);
        return map.id;
    });
    const battleIntervalRef = useRef<number | null>(null);
    const logEndRef = useRef<HTMLDivElement>(null);
    const effectiveStats = getEffectiveStats();

    const selectedMap = MAP_CONFIG.find(m => m.id === selectedMapId) || MAP_CONFIG[0];
    const mapStages = BATTLE_CONFIG.STAGES.filter(
        s => s.stage >= selectedMap.stageRange[0] && s.stage <= selectedMap.stageRange[1]
    );

    // マップロック解除条件
    const isMap2Unlocked = battle.maxClearedStage >= 10;
    const isMap3Unlocked = battle.maxClearedStage >= 20;

    useEffect(() => {
        if (battle.status === 'fighting') {
            battleIntervalRef.current = window.setInterval(() => {
                processBattleTurn();
            }, BATTLE_CONFIG.TURN_INTERVAL_MS);
        }
        return () => {
            if (battleIntervalRef.current) {
                clearInterval(battleIntervalRef.current);
                battleIntervalRef.current = null;
            }
        };
    }, [battle.status, processBattleTurn]);

    useEffect(() => {
        if (battle.status === 'victory') setShowVictoryDialog(true);
    }, [battle.status]);

    useEffect(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), [battle.logs]);

    // マップ未解放
    if (!battle.battleUnlocked) {
        return (
            <div className="max-w-lg mx-auto px-4 pt-6">
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

        return (
            <div className="max-w-lg mx-auto px-5 pt-6 pb-4 relative z-0">
                {/* 背景画像オーバーレイ */}
                <div className="fixed inset-0 -z-10 bg-cover bg-center"
                    style={{
                        backgroundImage: `url(${BATTLE_BACKGROUNDS[currentMap.theme]})`,
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
                        <div className="text-sm font-bold mb-1 text-center truncate" style={{ color: 'var(--color-text-primary)' }}>{character.name} <span style={{ color: 'var(--color-accent-gold)' }}>Lv.{character.level}</span></div>
                        <div className="flex items-center gap-2">
                            <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                                <div className="h-full rounded-full transition-all duration-300" style={{
                                    width: `${(battle.playerHp / effectiveStats.maxHp) * 100}%`,
                                    backgroundColor: battle.playerHp / effectiveStats.maxHp > 0.3 ? 'var(--color-accent-emerald)' : 'var(--color-text-danger)'
                                }} />
                            </div>
                            <span className="text-sm font-bold min-w-[40px] text-right" style={{ color: 'var(--color-text-primary)' }}>{battle.playerHp}</span>
                        </div>
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
                        <div className="flex items-center gap-2">
                            <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                                <div className="h-full rounded-full transition-all duration-300" style={{
                                    width: `${battle.enemy ? (battle.enemy.hp / battle.enemy.maxHp) * 100 : 0}%`,
                                    backgroundColor: 'var(--color-text-danger)'
                                }} />
                            </div>
                            <span className="text-sm font-bold min-w-[40px] text-right" style={{ color: 'var(--color-text-primary)' }}>{battle.enemy?.hp ?? 0}</span>
                        </div>
                    </div>
                </div>

                {/* バトルログ */}
                <div className="rounded-xl p-4 mb-4 h-52 overflow-y-auto" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
                    {battle.logs.map((log, i) => (
                        <div key={i} className="text-sm py-1 animate-fade-in" style={{ color: 'var(--color-text-secondary)' }}>
                            <span style={{ color: 'var(--color-text-muted)' }}>[{log.turn}] </span>{log.message}
                        </div>
                    ))}
                    <div ref={logEndRef} />
                </div>

                {/* 勝利ダイアログ */}
                {battle.status === 'victory' && showVictoryDialog && (
                    <div className="rounded-xl p-5 text-center animate-fade-in mb-4" style={{ backgroundColor: 'var(--color-bg-card)', border: '2px solid var(--color-accent-gold)' }}>
                        <Trophy size={48} className="mx-auto mb-2" style={{ color: 'var(--color-accent-gold)' }} />
                        <h3 className="text-xl font-bold mb-1" style={{ color: 'var(--color-accent-gold)' }}>勝利！</h3>
                        <p className="text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>{battle.enemy?.xpReward} XP を獲得！</p>
                        <div className="flex gap-2">
                            <button onClick={() => {
                                const nextStage = Math.min(battle.currentStage + 1, BATTLE_CONFIG.STAGES.length);
                                advanceStage();
                                startBattle(nextStage);
                                setShowVictoryDialog(false);
                            }}
                                className="flex-1 py-3 rounded-lg text-base font-medium flex items-center justify-center gap-1"
                                style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>
                                <ChevronRight size={18} /> 次へ
                            </button>
                            <button onClick={() => { resetBattle(); setShowVictoryDialog(false); }}
                                className="px-5 py-3 rounded-lg text-base"
                                style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}>
                                マップへ
                            </button>
                        </div>
                    </div>
                )}

                {/* 敗北ダイアログ */}
                {battle.status === 'defeat' && (
                    <div className="rounded-xl p-5 text-center animate-fade-in" style={{ backgroundColor: 'var(--color-bg-card)', border: '2px solid var(--color-text-danger)' }}>
                        <Skull size={48} className="mx-auto mb-2" style={{ color: 'var(--color-text-danger)' }} />
                        <h3 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text-danger)' }}>敗北...</h3>
                        <p className="text-sm mb-4" style={{ color: 'var(--color-text-secondary)' }}>レベルを上げて再挑戦しましょう！</p>
                        <div className="flex gap-2">
                            <button onClick={() => startBattle(battle.currentStage)}
                                className="flex-1 py-3 rounded-lg text-base font-medium flex items-center justify-center gap-1"
                                style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}>
                                <RotateCcw size={18} /> リトライ
                            </button>
                            <button onClick={resetBattle}
                                className="px-5 py-3 rounded-lg text-base"
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
        <div className="max-w-lg mx-auto px-5 pt-6 pb-4 relative overflow-hidden z-0">
            {/* 背景画像 */}
            <div className="fixed inset-0 -z-10 bg-cover bg-center"
                style={{ backgroundImage: `url(${MAP_BACKGROUNDS[selectedMap.theme]})`, opacity: 0.35 }} />

            <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--color-text-primary)' }}>マップ</h1>
            <p className="text-base mb-4" style={{ color: 'var(--color-text-muted)' }}>最高到達: ステージ {battle.maxClearedStage || '-'}</p>

            {/* マップ切り替えタブ */}
            <div className="flex gap-2 mb-4">
                {MAP_CONFIG.map((map) => {
                    const isLocked = (map.id === 2 && !isMap2Unlocked) || (map.id === 3 && !isMap3Unlocked);
                    const isSelected = map.id === selectedMapId;
                    return (
                        <button
                            key={map.id}
                            onClick={() => !isLocked && setSelectedMapId(map.id)}
                            disabled={isLocked}
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
                                <button onClick={() => startBattle(stage.stage)}
                                    className="px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1 transition-colors"
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
        </div>
    );
}
