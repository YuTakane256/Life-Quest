import { chromium } from 'playwright';

const baseUrl = process.env.LIFE_QUEST_URL ?? 'http://127.0.0.1:5173';
const outputDir = new URL('../docs/screenshots/portfolio/', import.meta.url);

const equipment = [
    { id: 'steel-blade', templateId: 'steel_blade', name: '鋼の刃', slot: 'weapon', rarity: 'rare', attackBonus: 10, defenseBonus: 0, hpBonus: 0, equipped: true },
    { id: 'dragon-armor', templateId: 'dragon_armor', name: 'ドラゴンアーマー', slot: 'armor', rarity: 'epic', attackBonus: 3, defenseBonus: 18, hpBonus: 35, equipped: true },
    { id: 'phoenix-ring', templateId: 'phoenix_ring', name: 'フェニックスリング', slot: 'accessory', rarity: 'epic', attackBonus: 8, defenseBonus: 8, hpBonus: 25, equipped: true },
    { id: 'excalibur', templateId: 'excalibur', name: 'エクスカリバー', slot: 'weapon', rarity: 'legendary', attackBonus: 30, defenseBonus: 5, hpBonus: 10, equipped: false },
];

const state = {
    tasks: {
        state: {
            tasks: [
                {
                    id: 'weekly-plan', name: '今週の計画を整理する', dueDate: '2026-08-21', priority: 'high', tags: ['仕事'], recurrence: 'weekly', completed: false, completedAt: null, createdAt: '2026-08-18T09:00:00.000Z',
                    subtasks: [
                        { id: 'plan-priority', name: '優先順位を書き出す', completed: true, completedAt: '2026-08-18T09:30:00.000Z', createdAt: '2026-08-18T09:00:00.000Z' },
                        { id: 'plan-review', name: '予定を確認する', completed: false, completedAt: null, createdAt: '2026-08-18T09:00:00.000Z' },
                    ],
                },
                { id: 'reply', name: 'クライアントへ返信する', dueDate: '2026-08-19', priority: 'medium', tags: ['連絡'], recurrence: 'none', completed: false, completedAt: null, createdAt: '2026-08-18T10:00:00.000Z', subtasks: [] },
            ],
        }, version: 0,
    },
    habits: {
        state: {
            habits: [
                { id: 'reading', name: '読書を20分続ける', categoryId: 'study', createdAt: '2026-07-20T09:00:00.000Z' },
                { id: 'walk', name: '朝に散歩する', categoryId: 'health', createdAt: '2026-07-21T09:00:00.000Z' },
            ],
            dailyRecords: [
                { habitId: 'reading', date: '2026-08-16', completed: true, memo: '第3章まで読めた' },
                { habitId: 'reading', date: '2026-08-17', completed: true, memo: '' },
                { habitId: 'reading', date: '2026-08-18', completed: true, memo: '朝の読書タイム' },
                { habitId: 'reading', date: '2026-08-19', completed: true, memo: '' },
                { habitId: 'walk', date: '2026-08-18', completed: true, memo: '' },
                { habitId: 'walk', date: '2026-08-19', completed: false, memo: '' },
            ],
            restDays: [], allCompleteRewardDates: [],
        }, version: 0,
    },
    game: {
        state: {
            character: { name: '星見ユウ', avatar: 'female', level: 7, totalXp: 760, baseAttack: 16, baseDefense: 14, baseMaxHp: 110 },
            debuff: { active: false, expiresAt: null, multiplier: 1 }, equipment, gachaCount: 48, chestQueue: [],
            battle: {
                status: 'idle', currentStage: 3, maxClearedStage: 2, enemy: null, playerHp: 168, logs: [], battleUnlocked: true,
                skillCooldowns: {}, guardTurnsRemaining: 0, guardDamageReduction: 0, actions: [], battleAttemptId: null, rewardMode: 'local', playerSnapshot: null,
            },
        }, version: 0,
    },
    stats: {
        state: {
            taskXpLog: { '2026-08-13': 20, '2026-08-14': 35, '2026-08-15': 55, '2026-08-16': 30, '2026-08-17': 45, '2026-08-18': 60, '2026-08-19': 40 },
            habitLog: { '2026-08-17': { count: 2, allComplete: true }, '2026-08-18': { count: 2, allComplete: true }, '2026-08-19': { count: 1, allComplete: false } },
        }, version: 1,
    },
};

