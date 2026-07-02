import { describe, expect, it } from 'vitest';
import {
    LEGACY_STORAGE_KEYS,
    migrateLegacyQuestBoardData,
    MIGRATION_JOURNAL_KEY,
    type MigrationJournal,
} from './legacyMigration';
import {
    CANONICAL_STORAGE_KEYS,
    createCanonicalSnapshotRepositories,
    type RepositoryStorage,
    type SnapshotRepositoryEnvelope,
} from './syncRepository';
import type { CanonicalGameSnapshot, CanonicalTaskSnapshot } from './syncSnapshots';

// ─── テスト用ストレージ ───────────────────────────────────────

interface MemoryStorage extends RepositoryStorage {
    map: Map<string, string>;
}

function createMemoryStorage(initial: Record<string, string> = {}): MemoryStorage {
    const map = new Map(Object.entries(initial));
    return {
        map,
        getItem: (key) => map.get(key) ?? null,
        setItem: (key, value) => { map.set(key, value); },
        removeItem: (key) => { map.delete(key); },
    };
}

function runMigration(storage: RepositoryStorage, legacySource: RepositoryStorage = storage) {
    return migrateLegacyQuestBoardData({
        legacySource: { getItem: (key) => legacySource.getItem(key) },
        repositories: createCanonicalSnapshotRepositories(storage, () => new Date('2026-07-03T00:00:00.000Z')),
        journalStorage: storage,
        now: () => new Date('2026-07-03T00:00:00.000Z'),
    });
}

function readEnvelope<T>(storage: MemoryStorage, key: string): SnapshotRepositoryEnvelope<T & { schemaVersion: number }> {
    const raw = storage.map.get(key);
    if (!raw) throw new Error(`canonical not written: ${key}`);
    return JSON.parse(raw) as SnapshotRepositoryEnvelope<T & { schemaVersion: number }>;
}

// ─── 旧形式フィクスチャ ───────────────────────────────────────

const TASK_T1 = {
    id: 't1', name: '完了済みタスク', dueDate: null, priority: 'high', tags: ['家事'],
    subtasks: [
        { id: 's1', name: '完了サブ', completed: true, completedAt: '2026-07-01T01:00:00.000Z', createdAt: '2026-07-01T00:00:00.000Z' },
        { id: 's2', name: '未完サブ', completed: false, completedAt: null, createdAt: '2026-07-01T00:00:00.000Z' },
    ],
    recurrence: 'none', completed: true, completedAt: '2026-07-01T02:00:00.000Z', createdAt: '2026-07-01T00:00:00.000Z',
};
const TASK_T2 = {
    id: 't2', name: '未完タスク', dueDate: null, priority: 'medium', tags: [],
    subtasks: [], recurrence: 'none', completed: false, completedAt: null, createdAt: '2026-07-01T00:00:00.000Z',
};

function webLegacyFixture(): Record<string, string> {
    return {
        [LEGACY_STORAGE_KEYS.tasks]: JSON.stringify({ state: { tasks: [TASK_T1, TASK_T2], pendingCompletions: [] }, version: 3 }),
        [LEGACY_STORAGE_KEYS.habits]: JSON.stringify({
            state: {
                habits: [{ id: 'h1', name: '運動', categoryId: 'health', createdAt: '2026-06-01T00:00:00.000Z' }],
                dailyRecords: [{ habitId: 'h1', date: '2026-07-01', completed: true, memo: 'よい' }],
                restDays: [{ date: '2026-06-30', isRest: true }],
                allCompleteRewardDates: ['2026-07-01'],
            },
            version: 2,
        }),
        [LEGACY_STORAGE_KEYS.game]: JSON.stringify({
            state: {
                character: { name: '勇者', avatar: 'male', level: 99, totalXp: 30, baseAttack: 9999, baseDefense: 9999, baseMaxHp: 9999 },
                debuff: { active: false, expiresAt: null, multiplier: 1 },
                equipment: [{ id: 'e1', templateId: 'wooden_sword', name: 'x', slot: 'weapon', rarity: 'common', attackBonus: 999, defenseBonus: 0, hpBonus: 0, equipped: true }],
                gachaCount: 7,
                chestQueue: [{ id: 'c1', chestType: 'wood', label: '木の宝箱', opened: false, equipment: null }],
                battle: {
                    status: 'fighting', currentStage: 3, maxClearedStage: 2, battleUnlocked: true,
                    enemy: { stage: 3, name: '大コウモリ', hp: 12, maxHp: 70, attack: 7, defense: 3, xpReward: 15 },
                    playerHp: 10, logs: [{ turn: 1, message: 'x', playerHp: 10, enemyHp: 12 }],
                    skillCooldowns: { power_strike: 2 }, guardTurnsRemaining: 1, guardDamageReduction: 0.3,
                },
            },
            version: 0,
        }),
        [LEGACY_STORAGE_KEYS.title]: JSON.stringify({ state: { activeTitle: '努力の人' }, version: 1 }),
    };
}

