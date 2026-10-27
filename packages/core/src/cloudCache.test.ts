import { describe, expect, it } from 'vitest';
import {
    applyPullBatchToCache,
    buildCanonicalGameSnapshot,
    buildCanonicalHabitSnapshot,
    buildCanonicalTaskSnapshot,
    buildStatsLogSnapshot,
    cloudCacheKey,
    countCloudContentRows,
    createEmptyCloudCache,
    extractSyncedSettings,
    getSeedableSections,
    loadCloudCache,
    persistCloudCache,
} from './cloudCache.ts';
import type { PullBatch } from './cloudPull.ts';

const emptyBatch: PullBatch = { next_cursor: 0, has_more: false };

function batchWith(tables: Record<string, unknown[]>): PullBatch {
    return { ...emptyBatch, ...tables };
}

function createMemoryStorage() {
    const map = new Map<string, string>();
    return {
        map,
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => { map.set(key, value); },
        removeItem: (key: string) => { map.delete(key); },
    };
}

describe('cloud cache persistence session boundary', () => {
    it('does not begin writes for an inactive session or more sections after it stops', async () => {
        let active = false;
        const writes: string[] = [];
        let release!: () => void;
        let entered!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const ready = new Promise<void>((resolve) => { entered = resolve; });
        const storage = {
            ...createMemoryStorage(),
            setItem: async (key: string) => { writes.push(key); entered(); await gate; },
        };
        await persistCloudCache(storage, 'a', createEmptyCloudCache(), () => active);
        expect(writes).toEqual([]);
        active = true;
        const saving = persistCloudCache(storage, 'a', createEmptyCloudCache(), () => active);
        await ready;
        active = false;
        release();
        await saving;
        expect(writes).toEqual([cloudCacheKey('a', 'tasks')]);
    });
});

describe('applyPullBatchToCache', () => {
    it('PKでupsertし、versionの後退は拒否する', () => {
        let cache = createEmptyCloudCache();
        cache = applyPullBatchToCache(cache, batchWith({
            tasks: [{ id: 't1', name: '旧', version: 5 }],
        }));
        cache = applyPullBatchToCache(cache, batchWith({
            tasks: [
                { id: 't1', name: '後退', version: 3 },  // 拒否される
                { id: 't2', name: '新規', version: 6 },
            ],
        }));
        expect(cache.tasks.t1.name).toBe('旧');
        expect(cache.tasks.t2.name).toBe('新規');
    });

    it('複合PKテーブル（habit_logs）を habit_id:date でキーする', () => {
        const cache = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            habit_logs: [
                { habit_id: 'h1', date: '2026-07-01', completed: true, version: 1 },
                { habit_id: 'h1', date: '2026-07-02', completed: false, version: 2 },
            ],
        }));
        expect(Object.keys(cache.habit_logs)).toEqual(['h1:2026-07-01', 'h1:2026-07-02']);
    });

    it('countCloudContentRowsはコンテンツ行のみ数える（profiles/user_settings/battle_attemptsは除外）', () => {
        const cache = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            profiles: [{ user_id: 'u1', version: 1 }],
            user_settings: [{ user_id: 'u1', version: 1 }],
            battle_attempts: [{ id: 'b1', version: 1 }],
        }));
        expect(countCloudContentRows(cache)).toBe(0);
        const withTask = applyPullBatchToCache(cache, batchWith({
            tasks: [{ id: 't1', version: 2 }],
        }));
        expect(countCloudContentRows(withTask)).toBe(1);
    });
});

describe('buildCanonicalTaskSnapshot', () => {
    it('サブタスクを親ごとにネストし、墓標を除外し、snake_caseをcore型へ写像する', () => {
        const cache = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            tasks: [
                { id: 't1', name: 'タスク1', due_date: '2026-07-10', priority: 'high', recurrence: 'daily', tags: ['a'], completed: false, completed_at: null, created_at: '2026-07-01T00:00:00Z', deleted_at: null, version: 1 },
                { id: 't2', name: '削除済み', deleted_at: '2026-07-02T00:00:00Z', created_at: '2026-07-01T00:00:00Z', version: 2 },
            ],
            subtasks: [
                { id: 's2', task_id: 't1', name: '子2', completed: true, completed_at: '2026-07-03T00:00:00Z', created_at: '2026-07-02T00:00:00Z', deleted_at: null, version: 3 },
                { id: 's1', task_id: 't1', name: '子1', completed: false, completed_at: null, created_at: '2026-07-01T12:00:00Z', deleted_at: null, version: 3 },
            ],
        }));
        const snapshot = buildCanonicalTaskSnapshot(cache);
        expect(snapshot.tasks).toHaveLength(1);
        const task = snapshot.tasks[0];
        expect(task).toMatchObject({
            id: 't1', name: 'タスク1', dueDate: '2026-07-10', priority: 'high',
            recurrence: 'daily', tags: ['a'], completed: false,
        });
        expect(task.subtasks.map((subtask) => subtask.id)).toEqual(['s1', 's2']); // created_at順
    });
});

