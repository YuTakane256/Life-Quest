/**
 * バトル設定とターン処理の共有ロジック（#509 core化 / ADR-002・ADR-010）。
 *
 * Web `useGameStore` のバトル計算と数値・ログ・状態遷移が完全に一致する
 * 純関数エンジンを提供する。Web / Mobile / Edge Function（#502の
 * resolve_battle_attempt によるサーバー側勝敗再計算）の3箇所が
 * この実装を共有し、二重実装を作らない。
 */
import {
    BATTLE_SKILL_CONFIG,
    getUnlockedBattleSkills,
    resolveBattleSkill,
    type BattleSkillDefinition,
} from './battleSkills.ts';

// ─── ステージ・マップ設定（旧 src/config/gameConfig.ts から移動） ───

export interface StageDefinition {
    stage: number;
    name: string;
    hp: number;
    attack: number;
    defense: number;
    xpReward: number;
}

export const BATTLE_CONFIG = {
    /** ステージ別の敵データ */
    STAGES: [
        // ─── マップ1: 草原エリア (ステージ1〜10) ───
        { stage: 1, name: 'スライム', hp: 30, attack: 3, defense: 1, xpReward: 5 },
        { stage: 2, name: 'ゴブリン', hp: 50, attack: 5, defense: 2, xpReward: 10 },
        { stage: 3, name: '大コウモリ', hp: 70, attack: 7, defense: 3, xpReward: 15 },
        { stage: 4, name: '角ウサギ', hp: 90, attack: 9, defense: 4, xpReward: 20 },
        { stage: 5, name: '毒ヘビ', hp: 110, attack: 11, defense: 5, xpReward: 25 },
        { stage: 6, name: 'オーク', hp: 140, attack: 14, defense: 6, xpReward: 30 },
        { stage: 7, name: 'ワイルドボア', hp: 170, attack: 16, defense: 8, xpReward: 35 },
        { stage: 8, name: 'トレント', hp: 210, attack: 18, defense: 10, xpReward: 45 },
        { stage: 9, name: 'ダイアウルフ', hp: 260, attack: 22, defense: 12, xpReward: 55 },
        { stage: 10, name: 'ミノタウロス', hp: 350, attack: 28, defense: 15, xpReward: 80 },
        // ─── マップ2: 古城エリア (ステージ11〜20) ───
        { stage: 11, name: 'スケルトン', hp: 300, attack: 25, defense: 12, xpReward: 70 },
        { stage: 12, name: 'ゾンビ', hp: 380, attack: 28, defense: 14, xpReward: 85 },
        { stage: 13, name: 'ゴースト', hp: 350, attack: 32, defense: 10, xpReward: 95 },
        { stage: 14, name: 'ガーゴイル', hp: 450, attack: 30, defense: 20, xpReward: 110 },
        { stage: 15, name: 'リビングアーマー', hp: 550, attack: 28, defense: 25, xpReward: 125 },
        { stage: 16, name: 'ワイト', hp: 480, attack: 35, defense: 18, xpReward: 140 },
        { stage: 17, name: 'ゴーレム', hp: 650, attack: 32, defense: 28, xpReward: 160 },
        { stage: 18, name: 'ヴァンパイア', hp: 600, attack: 40, defense: 22, xpReward: 180 },
        { stage: 19, name: 'デーモン', hp: 750, attack: 45, defense: 25, xpReward: 210 },
        { stage: 20, name: 'デスナイト', hp: 1000, attack: 55, defense: 30, xpReward: 300 },
        // ─── マップ3: 天界エリア (ステージ21〜30) ───
        { stage: 21, name: 'ケルブ', hp: 900, attack: 50, defense: 30, xpReward: 250 },
        { stage: 22, name: 'ペガサス', hp: 1100, attack: 55, defense: 35, xpReward: 300 },
        { stage: 23, name: '光の精霊', hp: 1300, attack: 65, defense: 40, xpReward: 350 },
        { stage: 24, name: 'エンジェル', hp: 1500, attack: 70, defense: 45, xpReward: 400 },
        { stage: 25, name: 'ヴァルキリー', hp: 1800, attack: 80, defense: 50, xpReward: 500 },
        { stage: 26, name: 'グリフォン', hp: 2200, attack: 90, defense: 60, xpReward: 600 },
        { stage: 27, name: 'セラフ', hp: 2800, attack: 110, defense: 70, xpReward: 800 },
        { stage: 28, name: 'ホーリーナイト', hp: 3500, attack: 130, defense: 90, xpReward: 1000 },
        { stage: 29, name: 'アークエンジェル', hp: 4500, attack: 160, defense: 110, xpReward: 1500 },
        { stage: 30, name: '光の神', hp: 6000, attack: 200, defense: 150, xpReward: 2500 },
        // ─── マップ4: 深海エリア (ステージ31〜40) ───
        { stage: 31, name: 'ジャイアントクラブ', hp: 8000, attack: 250, defense: 180, xpReward: 3000 },
        { stage: 32, name: 'サハギン', hp: 10000, attack: 280, defense: 200, xpReward: 3500 },
        { stage: 33, name: 'マーマン', hp: 12000, attack: 320, defense: 220, xpReward: 4000 },
        { stage: 34, name: 'セイレーン', hp: 15000, attack: 350, defense: 250, xpReward: 5000 },
        { stage: 35, name: '水の精霊', hp: 18000, attack: 400, defense: 280, xpReward: 6000 },
        { stage: 36, name: 'キラーシャーク', hp: 22000, attack: 450, defense: 320, xpReward: 7500 },
        { stage: 37, name: 'シーサーペント', hp: 28000, attack: 500, defense: 380, xpReward: 9000 },
        { stage: 38, name: 'クラーケン', hp: 35000, attack: 600, defense: 450, xpReward: 12000 },
        { stage: 39, name: 'ウォータードラゴン', hp: 45000, attack: 750, defense: 550, xpReward: 16000 },
        { stage: 40, name: 'リヴァイアサン', hp: 60000, attack: 1000, defense: 700, xpReward: 25000 },
    ] as const,

    /** バトルのターン間隔（ミリ秒） */
    TURN_INTERVAL_MS: 1000,

    /** ダメージ計算式: attack - defense * DEFENSE_FACTOR (最低1ダメージ) */
    DEFENSE_FACTOR: 0.5,
    MIN_DAMAGE: 1,

    /** バトル履歴の最大保持件数（先頭追加・上限カット） */
    BATTLE_HISTORY_MAX_ENTRIES: 50,

    /** リプレイ時の1ログあたりの進行間隔（ミリ秒） */
    REPLAY_LOG_INTERVAL_MS: 600,
} as const;