function mobileLegacyFixture(): Record<string, string> {
    return {
        [LEGACY_STORAGE_KEYS.tasks]: JSON.stringify({ state: { tasks: [TASK_T1, TASK_T2] }, version: 0 }),
        [LEGACY_STORAGE_KEYS.habits]: JSON.stringify({
            state: {
                habits: [{ id: 'h1', name: '運動', categoryId: 'health', createdAt: '2026-06-01T00:00:00.000Z' }],
                records: [{ habitId: 'h1', date: '2026-07-01', completed: true, memo: 'よい' }],
                rewardEligibleDates: ['2026-07-01'],
            },
            version: 0,
        }),
        [LEGACY_STORAGE_KEYS.game]: JSON.stringify({
            state: {
                character: { name: '勇者', avatar: 'male', level: 2, totalXp: 30, baseAttack: 7, baseDefense: 4, baseMaxHp: 60 },
                equipment: [{ id: 'e1', templateId: 'wooden_sword', name: 'x', slot: 'weapon', rarity: 'common', attackBonus: 2, defenseBonus: 0, hpBonus: 0, equipped: true }],
                gachaCount: 7,
                chestQueue: [{ id: 'c1', chestType: 'wood', label: '木の宝箱', opened: false, equipment: null }],
                rewardLedger: { rewardedTaskIds: ['t1'], rewardedSubtaskIds: ['s1'], habitBonusDates: ['2026-07-01'] },
            },
            version: 1,
        }),
    };
}

// ─── 正常系 ───────────────────────────────────────────────────