describe('buildCanonicalHabitSnapshot', () => {
    it('habits/habit_logs/rest_days/stats_dailyをcanonical形式へ写像する', () => {
        const cache = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            habits: [{ id: 'h1', name: '運動', category_id: 'health', created_at: '2026-07-01T00:00:00Z', deleted_at: null, version: 1 }],
            habit_logs: [{ habit_id: 'h1', date: '2026-07-01', completed: true, memo: 'メモ', deleted_at: null, version: 2 }],
            rest_days: [{ date: '2026-07-02', is_rest: true, deleted_at: null, version: 3 }],
            stats_daily: [
                { date: '2026-07-01', all_habits_complete: true, deleted_at: null, version: 2 },
                { date: '2026-07-03', all_habits_complete: false, deleted_at: null, version: 4 },
            ],
        }));
        const snapshot = buildCanonicalHabitSnapshot(cache);
        expect(snapshot.habits[0]).toMatchObject({ id: 'h1', name: '運動', categoryId: 'health' });
        expect(snapshot.dailyRecords[0]).toEqual({ habitId: 'h1', date: '2026-07-01', completed: true, memo: 'メモ' });
        expect(snapshot.restDays).toEqual([{ date: '2026-07-02', isRest: true }]);
        expect(snapshot.allCompleteDates).toEqual(['2026-07-01']);
    });
});

describe('buildStatsLogSnapshot', () => {
    it('stats_dailyからtaskXpLog/habitLogを組み立て、墓標は除外する', () => {
        const cache = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            stats_daily: [
                { date: '2026-07-01', task_xp: 30, habit_count: 2, all_habits_complete: true, deleted_at: null, version: 1 },
                { date: '2026-07-02', task_xp: 0, habit_count: 0, all_habits_complete: false, deleted_at: null, version: 1 },
                { date: '2026-07-03', task_xp: 10, habit_count: 1, all_habits_complete: false, deleted_at: '2026-07-04T00:00:00Z', version: 2 },
            ],
        }));
        expect(buildStatsLogSnapshot(cache)).toEqual({
            taskXpLog: { '2026-07-01': 30, '2026-07-02': 0 },
            habitLog: {
                '2026-07-01': { count: 2, allComplete: true },
                '2026-07-02': { count: 0, allComplete: false },
            },
        });
    });

    it('stats_dailyが空なら空ログを返す', () => {
        expect(buildStatsLogSnapshot(createEmptyCloudCache())).toEqual({ taskXpLog: {}, habitLog: {} });
    });
});