async function createPage(browser, gameState = state.game) {
    const context = await browser.newContext({ viewport: { width: 500, height: 1050 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce', locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    const page = await context.newPage();
    await page.addInitScript((snapshot) => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        window.localStorage.setItem('quest-board-tasks', JSON.stringify(snapshot.tasks));
        window.localStorage.setItem('quest-board-habits', JSON.stringify(snapshot.habits));
        window.localStorage.setItem('quest-board-game', JSON.stringify(snapshot.game));
        window.localStorage.setItem('quest-board-stats', JSON.stringify(snapshot.stats));
        window.localStorage.setItem('quest-board-title', JSON.stringify({ state: { activeTitle: '駆け出し冒険者' }, version: 1 }));
        window.localStorage.setItem('quest-board-login-bonus', JSON.stringify({ state: { anonymousState: { lastLoginDate: '2026-08-19', streak: 3 } }, version: 2 }));
        window.localStorage.setItem('quest-board-theme', JSON.stringify({ state: { mode: 'dark' }, version: 1 }));
        Math.random = () => 0.8;
    }, { ...state, game: gameState });
    return { context, page };
}

async function save(page, filename) {
    await page.locator('body').waitFor({ state: 'visible' });
    await page.getByText('画面を読み込んでいます...').waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => undefined);
    await page.waitForTimeout(250);
    await page.screenshot({ path: new URL(filename, outputDir).pathname, fullPage: true });
}

const browser = await chromium.launch();

try {
    {
        const { context, page } = await createPage(browser);
        await page.goto(`${baseUrl}/tasks`);
        await page.getByRole('button', { name: '新しいタスクを追加' }).click();
        await page.getByPlaceholder('タスク名を入力...').fill('ポートフォリオのREADMEを仕上げる');
        await save(page, 'web-tasks.png');
        await context.close();
    }

    {
        const { context, page } = await createPage(browser);
        await page.goto(`${baseUrl}/habits`);
        await page.getByRole('button', { name: /読書を20分続ける.*達成履歴を表示/ }).click();
        await save(page, 'web-habits.png');
        await context.close();
    }

    {
        const { context, page } = await createPage(browser);
        await page.goto(`${baseUrl}/character`);
        await save(page, 'web-character.png');
        await context.close();
    }

    {
        const chestGame = structuredClone(state.game);
        chestGame.state.chestQueue = [{ id: 'gold-chest', chestType: 'gold', label: '金の宝箱', opened: false, equipment: null }];
        const { context, page } = await createPage(browser, chestGame);
        await page.goto(`${baseUrl}/character`);
        await page.getByRole('button', { name: '金の宝箱' }).click();
        await page.waitForTimeout(800);
        await save(page, 'web-chest.png');
        await context.close();
    }

    {
        const battleGame = structuredClone(state.game);
        battleGame.state.battle = {
            status: 'fighting', currentStage: 3, maxClearedStage: 2,
            enemy: { stage: 3, name: 'スケルトン', hp: 42, maxHp: 70, attack: 11, defense: 4, xpReward: 40 },
            playerHp: 123,
            logs: [
                { turn: 1, message: '星見ユウの攻撃！ スケルトンに18ダメージ！', playerHp: 145, enemyHp: 52 },
                { turn: 2, message: 'スケルトンの攻撃！ 星見ユウに22ダメージ！', playerHp: 123, enemyHp: 52 },
                { turn: 3, message: 'パワースラッシュ！ スケルトンに10ダメージ！', playerHp: 123, enemyHp: 42 },
            ],
            battleUnlocked: true, skillCooldowns: {}, guardTurnsRemaining: 0, guardDamageReduction: 0, actions: [], battleAttemptId: null, rewardMode: 'local',
            playerSnapshot: { attack: 37, defense: 40, maxHp: 168, level: 7, name: '星見ユウ' },
        };
        const { context, page } = await createPage(browser, battleGame);
        await page.goto(`${baseUrl}/map`);
        await save(page, 'web-battle.png');
        await context.close();
    }
} finally {
    await browser.close();
}