describe('migrateLegacyQuestBoardData: 正常移行', () => {
    it('Web旧形式の3セクションを移行し、旧キーを一切変更しない', async () => {
        const fixture = webLegacyFixture();
        const storage = createMemoryStorage(fixture);

        const report = await runMigration(storage);

        expect(report.ok).toBe(true);
        expect(report.aborted).toBe(false);
        expect(report.sections.tasks).toMatchObject({ status: 'migrated', revision: 1 });
        expect(report.sections.habits).toMatchObject({ status: 'migrated', revision: 1 });
        expect(report.sections.game).toMatchObject({ status: 'migrated', revision: 1 });
        expect(report.journal).toBe('saved');

        // 旧キーはバイト単位で不変（削除も上書きもしない）
        for (const [key, value] of Object.entries(fixture)) {
            expect(storage.map.get(key)).toBe(value);
        }

        const tasks = readEnvelope<CanonicalTaskSnapshot>(storage, CANONICAL_STORAGE_KEYS.tasks);
        expect(tasks.data.tasks).toHaveLength(2);

        const game = readEnvelope<CanonicalGameSnapshot>(storage, CANONICAL_STORAGE_KEYS.game);
        // 称号・完了タスク・完了サブタスク・全達成日が移行証跡として台帳へ焼き込まれる
        expect(game.data.activeTitle).toBe('努力の人');
        expect(game.data.rewardLedger.rewardedTaskIds).toEqual(['t1']);
        expect(game.data.rewardLedger.rewardedSubtaskIds).toEqual(['s1']);
        expect(game.data.rewardLedger.habitBonusDates).toEqual(['2026-07-01']);
        // 細工されたステータスは totalXp から再計算される
        expect(game.data.character.level).toBe(2);
        expect(game.data.character.baseAttack).toBeLessThan(9999);
        // バトルは進行度のみ移行し、UI一時状態（敵HP・ログ・クールダウン）は含まれない
        expect(game.data.battleProgress).toEqual({ battleUnlocked: true, currentStage: 3, maxClearedStage: 2 });
        expect(JSON.stringify(game.data)).not.toContain('enemyHp');
        expect(JSON.stringify(game.data)).not.toContain('skillCooldowns');
        expect(JSON.stringify(game.data)).not.toContain('logs');
    });

    it('Mobile旧形式を移行し、既存の報酬台帳と証跡が重複なく統合される', async () => {
        const storage = createMemoryStorage(mobileLegacyFixture());

        const report = await runMigration(storage);

        expect(report.ok).toBe(true);
        const game = readEnvelope<CanonicalGameSnapshot>(storage, CANONICAL_STORAGE_KEYS.game);
        // 台帳のt1と完了タスク証跡のt1が重複しない
        expect(game.data.rewardLedger.rewardedTaskIds).toEqual(['t1']);
        expect(game.data.rewardLedger.rewardedSubtaskIds).toEqual(['s1']);
        expect(game.data.rewardLedger.habitBonusDates).toEqual(['2026-07-01']);
        expect(game.data.activeTitle).toBeNull();
        expect(game.data.gachaCount).toBe(7);
    });

    it('WebとMobileで同じ論理データなら同一のcanonical envelopeになる', async () => {
        // 称号・バトル・お休み日はWeb固有なので、共通部分だけの論理データで比較する
        const web = createMemoryStorage(webLegacyFixture());
        web.map.delete(LEGACY_STORAGE_KEYS.title);
        const webGame = JSON.parse(web.map.get(LEGACY_STORAGE_KEYS.game)!) as { state: Record<string, unknown> };
        delete webGame.state.battle;
        web.map.set(LEGACY_STORAGE_KEYS.game, JSON.stringify(webGame));
        const webHabits = JSON.parse(web.map.get(LEGACY_STORAGE_KEYS.habits)!) as { state: Record<string, unknown> };
        delete webHabits.state.restDays;
        web.map.set(LEGACY_STORAGE_KEYS.habits, JSON.stringify(webHabits));
        const mobile = createMemoryStorage(mobileLegacyFixture());

        await runMigration(web);
        await runMigration(mobile);

        for (const key of Object.values(CANONICAL_STORAGE_KEYS)) {
            expect(JSON.parse(web.map.get(key)!)).toEqual(JSON.parse(mobile.map.get(key)!));
        }
    });

    it('不正・過大・重複を含む旧データはsanitizeされて移行される', async () => {
        const storage = createMemoryStorage({
            [LEGACY_STORAGE_KEYS.tasks]: JSON.stringify({
                state: {
                    tasks: [
                        TASK_T1,
                        TASK_T1, // ID重複
                        { id: 't3', name: 'あ'.repeat(500), priority: 'urgent!!', completed: 'yes' }, // 過大・不正
                        'garbage',
                        null,
                    ],
                },
                version: 3,
            }),
        });

        const report = await runMigration(storage);

        expect(report.sections.tasks.status).toBe('migrated');
        const tasks = readEnvelope<CanonicalTaskSnapshot>(storage, CANONICAL_STORAGE_KEYS.tasks);
        expect(tasks.data.tasks).toHaveLength(2); // t1 + t3（重複とゴミは除去）
        const overlong = tasks.data.tasks.find((task) => task.id === 't3');
        expect(overlong?.name).toHaveLength(200);
        expect(overlong?.priority).toBe('medium');
        expect(overlong?.completed).toBe(false);
    });

    it('gameが無くてもtasks/habitsがあれば報酬証跡入りのgame canonicalを作る', async () => {
        const fixture = webLegacyFixture();
        const storage = createMemoryStorage({
            [LEGACY_STORAGE_KEYS.tasks]: fixture[LEGACY_STORAGE_KEYS.tasks],
        });

        const report = await runMigration(storage);

        expect(report.sections.game.status).toBe('migrated');
        const game = readEnvelope<CanonicalGameSnapshot>(storage, CANONICAL_STORAGE_KEYS.game);
        expect(game.data.rewardLedger.rewardedTaskIds).toEqual(['t1']);
        expect(game.data.character.totalXp).toBe(0); // キャラクターは初期状態
    });
});

// ─── 旧データが無い・壊れている場合 ───────────────────────────