describe('buildCanonicalGameSnapshot', () => {
    it('characters行が無ければnull', () => {
        expect(buildCanonicalGameSnapshot(createEmptyCloudCache())).toBeNull();
    });

    it('total_xpからレベル・基礎ステータスを導出し、装備・宝箱・台帳・進行度を写像する', () => {
        const cache = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            characters: [{
                user_id: 'u1', name: '勇者', avatar: 'male', total_xp: 100, gacha_count: 7,
                battle_unlocked: true, current_stage: 3, max_cleared_stage: 2,
                debuff_active: false, debuff_expires_at: null, version: 1,
            }],
            inventory_items: [
                { id: 'i1', template_id: 'wooden_sword', equipped: true, deleted_at: null, version: 2 },
                { id: 'i2', template_id: 'unknown_template', equipped: false, deleted_at: null, version: 2 },
                { id: 'i3', template_id: 'leather_armor', equipped: false, deleted_at: '2026-07-01T00:00:00Z', version: 2 },
            ],
            chests: [
                { id: 'c1', chest_type: 'blue', label: '青色の宝箱', is_starter_character: true, opened: false, deleted_at: null, version: 3 },
                { id: 'c2', chest_type: 'wood', label: '開封済み', is_starter_character: false, opened: true, deleted_at: null, version: 3 },
            ],
            tasks: [{ id: 't1', completed: true, created_at: 'x', version: 4, deleted_at: null }],
            stats_daily: [{ date: '2026-07-01', all_habits_complete: true, deleted_at: null, version: 5 }],
            profiles: [{ user_id: 'u1', active_title: '冒険王', version: 6 }],
        }));
        const snapshot = buildCanonicalGameSnapshot(cache);
        expect(snapshot).not.toBeNull();
        expect(snapshot!.character).toMatchObject({ name: '勇者', avatar: 'male', totalXp: 100, level: 3 }); // 100XP→Lv3（LEVEL_XP_TABLE: Lv3=80, Lv4=150）
        expect(snapshot!.character.baseAttack).toBe(5 + 2 * 2);
        expect(snapshot!.equipment).toHaveLength(1); // 未知テンプレートと墓標は除外
        expect(snapshot!.equipment[0]).toMatchObject({ id: 'i1', templateId: 'wooden_sword', equipped: true });
        expect(snapshot!.chestQueue).toHaveLength(2); // 開封済みも獲得履歴として保持
        expect(snapshot!.chestQueue[0]).toMatchObject({ id: 'c1', chestType: 'blue', isStarterCharacter: true });
        expect(snapshot!.chestQueue[1]).toMatchObject({ id: 'c2', opened: true, equipment: null, origin: 'cloud' });
        expect(snapshot!.gachaCount).toBe(7);
        expect(snapshot!.rewardLedger.rewardedTaskIds).toEqual(['t1']);
        expect(snapshot!.rewardLedger.habitBonusDates).toEqual(['2026-07-01']);
        expect(snapshot!.activeTitle).toBe('冒険王');
        expect(snapshot!.battleProgress).toEqual({ battleUnlocked: true, currentStage: 3, maxClearedStage: 2 });
    });

    it('開封後のpullとキャッシュ復元でも、獲得装備・スターター履歴を残す', async () => {
        const cache = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            characters: [{ user_id: 'u1', total_xp: 310, gacha_count: 10, battle_unlocked: true, version: 8 }],
            inventory_items: [{ id: 'award', template_id: 'wooden_sword', equipped: true, version: 8 }],
            chests: [
                { id: 'starter', chest_type: 'blue', label: '青色の宝箱', is_starter_character: true, opened: true, created_at: '2026-07-01T00:00:00Z', version: 7 },
                { id: 'wood', chest_type: 'wood', label: '木の宝箱', opened: true, opened_item_id: 'award', created_at: '2026-07-02T00:00:00Z', version: 8 },
            ],
        }));
        const storage = createMemoryStorage();
        await persistCloudCache(storage, 'u1', cache);
        const restored = buildCanonicalGameSnapshot(await loadCloudCache(storage, 'u1'))!;
        expect(restored.chestQueue).toEqual([
            expect.objectContaining({ id: 'starter', opened: true, isStarterCharacter: true, equipment: null }),
            expect.objectContaining({ id: 'wood', opened: true, equipment: expect.objectContaining({ id: 'award', templateId: 'wooden_sword', equipped: false }) }),
        ]);
        expect(restored.chestQueue.filter((chest) => !chest.opened)).toEqual([]);
        expect(restored.equipment).toHaveLength(1);
        expect(restored.equipment[0].equipped).toBe(true);
        expect(restored.character.totalXp).toBe(310);
        expect(restored.gachaCount).toBe(10);
        expect(restored.battleProgress.battleUnlocked).toBe(true);
    });

    it('売却/合成で削除された装備は持ち物へ戻さず、履歴の獲得結果だけ復元する', () => {
        const cache = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            characters: [{ user_id: 'u1', version: 1 }],
            inventory_items: [{ id: 'sold', template_id: 'leather_armor', deleted_at: '2026-07-03T00:00:00Z', version: 5 }],
            chests: [
                { id: 'opened', chest_type: 'wood', opened: true, opened_item_id: 'sold', version: 3 },
                { id: 'deleted-chest', chest_type: 'wood', opened: true, opened_item_id: 'sold', deleted_at: '2026-07-03T00:00:00Z', version: 5 },
                { id: 'pending', chest_type: 'wood', opened: false, opened_item_id: 'sold', version: 6 },
            ],
        }));
        const snapshot = buildCanonicalGameSnapshot(cache)!;
        expect(snapshot.equipment).toEqual([]);
        expect(snapshot.chestQueue.find((chest) => chest.id === 'opened')).toMatchObject({
            opened: true, equipment: { id: 'sold', templateId: 'leather_armor', equipped: false },
        });
        expect(snapshot.chestQueue.some((chest) => chest.id === 'deleted-chest')).toBe(false);
        expect(snapshot.chestQueue.find((chest) => chest.id === 'pending')).toMatchObject({ opened: false, equipment: null });
    });

    it('遅れて届く排出装備は次のpullで履歴に解決し、欠落/未知テンプレートは抽選せずnullにする', () => {
        const cache = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            characters: [{ user_id: 'u1', version: 1 }],
            inventory_items: [{ id: 'unknown', template_id: 'unknown-template', version: 2 }],
            chests: [
                { id: 'late', chest_type: 'wood', opened: true, opened_item_id: 'later', version: 2 },
                { id: 'unknown', chest_type: 'wood', opened: true, opened_item_id: 'unknown', version: 2 },
            ],
        }));
        expect(buildCanonicalGameSnapshot(cache)!.chestQueue.map((chest) => chest.equipment)).toEqual([null, null]);
        const next = applyPullBatchToCache(cache, batchWith({
            inventory_items: [{ id: 'later', template_id: 'wooden_sword', version: 3 }],
        }));
        expect(buildCanonicalGameSnapshot(next)!.chestQueue.find((chest) => chest.id === 'late')!.equipment).toMatchObject({
            id: 'later', templateId: 'wooden_sword',
        });
    });

    it('開封/更新順によらず獲得順に並べ、既存上限で未開封を優先して保持する', () => {
        const cache = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            characters: [{ user_id: 'u1', version: 1 }],
            chests: [
                { id: 'newer', chest_type: 'wood', opened: true, created_at: '2026-07-02T00:00:00Z', version: 2 },
                { id: 'older', chest_type: 'blue', opened: true, created_at: '2026-07-01T00:00:00Z', version: 10 },
            ],
        }));
        expect(buildCanonicalGameSnapshot(cache)!.chestQueue.map((chest) => chest.id)).toEqual(['older', 'newer']);
        const many = applyPullBatchToCache(cache, batchWith({
            chests: [
                { id: 'unopened', chest_type: 'wood', opened: false, created_at: '2026-01-01T00:00:00Z', version: 1 },
                ...Array.from({ length: 501 }, (_, index) => ({
                    id: `opened-${String(index).padStart(3, '0')}`, chest_type: 'wood', opened: true,
                    created_at: '2026-08-01T00:00:00Z', version: index + 11,
                })),
            ],
        }));
        const queue = buildCanonicalGameSnapshot(many)!.chestQueue;
        expect(queue).toHaveLength(500);
        expect(queue[0]).toMatchObject({ id: 'unopened', opened: false });
        expect(queue[queue.length - 1].id).toBe('opened-500');
        expect(queue.some((chest) => chest.id === 'older')).toBe(false);
    });
});