export const MAX_STAGE = BATTLE_CONFIG.STAGES[BATTLE_CONFIG.STAGES.length - 1]?.stage ?? 1;

export function getStageDefinition(stage: number): StageDefinition | undefined {
    return BATTLE_CONFIG.STAGES.find((candidate) => candidate.stage === stage);
}

export interface MapDefinition {
    id: number;
    name: string;
    theme: string;
    stageRange: [number, number]; // [start, end] (inclusive)
}

export const MAP_CONFIG: readonly MapDefinition[] = [
    { id: 1, name: '草原エリア', theme: 'grassland', stageRange: [1, 10] },
    { id: 2, name: '古城エリア', theme: 'castle', stageRange: [11, 20] },
    { id: 3, name: '天界エリア', theme: 'heaven', stageRange: [21, 30] },
    { id: 4, name: '深海エリア', theme: 'deep_sea', stageRange: [31, 40] },
] as const;

/** ステージ番号 → 敵画像キーのマッピング */
export const ENEMY_IMAGE_KEYS: Record<number, string> = {
    // マップ1: 草原
    1: 'slime',
    2: 'goblin',
    3: 'bat',
    4: 'rabbit',
    5: 'snake',
    6: 'orc',
    7: 'boar',
    8: 'treant',
    9: 'wolf',
    10: 'minotaur',
    // マップ2: 古城
    11: 'skeleton',
    12: 'zombie',
    13: 'ghost',
    14: 'gargoyle',
    15: 'living_armor',
    16: 'wight',
    17: 'golem',
    18: 'vampire',
    19: 'demon',
    20: 'death_knight',
    // マップ3: 天界
    21: 'cherub',
    22: 'pegasus',
    23: 'light_elemental',
    24: 'angel',
    25: 'valkyrie',
    26: 'griffin',
    27: 'seraph',
    28: 'holy_knight',
    29: 'archangel',
    30: 'god_of_light',
    // マップ4: 深海
    31: 'giant_crab',
    32: 'sahagin',
    33: 'merman',
    34: 'siren',
    35: 'water_elemental',
    36: 'killer_shark',
    37: 'sea_serpent',
    38: 'kraken',
    39: 'water_dragon',
    40: 'leviathan',
};