describe('migrateLegacyQuestBoardData: 旧データの欠落・破損', () => {
    it('旧データが存在しなければ何も書き込まずjournalも作らない', async () => {
        const storage = createMemoryStorage();

        const report = await runMigration(storage);

        expect(report.ok).toBe(true);
        expect(report.sections.tasks.status).toBe('no-legacy');
        expect(report.sections.habits.status).toBe('no-legacy');
        expect(report.sections.game.status).toBe('no-legacy');
        expect(report.journal).toBe('skipped');
        expect(storage.map.size).toBe(0);
    });

    it('malformed JSONのセクションはlegacy-corruptとして残し、他は移行する', async () => {
        const fixture = webLegacyFixture();
        fixture[LEGACY_STORAGE_KEYS.tasks] = '{broken json';
        const storage = createMemoryStorage(fixture);

        const report = await runMigration(storage);

        expect(report.ok).toBe(true);
        expect(report.sections.tasks.status).toBe('legacy-corrupt');
        expect(report.sections.habits.status).toBe('migrated');
        expect(report.sections.game.status).toBe('migrated');
        // 壊れた旧データもそのまま残す
        expect(storage.map.get(LEGACY_STORAGE_KEYS.tasks)).toBe('{broken json');
        expect(storage.map.has(CANONICAL_STORAGE_KEYS.tasks)).toBe(false);
        // 壊れたtasksは報酬証跡としても使われない
        const game = readEnvelope<CanonicalGameSnapshot>(storage, CANONICAL_STORAGE_KEYS.game);
        expect(game.data.rewardLedger.rewardedTaskIds).toEqual([]);
    });

    it('game自体がmalformedならgameセクションは書き込まない', async () => {
        const fixture = webLegacyFixture();
        fixture[LEGACY_STORAGE_KEYS.game] = 'not json at all';
        const storage = createMemoryStorage(fixture);

        const report = await runMigration(storage);

        expect(report.sections.game.status).toBe('legacy-corrupt');
        expect(storage.map.has(CANONICAL_STORAGE_KEYS.game)).toBe(false);
        expect(report.sections.tasks.status).toBe('migrated');
    });
});

// ─── canonical側の保護 ────────────────────────────────────────

describe('migrateLegacyQuestBoardData: canonical側の保護', () => {
    it('canonicalに既存データがあれば黙って上書きせずskipped-existingを報告する', async () => {
        const storage = createMemoryStorage(webLegacyFixture());
        const repositories = createCanonicalSnapshotRepositories(storage);
        await repositories.tasks.save({ tasks: [TASK_T2] }, null); // 既存canonical
        const existing = storage.map.get(CANONICAL_STORAGE_KEYS.tasks);

        const report = await runMigration(storage);

        expect(report.ok).toBe(true);
        expect(report.sections.tasks.status).toBe('skipped-existing');
        expect(storage.map.get(CANONICAL_STORAGE_KEYS.tasks)).toBe(existing);
        expect(report.sections.habits.status).toBe('migrated');
    });

    it('canonicalが破損していれば上書きしない', async () => {
        const storage = createMemoryStorage({
            ...webLegacyFixture(),
            [CANONICAL_STORAGE_KEYS.tasks]: '{oops',
        });

        const report = await runMigration(storage);

        expect(report.sections.tasks).toEqual({ status: 'skipped-unsafe', reason: 'canonical-corrupt' });
        expect(storage.map.get(CANONICAL_STORAGE_KEYS.tasks)).toBe('{oops');
    });

    it('canonicalが未対応スキーマなら上書きしない', async () => {
        const unsupported = JSON.stringify({
            repositoryVersion: 1,
            revision: 1,
            updatedAt: '2026-07-01T00:00:00.000Z',
            data: { schemaVersion: 999 },
        });
        const storage = createMemoryStorage({
            ...webLegacyFixture(),
            [CANONICAL_STORAGE_KEYS.game]: unsupported,
        });

        const report = await runMigration(storage);

        expect(report.sections.game).toEqual({ status: 'skipped-unsafe', reason: 'canonical-unsupported' });
        expect(storage.map.get(CANONICAL_STORAGE_KEYS.game)).toBe(unsupported);
    });

    it('事前チェック後に別の書き込みが割り込んだ場合はrevision競合として失敗し上書きしない', async () => {
        const injected = JSON.stringify({
            repositoryVersion: 1,
            revision: 1,
            updatedAt: '2026-07-01T00:00:00.000Z',
            data: { schemaVersion: 1, tasks: [] },
        });
        const base = createMemoryStorage(webLegacyFixture());
        let tasksReads = 0;
        const racy: RepositoryStorage = {
            getItem: (key) => {
                if (key === CANONICAL_STORAGE_KEYS.tasks) {
                    tasksReads += 1;
                    // 1回目（事前チェック）はempty、2回目（save内の再読込）で別書き込みが出現
                    if (tasksReads >= 2) return injected;
                    return null;
                }
                return base.getItem(key);
            },
            setItem: (key, value) => {
                if (key === CANONICAL_STORAGE_KEYS.tasks) throw new Error('should not overwrite');
                base.setItem(key, value);
            },
            removeItem: (key) => base.removeItem(key),
        };

        const report = await migrateLegacyQuestBoardData({
            legacySource: { getItem: (key) => racy.getItem(key) },
            repositories: createCanonicalSnapshotRepositories(racy),
            journalStorage: base,
        });

        expect(report.ok).toBe(false);
        expect(report.sections.tasks).toEqual({ status: 'failed', reason: 'conflict' });
        expect(report.sections.habits.status).toBe('migrated');
    });
});

