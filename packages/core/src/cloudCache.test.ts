import { describe, expect, it } from 'vitest';
import {
    applyPullBatchToCache,
    buildCanonicalGameSnapshot,
    buildCanonicalHabitSnapshot,
    buildCanonicalTaskSnapshot,
    cloudCacheKey,
    countCloudContentRows,
    createEmptyCloudCache,
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
        expect(snapshot!.chestQueue).toHaveLength(1); // 開封済みは除外
        expect(snapshot!.chestQueue[0]).toMatchObject({ id: 'c1', chestType: 'blue', isStarterCharacter: true });
        expect(snapshot!.gachaCount).toBe(7);
        expect(snapshot!.rewardLedger.rewardedTaskIds).toEqual(['t1']);
        expect(snapshot!.rewardLedger.habitBonusDates).toEqual(['2026-07-01']);
        expect(snapshot!.activeTitle).toBe('冒険王');
        expect(snapshot!.battleProgress).toEqual({ battleUnlocked: true, currentStage: 3, maxClearedStage: 2 });
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
        expect(getSeedableSections(cache)).toEqual({ tasks: false, habits: false, game: false });
    });

    it('tasksに1行届けばtasksのみseed可（habitsとgameは対象外のまま）', () => {
        const cache = applyPullBatchToCache(createEmptyCloudCache(), batchWith({
            characters: [{ user_id: 'u1', version: 1 }],
            tasks: [{ id: 't1', version: 2 }],
        }));
        expect(getSeedableSections(cache)).toEqual({ tasks: true, habits: false, game: false });
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
});