// ─── ダメージ・状態の基礎計算（旧 src/utils/gameCalculations.ts から移動） ───

export function calculateDamage(attack: number, defense: number): number {
    const damage = Math.floor(attack - defense * BATTLE_CONFIG.DEFENSE_FACTOR);
    return Math.max(damage, BATTLE_CONFIG.MIN_DAMAGE);
}

export function tickSkillCooldowns(cooldowns: Readonly<Record<string, number>>): Record<string, number> {
    return Object.fromEntries(
        Object.entries(cooldowns)
            .map(([skillId, turns]) => [skillId, Math.max(0, turns - 1)] as const)
            .filter(([, turns]) => turns > 0)
    );
}

export function getGuardReduction(
    guard: { guardTurnsRemaining: number; guardDamageReduction: number },
    maxDamageReduction: number,
): number {
    return guard.guardTurnsRemaining > 0
        ? Math.max(0, Math.min(maxDamageReduction, guard.guardDamageReduction))
        : 0;
}

// ─── ターン処理エンジン（純関数） ────────────────────────────────

/** プレイヤーの実効ステータス（装備込み。サーバーでは player_snapshot として確定される） */
export interface BattlePlayerStats {
    attack: number;
    defense: number;
    maxHp: number;
}

/** 敵スナップショット（サーバーでは enemy_snapshot として確定される） */
export interface BattleEnemySnapshot {
    stage: number;
    name: string;
    maxHp: number;
    attack: number;
    defense: number;
    xpReward: number;
}

export interface BattleActors {
    player: BattlePlayerStats;
    enemy: BattleEnemySnapshot;
    playerLevel: number;
    playerName: string;
}

export interface BattleTurnLog {
    turn: number;
    message: string;
    playerHp: number;
    enemyHp: number;
}

export type BattleOutcome = 'ongoing' | 'victory' | 'defeat';

export interface BattleEngineState {
    enemyHp: number;
    playerHp: number;
    skillCooldowns: Record<string, number>;
    guardTurnsRemaining: number;
    guardDamageReduction: number;
    logs: BattleTurnLog[];
    outcome: BattleOutcome;
}

export type BattleAction = { type: 'attack' } | { type: 'skill'; skillId: string };

export interface BattleActionResult {
    state: BattleEngineState;
    /** falseなら行動は無効（クールダウン中・未解放スキル等）で、stateは変化していない */
    valid: boolean;
}

export function createBattleEngineState(actors: BattleActors): BattleEngineState {
    return {
        enemyHp: actors.enemy.maxHp,
        playerHp: actors.player.maxHp,
        skillCooldowns: {},
        guardTurnsRemaining: 0,
        guardDamageReduction: 0,
        logs: [],
        outcome: 'ongoing',
    };
}

interface EnemyAttackInput {
    playerHp: number;
    enemyHp: number;
    guardTurnsRemaining: number;
    guardDamageReduction: number;
}