describe('persistCloudCache / loadCloudCache（ADR-009 namespace分離）', () => {
    it('user_idごとに独立したキーへ保存し、別ユーザーのロードには一切現れない', async () => {
        const storage = createMemoryStorage();
        const cacheA = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            tasks: [{ id: 'a-task', name: 'Aのタスク', created_at: 'x', deleted_at: null, version: 1 }],
        }));
        await persistCloudCache(storage, 'user-a', cacheA);

        expect(storage.map.has(cloudCacheKey('user-a', 'tasks'))).toBe(true);
        expect([...storage.map.keys()].every((key) => key.includes(':user-a:'))).toBe(true);

        // ユーザーBのロードにはAのデータが一切現れない
        const cacheB = await loadCloudCache(storage, 'user-b');
        expect(countCloudContentRows(cacheB)).toBe(0);

        // 同一ユーザーの再ログインでは復元される
        const reloaded = await loadCloudCache(storage, 'user-a');
        expect(reloaded.tasks['a-task'].name).toBe('Aのタスク');
    });

    it('壊れたセクションは空として扱い、他セクションの復元は続行する', async () => {
        const storage = createMemoryStorage();
        const cache = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            tasks: [{ id: 't1', version: 1 }],
            habits: [{ id: 'h1', version: 1 }],
        }));
        await persistCloudCache(storage, 'u', cache);
        storage.map.set(cloudCacheKey('u', 'tasks'), '{broken json');

        const reloaded = await loadCloudCache(storage, 'u');
        expect(Object.keys(reloaded.tasks)).toHaveLength(0);
        expect(Object.keys(reloaded.habits)).toHaveLength(1);
    });
});