// ─── 部分失敗と再実行 ─────────────────────────────────────────

describe('migrateLegacyQuestBoardData: 部分失敗と再実行', () => {
    function failingSetFor(base: MemoryStorage, failKeys: ReadonlySet<string>): RepositoryStorage {
        return {
            getItem: (key) => base.getItem(key),
            setItem: (key, value) => {
                if (failKeys.has(key)) throw new Error('disk full');
                base.setItem(key, value);
            },
            removeItem: (key) => base.removeItem(key),
        };
    }

    it('1つ目(tasks)の書き込み失敗後も残りは移行され、再実行で復旧する', async () => {
        const base = createMemoryStorage(webLegacyFixture());
        const failing = failingSetFor(base, new Set([CANONICAL_STORAGE_KEYS.tasks]));

        const first = await migrateLegacyQuestBoardData({
            legacySource: { getItem: (key) => failing.getItem(key) },
            repositories: createCanonicalSnapshotRepositories(failing),
            journalStorage: base,
        });
        expect(first.ok).toBe(false);
        expect(first.sections.tasks).toEqual({ status: 'failed', reason: 'storage-error' });
        expect(first.sections.habits.status).toBe('migrated');
        expect(first.sections.game.status).toBe('migrated');

        // 再実行（ストレージ回復後）: 失敗分だけ移行し、成功済みは変更しない
        const habitsBefore = base.map.get(CANONICAL_STORAGE_KEYS.habits);
        const gameBefore = base.map.get(CANONICAL_STORAGE_KEYS.game);
        const second = await runMigration(base);
        expect(second.ok).toBe(true);
        expect(second.sections.tasks.status).toBe('migrated');
        expect(second.sections.habits.status).toBe('skipped-existing');
        expect(second.sections.game.status).toBe('skipped-existing');
        expect(base.map.get(CANONICAL_STORAGE_KEYS.habits)).toBe(habitsBefore);
        expect(base.map.get(CANONICAL_STORAGE_KEYS.game)).toBe(gameBefore);
    });

    it('2つ目(habits)の書き込み失敗後の再実行で報酬台帳が重複しない', async () => {
        const base = createMemoryStorage(mobileLegacyFixture());
        const failing = failingSetFor(base, new Set([CANONICAL_STORAGE_KEYS.habits]));

        const first = await migrateLegacyQuestBoardData({
            legacySource: { getItem: (key) => failing.getItem(key) },
            repositories: createCanonicalSnapshotRepositories(failing),
            journalStorage: base,
        });
        expect(first.sections.habits).toEqual({ status: 'failed', reason: 'storage-error' });
        expect(first.sections.game.status).toBe('migrated');

        const second = await runMigration(base);
        expect(second.ok).toBe(true);
        expect(second.sections.habits.status).toBe('migrated');
        expect(second.sections.game.status).toBe('skipped-existing');

        const game = readEnvelope<CanonicalGameSnapshot>(base, CANONICAL_STORAGE_KEYS.game);
        expect(game.data.rewardLedger.rewardedTaskIds).toEqual(['t1']);
        expect(game.data.rewardLedger.habitBonusDates).toEqual(['2026-07-01']);
        expect(game.revision).toBe(1); // gameは一度しか書かれていない
    });

    it('同じ移行を複数回実行してもcanonicalが変化しない（冪等）', async () => {
        const storage = createMemoryStorage(webLegacyFixture());

        await runMigration(storage);
        const snapshot = new Map(storage.map);
        const second = await runMigration(storage);
        const third = await runMigration(storage);

        expect(second.ok).toBe(true);
        expect(third.sections.tasks.status).toBe('skipped-existing');
        for (const key of Object.values(CANONICAL_STORAGE_KEYS)) {
            expect(storage.map.get(key)).toBe(snapshot.get(key));
        }
        // 書き込み対象が無い再実行はjournalに触れない（初回の完了記録が保たれる）
        expect(second.journal).toBe('skipped');
        expect(third.journal).toBe('skipped');
        const journal = JSON.parse(storage.map.get(MIGRATION_JOURNAL_KEY)!) as MigrationJournal;
        expect(journal.attempt).toBe(1);
        expect(journal.finishedAt).not.toBeNull();
    });

    it('journalに実行状態が記録される', async () => {
        const storage = createMemoryStorage(webLegacyFixture());

        await runMigration(storage);

        const journal = JSON.parse(storage.map.get(MIGRATION_JOURNAL_KEY)!) as MigrationJournal;
        expect(journal.journalVersion).toBe(1);
        expect(journal.attempt).toBe(1);
        expect(journal.startedAt).toBe('2026-07-03T00:00:00.000Z');
        expect(journal.finishedAt).toBe('2026-07-03T00:00:00.000Z');
        expect(journal.sections).toEqual({ tasks: 'migrated', habits: 'migrated', game: 'migrated' });
    });

    it('journalの書き込みに失敗しても移行自体は完了し、報告に含まれる', async () => {
        const base = createMemoryStorage(webLegacyFixture());
        const journalFailing: RepositoryStorage = {
            getItem: (key) => base.getItem(key),
            setItem: (key, value) => {
                if (key === MIGRATION_JOURNAL_KEY) throw new Error('journal write denied');
                base.setItem(key, value);
            },
            removeItem: (key) => base.removeItem(key),
        };

        const report = await migrateLegacyQuestBoardData({
            legacySource: { getItem: (key) => base.getItem(key) },
            repositories: createCanonicalSnapshotRepositories(base),
            journalStorage: journalFailing,
        });

        expect(report.ok).toBe(true);
        expect(report.journal).toBe('write-failed');
        expect(base.map.has(CANONICAL_STORAGE_KEYS.tasks)).toBe(true);
    });
});