/** 敵の反撃1回分。Webの反撃計算（ガード軽減・最低ダメージ・ガード残ターン減衰）と同一。 */
function enemyAttackPhase(input: EnemyAttackInput, actors: BattleActors) {
    const guardReduction = getGuardReduction(input, BATTLE_SKILL_CONFIG.MAX_DAMAGE_REDUCTION);
    const baseEnemyDamage = calculateDamage(actors.enemy.attack, actors.player.defense);
    const enemyDamage = Math.max(
        BATTLE_CONFIG.MIN_DAMAGE,
        Math.floor(baseEnemyDamage * (1 - guardReduction)),
    );
    const newPlayerHp = Math.max(0, input.playerHp - enemyDamage);
    const nextGuardTurnsRemaining = guardReduction > 0 ? Math.max(0, input.guardTurnsRemaining - 1) : 0;
    return {
        guardReduction,
        enemyDamage,
        newPlayerHp,
        nextGuardTurnsRemaining,
        nextGuardDamageReduction: nextGuardTurnsRemaining > 0 ? input.guardDamageReduction : 0,
    };
}

/**
 * 1行動（通常攻撃 or スキル）を適用して次の状態を返す。入力は変更しない。
 * Web `useGameStore.processBattleTurn` / `activateBattleSkill` と数値・ログ・
 * 状態遷移が一致する（パリティは battle.test.ts で検証）。
 */
