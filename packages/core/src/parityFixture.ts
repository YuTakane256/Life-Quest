import { CHARACTER_CONFIG, calculateLevel } from './progression.ts';
import { BATTLE_CONFIG } from './battle.ts';
import type { Equipment } from './equipment.ts';
import { EQUIPMENT_POOL } from './rewards.ts';
import { convertLegacyGameSnapshot } from './syncSnapshots.ts';

export const PARITY_FIXED_NOW = '2026-08-10T12:00:00.000Z';
export type ParityTheme = 'dark' | 'light';

const taskParityState = {
    state: {
        tasks: [
            {
                id: 'parity-plan-week',
                name: '今週の計画を整理する',
                dueDate: null,
                priority: 'high',
                tags: ['仕事'],
                recurrence: 'none',
                completed: false,
                completedAt: null,
                createdAt: '2026-08-01T09:00:00.000Z',
                subtasks: [
                    {
                        id: 'parity-plan-week-draft',
                        name: '優先順位を書き出す',
                        completed: true,
                        completedAt: '2026-08-09T09:00:00.000Z',
                        createdAt: '2026-08-01T09:00:00.000Z',
                    },
                    {
                        id: 'parity-plan-week-review',
                        name: '予定を確認する',
                        completed: false,
                        completedAt: null,
                        createdAt: '2026-08-01T09:00:00.000Z',
                    },
                ],
            },
            {
                id: 'parity-reply-email',
                name: 'メールを返信する',
                dueDate: null,
                priority: 'medium',
                tags: ['連絡'],
                recurrence: 'none',
                completed: false,
                completedAt: null,
                createdAt: '2026-08-02T09:00:00.000Z',
                subtasks: [],
            },
            {
                id: 'parity-completed-walk',
                name: '朝の散歩を記録する',
                dueDate: null,
                priority: 'low',
                tags: ['健康'],
                recurrence: 'none',
                completed: true,
                completedAt: '2026-08-09T10:00:00.000Z',
                createdAt: '2026-08-01T09:00:00.000Z',
                subtasks: [],
            },
        ],
    },
    version: 0,
};

const parityTotalXp = 330;
const parityLevel = calculateLevel(parityTotalXp);
const parityMaxClearedStage = BATTLE_CONFIG.STAGES[1].stage;
const parityCurrentStage = BATTLE_CONFIG.STAGES[2].stage;

function createParityEquipment(id: string, templateId: string, equipped: boolean): Equipment {
    const template = EQUIPMENT_POOL.find((candidate) => candidate.id === templateId);
    if (!template) throw new Error(`Unknown parity equipment template: ${templateId}`);
    return {
        id,
        templateId: template.id,
        name: template.name,
        slot: template.slot,
        rarity: template.rarity,
        attackBonus: template.attackBonus,
        defenseBonus: template.defenseBonus,
        hpBonus: template.hpBonus,
        equipped,
    };
}

const parityGameState = {
    state: {
        character: {
            name: '星見ユウ',
            avatar: 'female',
            level: parityLevel,
            totalXp: parityTotalXp,
            baseAttack: CHARACTER_CONFIG.INITIAL_STATS.attack + (parityLevel - 1) * CHARACTER_CONFIG.STAT_PER_LEVEL.attack,
            baseDefense: CHARACTER_CONFIG.INITIAL_STATS.defense + (parityLevel - 1) * CHARACTER_CONFIG.STAT_PER_LEVEL.defense,
            baseMaxHp: CHARACTER_CONFIG.INITIAL_STATS.maxHp + (parityLevel - 1) * CHARACTER_CONFIG.STAT_PER_LEVEL.maxHp,
        },
        debuff: { active: false, expiresAt: null, multiplier: 1 },
        equipment: [
            createParityEquipment('parity-steel-blade', 'steel_blade', true),
            createParityEquipment('parity-plate-armor', 'plate_armor', true),
            createParityEquipment('parity-gold-amulet', 'gold_amulet', true),
            createParityEquipment('parity-iron-sword', 'iron_sword', false),
            createParityEquipment('parity-chain-mail', 'chain_mail', false),
            createParityEquipment('parity-silver-ring', 'silver_ring', false),
            createParityEquipment('parity-wooden-sword', 'wooden_sword', false),
        ],
        gachaCount: 12,
        chestQueue: [],
        battle: {
            status: 'idle',
            currentStage: parityCurrentStage,
            maxClearedStage: parityMaxClearedStage,
            enemy: null,
            playerHp: CHARACTER_CONFIG.INITIAL_STATS.maxHp + (parityLevel - 1) * CHARACTER_CONFIG.STAT_PER_LEVEL.maxHp,
            logs: [],
            battleUnlocked: true,
            skillCooldowns: {},
            guardTurnsRemaining: 0,
            guardDamageReduction: 0,
            actions: [],
            battleAttemptId: null,
            rewardMode: 'local',
            playerSnapshot: null,
        },
    },
    version: 0,
};