describe('getSeedableSections（#506移行前のローカルデータ保護）', () => {
    it('初期行（characters v1 / profiles / user_settings）だけでは全セクションseed不可', () => {
        const cache = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            profiles: [{ user_id: 'u1', version: 1 }],
            user_settings: [{ user_id: 'u1', version: 1 }],
            characters: [{ user_id: 'u1', total_xp: 0, version: 1 }],
        }));
        expect(getSeedableSections(cache)).toEqual({ tasks: false, habits: false, game: false, settings: false });
    });

    it('tasksに1行届けばtasksのみseed可（habitsとgameとsettingsは対象外のまま）', () => {
        const cache = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            characters: [{ user_id: 'u1', version: 1 }],
            tasks: [{ id: 't1', version: 2 }],
        }));
        expect(getSeedableSections(cache)).toEqual({ tasks: true, habits: false, game: false, settings: false });
    });

    it('墓標だけでもクラウドに履歴がある証拠としてseed可', () => {
        const cache = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            tasks: [{ id: 't1', deleted_at: '2026-07-06T00:00:00Z', version: 2 }],
        }));
        expect(getSeedableSections(cache).tasks).toBe(true);
    });

    it('gameはcharactersのversionが進む（実操作がある）か装備・宝箱・バトル行があればseed可', () => {
        const untouched = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            characters: [{ user_id: 'u1', version: 1 }],
        }));
        expect(getSeedableSections(untouched).game).toBe(false);

        const touched = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            characters: [{ user_id: 'u1', version: 5 }],
        }));
        expect(getSeedableSections(touched).game).toBe(true);

        const withChest = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            characters: [{ user_id: 'u1', version: 1 }],
            chests: [{ id: 'c1', chest_type: 'wood', version: 3 }],
        }));
        expect(getSeedableSections(withChest).game).toBe(true);
    });

    it('settingsはuser_settings.settingsが空jsonbのままならseed不可、何か書き込まれていればseed可', () => {
        const untouched = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            user_settings: [{ user_id: 'u1', settings: {}, version: 1 }],
        }));
        expect(getSeedableSections(untouched).settings).toBe(false);

        const touched = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            user_settings: [{ user_id: 'u1', settings: { themeMode: 'dark' }, version: 2 }],
        }));
        expect(getSeedableSections(touched).settings).toBe(true);
    });
});

describe('extractSyncedSettings', () => {
    it('user_settings行が無ければnullを返す', () => {
        expect(extractSyncedSettings(createEmptyCloudCache())).toBeNull();
    });

    it('settings jsonbから同期対象4項目の生値をそのまま取り出す', () => {
        const cache = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            user_settings: [{
                user_id: 'u1',
                settings: {
                    themeMode: 'dark', motionMode: 'reduced', notificationsEnabled: true, habitReminderHour: 21,
                    notifiedTaskIds: ['should-not-leak'], // 同期対象外のキーが混入していても無視される
                },
                version: 3,
            }],
        }));
        expect(extractSyncedSettings(cache)).toEqual({
            themeMode: 'dark', motionMode: 'reduced', notificationsEnabled: true, habitReminderHour: 21,
        });
    });

    it('settingsが空jsonbなら全項目undefinedを返す（呼び出し元のsanitizeでデフォルト値へ）', () => {
        const cache = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            user_settings: [{ user_id: 'u1', settings: {}, version: 1 }],
        }));
        expect(extractSyncedSettings(cache)).toEqual({
            themeMode: undefined, motionMode: undefined, notificationsEnabled: undefined, habitReminderHour: undefined,
        });
    });
});
