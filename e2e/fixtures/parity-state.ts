import { expect, type Page } from '@playwright/test';
import { CHARACTER_CONFIG, calculateLevel } from '@life-quest/core';
import { BATTLE_CONFIG } from '@life-quest/core/battle';
import type { Equipment } from '@life-quest/core/equipment';
import { EQUIPMENT_POOL } from '@life-quest/core/rewards';

const FIXED_NOW = '2026-08-10T12:00:00.000Z';

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

export const taskParitySnapshotName = 'task-page-dark.png';

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

/** Installs the shared anonymous state used by every Web parity capture. */
export async function installWebParityState(page: Page): Promise<void> {
    await page.clock.install({ time: new Date(FIXED_NOW) });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.addInitScript((state) => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        window.localStorage.setItem('quest-board-tasks', JSON.stringify(state.tasks));
        window.localStorage.setItem('quest-board-habits', JSON.stringify(state.habits));
        window.localStorage.setItem('quest-board-game', JSON.stringify(state.game));
        window.localStorage.setItem('quest-board-stats', JSON.stringify(state.stats));
        window.localStorage.setItem('quest-board-title', JSON.stringify({ state: { activeTitle: '駆け出し冒険者' }, version: 1 }));
        window.localStorage.setItem('quest-board-battle-history', JSON.stringify({ state: { history: [] }, version: 1 }));
        window.localStorage.setItem('quest-board-task-sort', JSON.stringify({ state: { sortMode: 'dueDate' }, version: 1 }));
        window.localStorage.setItem('quest-board-habit-sort', JSON.stringify({ state: { sortMode: 'createdAt' }, version: 1 }));
        window.localStorage.setItem('quest-board-theme', JSON.stringify({ state: { mode: 'dark' }, version: 1 }));
        window.localStorage.setItem('quest-board-motion', JSON.stringify({ state: { mode: 'reduced' }, version: 1 }));
        window.localStorage.setItem('quest-board-notifications', JSON.stringify({
            state: { enabled: false, notifiedTaskIds: [], lastHabitReminderDate: null, habitReminderHour: 20 },
            version: 1,
        }));
        window.localStorage.setItem('quest-board-login-bonus', JSON.stringify({
            state: { anonymousState: { lastLoginDate: '2026-08-10', streak: 1 } },
            version: 2,
        }));
        class ParityNotification {
            static permission: NotificationPermission = 'default';
            static requestPermission = async (): Promise<NotificationPermission> => 'default';
        }
        Object.defineProperty(window, 'Notification', { configurable: true, value: ParityNotification });
        Math.random = () => 0.123456789;
    }, {
        tasks: taskParityState,
        habits: parityHabitState,
        game: parityGameState,
        stats: parityStatsState,
    });
}

/** Waits until the route has its stable first paint before a parity capture. */
export async function waitForWebParityRender(page: Page): Promise<void> {
    await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(Array.from(document.images).map((image) => {
            if (image.complete) return Promise.resolve();
            return new Promise<void>((resolve) => {
                image.addEventListener('load', () => resolve(), { once: true });
                image.addEventListener('error', () => resolve(), { once: true });
            });
        }));
        window.scrollTo(0, 0);
    });
    await expect(page.locator('body')).toBeVisible();
}