const parityHabitState = {
    state: {
        habits: [
            { id: 'parity-reading', name: '読書を20分続ける', categoryId: 'study', createdAt: '2026-07-20T09:00:00.000Z' },
            { id: 'parity-walk', name: '朝に散歩する', categoryId: 'health', createdAt: '2026-07-21T09:00:00.000Z' },
        ],
        dailyRecords: [
            { habitId: 'parity-reading', date: '2026-08-08', completed: true, memo: '第3章まで読めた' },
            { habitId: 'parity-reading', date: '2026-08-09', completed: true, memo: '' },
            { habitId: 'parity-reading', date: '2026-08-10', completed: true, memo: '朝の読書タイム' },
            { habitId: 'parity-walk', date: '2026-08-08', completed: true, memo: '' },
            { habitId: 'parity-walk', date: '2026-08-09', completed: true, memo: '' },
            { habitId: 'parity-walk', date: '2026-08-10', completed: false, memo: '' },
        ],
        restDays: [],
        allCompleteRewardDates: [],
    },
    version: 0,
};

const parityStatsState = {
    state: {
        taskXpLog: {
            '2026-08-04': 20,
            '2026-08-05': 30,
            '2026-08-06': 40,
            '2026-08-07': 25,
            '2026-08-08': 50,
            '2026-08-09': 35,
            '2026-08-10': 45,
        },
        habitLog: {
            '2026-08-08': { count: 2, allComplete: true },
            '2026-08-09': { count: 2, allComplete: true },
            '2026-08-10': { count: 1, allComplete: false },
        },
    },
    version: 1,
};

function envelope(state: unknown, version = 1): string {
    return JSON.stringify({ state, version });
}

/** Fictional, anonymous reference data; no production store imports or side effects. */
export function createWebParityStorage(theme: ParityTheme = 'dark'): Record<string, string> {
    return {
        'quest-board-tasks': JSON.stringify(taskParityState),
        'quest-board-habits': JSON.stringify(parityHabitState),
        'quest-board-game': JSON.stringify(parityGameState),
        'quest-board-stats': JSON.stringify(parityStatsState),
        'quest-board-title': envelope({ activeTitle: '駆け出し冒険者' }),
        'quest-board-battle-history': envelope({ history: [] }),
        'quest-board-task-sort': envelope({ sortMode: 'dueDate' }),
        'quest-board-habit-sort': envelope({ sortMode: 'createdAt' }),
        'quest-board-theme': envelope({ mode: theme }),
        'quest-board-motion': envelope({ mode: 'reduced' }),
        'quest-board-notifications': envelope({ enabled: false, notifiedTaskIds: [], lastHabitReminderDate: null, habitReminderHour: 20 }),
        'quest-board-login-bonus': envelope({ anonymousState: { lastLoginDate: '2026-08-10', streak: 1 } }, 2),
    };
}

/** Same domain state, adapted only to Mobile's existing persistence envelopes. */
export function createMobileParityStorage(theme: ParityTheme = 'dark'): Record<string, string> {
    const game = convertLegacyGameSnapshot({ game: parityGameState, tasks: taskParityState, habits: parityHabitState });
    return {
        'quest-board-tasks': JSON.stringify(taskParityState),
        'quest-board-habits': envelope({ habits: parityHabitState.state.habits, records: parityHabitState.state.dailyRecords, restDays: [], rewardEligibleDates: [] }, 0),
        'quest-board-game': envelope(game, 2),
        'quest-board-title': envelope({ activeTitle: '駆け出し冒険者' }),
        'quest-board-mobile-stats': envelope({ ...parityStatsState.state, seeded: true }),
        'quest-board-mobile-settings': envelope({ themeMode: theme, motionMode: 'reduced', notificationsEnabled: false, habitReminderHour: 20, notifiedTaskIds: [], lastHabitReminderDate: null }),
        'quest-board-mobile-login-bonus': envelope({ anonymousState: { lastLoginDate: '2026-08-10', streak: 1 } }, 2),
    };
}