export function applyBattleAction(
    state: BattleEngineState,
    action: BattleAction,
    actors: BattleActors,
): BattleActionResult {
    if (state.outcome !== 'ongoing') return { state, valid: false };

    if (action.type === 'attack') {
        const turn = state.logs.length + 1;
        const playerDamage = calculateDamage(actors.player.attack, actors.enemy.defense);
        const newEnemyHp = Math.max(0, state.enemyHp - playerDamage);
        const logs: BattleTurnLog[] = [...state.logs];
        logs.push({
            turn,
            message: `${actors.playerName}の攻撃！ ${actors.enemy.name}に${playerDamage}ダメージ！`,
            playerHp: state.playerHp,
            enemyHp: newEnemyHp,
        });
        if (newEnemyHp <= 0) {
            return { state: { ...state, enemyHp: 0, logs, outcome: 'victory' }, valid: true };
        }
        const counter = enemyAttackPhase({ ...state, enemyHp: newEnemyHp }, actors);
        logs.push({
            turn,
            message: `${actors.enemy.name}の攻撃！ ${actors.playerName}に${counter.enemyDamage}ダメージ！${counter.guardReduction > 0 ? ' 防御効果で軽減！' : ''}`,
            playerHp: counter.newPlayerHp,
            enemyHp: newEnemyHp,
        });
        return {
            state: {
                enemyHp: newEnemyHp,
                playerHp: counter.newPlayerHp,
                skillCooldowns: tickSkillCooldowns(state.skillCooldowns),
                guardTurnsRemaining: counter.nextGuardTurnsRemaining,
                guardDamageReduction: counter.nextGuardDamageReduction,
                logs,
                outcome: counter.newPlayerHp <= 0 ? 'defeat' : 'ongoing',
            },
            valid: true,
        };
    }

    // スキル行動
    if ((state.skillCooldowns[action.skillId] ?? 0) > 0) return { state, valid: false };
    const skill: BattleSkillDefinition | undefined = getUnlockedBattleSkills(actors.playerLevel)
        .find((candidate) => candidate.id === action.skillId);
    if (!skill) return { state, valid: false };

    const resolution = resolveBattleSkill(skill.id, {
        attack: actors.player.attack,
        currentHp: state.playerHp,
        maxHp: actors.player.maxHp,
    });
    if (!resolution) return { state, valid: false };

    const turn = state.logs.length + 1;
    const logs: BattleTurnLog[] = [...state.logs];
    let enemyHp = state.enemyHp;
    let playerHp = state.playerHp;
    let guardTurnsRemaining = state.guardTurnsRemaining;
    let guardDamageReduction = state.guardDamageReduction;

    if (resolution.type === 'damage') {
        const newEnemyHp = Math.max(0, enemyHp - resolution.damage);
        logs.push({
            turn,
            message: `${resolution.skill.name}！ ${actors.enemy.name}に${resolution.damage}ダメージ！`,
            playerHp,
            enemyHp: newEnemyHp,
        });
        enemyHp = newEnemyHp;
        if (newEnemyHp <= 0) {
            return {
                state: {
                    ...state,
                    enemyHp: 0,
                    logs,
                    skillCooldowns: { ...state.skillCooldowns, [skill.id]: skill.cooldownTurns },
                    outcome: 'victory',
                },
                valid: true,
            };
        }
    } else if (resolution.type === 'heal') {
        if (resolution.heal <= 0) return { state, valid: false };
        playerHp = Math.min(actors.player.maxHp, playerHp + resolution.heal);
        logs.push({
            turn,
            message: `${resolution.skill.name}！ HPを${resolution.heal}回復！`,
            playerHp,
            enemyHp,
        });
    } else {
        guardTurnsRemaining = resolution.durationTurns;
        guardDamageReduction = resolution.damageReduction;
        logs.push({
            turn,
            message: `${resolution.skill.name}！ ${resolution.durationTurns}ターンの間、被ダメージを軽減！`,
            playerHp,
            enemyHp,
        });
    }

    const counter = enemyAttackPhase({ playerHp, enemyHp, guardTurnsRemaining, guardDamageReduction }, actors);
    logs.push({
        turn,
        message: `${actors.enemy.name}の攻撃！ ${actors.playerName}に${counter.enemyDamage}ダメージ！${counter.guardReduction > 0 ? ' 防御効果で軽減！' : ''}`,
        playerHp: counter.newPlayerHp,
        enemyHp,
    });
    return {
        state: {
            enemyHp,
            playerHp: counter.newPlayerHp,
            skillCooldowns: tickSkillCooldowns({
                ...state.skillCooldowns,
                [skill.id]: skill.cooldownTurns + 1,
            }),
            guardTurnsRemaining: counter.nextGuardTurnsRemaining,
            guardDamageReduction: counter.nextGuardDamageReduction,
            logs,
            outcome: counter.newPlayerHp <= 0 ? 'defeat' : 'ongoing',
        },
        valid: true,
    };
}

export interface BattleReplayResult {
    state: BattleEngineState;
    outcome: BattleOutcome;
    /** 無効な行動（クールダウン中・未解放スキル等）が含まれていたらtrue。サーバーは拒否に使う */
    hadInvalidAction: boolean;
}

/** リプレイで許容する最大行動数（サーバーCPUの保護。正規の戦闘はこれを大きく下回る） */
export const BATTLE_REPLAY_MAX_ACTIONS = 1000;

/**
 * 行動列を初期状態から順に適用し、勝敗を独立に確定する（ADR-010）。
 * Edge Function `resolve_battle_attempt` がクライアントの自己申告を信用せず
 * サーバー側で勝敗を再計算するために使う。
 */
export function replayBattle(
    actors: BattleActors,
    actions: readonly BattleAction[],
    maxActions: number = BATTLE_REPLAY_MAX_ACTIONS,
): BattleReplayResult {
    let state = createBattleEngineState(actors);
    let hadInvalidAction = false;
    if (actions.length > maxActions) {
        return { state, outcome: 'ongoing', hadInvalidAction: true };
    }
    for (const action of actions) {
        if (state.outcome !== 'ongoing') break;
        const result = applyBattleAction(state, action, actors);
        if (!result.valid) {
            hadInvalidAction = true;
            break;
        }
        state = result.state;
    }
    return { state, outcome: state.outcome, hadInvalidAction };
}