// ─── ストレージ例外 ───────────────────────────────────────────

describe('migrateLegacyQuestBoardData: ストレージ例外', () => {
    it('旧データの読み取りが例外を投げたら何も書き込まずに中止する', async () => {
        const storage = createMemoryStorage(webLegacyFixture());
        const sizeBefore = storage.map.size;
        const throwingSource = {
            getItem: () => { throw new Error('storage unavailable'); },
        };

        const report = await migrateLegacyQuestBoardData({
            legacySource: throwingSource,
            repositories: createCanonicalSnapshotRepositories(storage),
            journalStorage: storage,
        });

        expect(report.ok).toBe(false);
        expect(report.aborted).toBe(true);
        expect(report.sections.tasks).toEqual({ status: 'failed', reason: 'legacy-read-error' });
        expect(report.journal).toBe('skipped');
        expect(storage.map.size).toBe(sizeBefore);
    });

    it('canonical読み取りがstorage-errorならそのセクションを書き込まない', async () => {
        const base = createMemoryStorage(webLegacyFixture());
        const partiallyBroken: RepositoryStorage = {
            getItem: (key) => {
                if (key === CANONICAL_STORAGE_KEYS.habits) throw new Error('read error');
                return base.getItem(key);
            },
            setItem: (key, value) => base.setItem(key, value),
            removeItem: (key) => base.removeItem(key),
        };

        const report = await migrateLegacyQuestBoardData({
            legacySource: { getItem: (key) => base.getItem(key) },
            repositories: createCanonicalSnapshotRepositories(partiallyBroken),
            journalStorage: base,
        });

        expect(report.sections.habits).toEqual({ status: 'skipped-unsafe', reason: 'canonical-storage-error' });
        expect(report.sections.tasks.status).toBe('migrated');
        expect(base.map.has(CANONICAL_STORAGE_KEYS.habits)).toBe(false);
    });
});
