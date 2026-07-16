/**
 * クラウド同期のローカル行キャッシュ（#504、ADR-008/009）。
 *
 * pull_sync_batch が返す行を user_id 別 namespace のローカルキャッシュへ
 * 蓄積し、そこから canonical スナップショット（既存のストアシード経路の入力）を
 * 組み立てる。キャッシュはオフライン時の表示用でもある。
 *
 * - upsert は version の後退を拒否する（LWWの単調性）
 * - 墓標（deleted_at）はキャッシュには残し、スナップショット構築時に除外する
 * - 未認証時の既存キー（quest-board-* / life-quest:canonical:*）には一切触れない
 */
import { calculateLevel, CHARACTER_CONFIG } from './progression.ts';
import { createEquipmentFromTemplate, type Equipment } from './equipment.ts';
import { EQUIPMENT_POOL, type ChestReward, type ChestType } from './rewards.ts';
import type { CharacterState } from './gameState.ts';
import type { Priority, Recurrence, Subtask, Task } from './tasks.ts';
import type { Habit, HabitDailyRecord, RestDay } from './habits.ts';
import {
    SYNC_SNAPSHOT_VERSION,
    type CanonicalGameSnapshot,
    type CanonicalHabitSnapshot,
    type CanonicalTaskSnapshot,
} from './syncSnapshots.ts';
import type { RepositoryStorage } from './syncRepository.ts';
import type { PullBatch } from './cloudPull.ts';
import { sanitizeHabitLog, sanitizeTaskXpLog, type HabitLog, type TaskXpLog } from './statsLog.ts';

export type CloudRow = Record<string, unknown> & { version: number };

export const CLOUD_TABLES = [
    'profiles', 'tasks', 'subtasks', 'habits', 'habit_logs', 'rest_days',
    'user_settings', 'stats_daily', 'characters', 'inventory_items', 'chests',
    'battle_attempts',
] as const;

export type CloudTableName = typeof CLOUD_TABLES[number];

export type CloudCache = Record<CloudTableName, Record<string, CloudRow>>;

export function createEmptyCloudCache(): CloudCache {
    return Object.fromEntries(CLOUD_TABLES.map((table) => [table, {}])) as CloudCache;
}

/** テーブルごとの行キー（PK） */
function rowKey(table: CloudTableName, row: CloudRow): string | null {
    switch (table) {
        case 'profiles':
        case 'user_settings':
        case 'characters':
            return typeof row.user_id === 'string' ? row.user_id : null;
        case 'habit_logs':
            return typeof row.habit_id === 'string' && typeof row.date === 'string'
                ? `${row.habit_id}:${row.date}` : null;
        case 'rest_days':
        case 'stats_daily':
            return typeof row.date === 'string' ? row.date : null;
        default:
            return typeof row.id === 'string' ? row.id : null;
    }
}

/**
 * バッチをキャッシュへ適用する（新しいキャッシュを返す）。
 * 同一行はversionが同じか進んでいる場合のみ置き換える。
 */
export function applyPullBatchToCache(cache: CloudCache, batch: PullBatch): CloudCache {
    const next: CloudCache = { ...cache };
    for (const table of CLOUD_TABLES) {
        const rows = batch[table];
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const updated = { ...next[table] };
        for (const raw of rows) {
            if (typeof raw !== 'object' || raw === null) continue;
            const row = raw as CloudRow;
            const key = rowKey(table, row);
            if (key === null) continue;
            const existing = updated[key];
            if (existing && Number(existing.version) > Number(row.version)) continue;
            updated[key] = row;
        }
        next[table] = updated;
    }
    return next;
}

/** キャッシュ内の全コンテンツ行数（空クラウド判定用。battle_attemptsは数えない） */
export function countCloudContentRows(cache: CloudCache): number {
    return CLOUD_TABLES
        .filter((table) => table !== 'battle_attempts' && table !== 'profiles' && table !== 'user_settings')
        .reduce((sum, table) => sum + Object.keys(cache[table]).length, 0);
}

export interface CloudSectionSeedability {
    tasks: boolean;
    habits: boolean;
    game: boolean;
}

/**
 * セクション単位で「クラウドを正としてストアへシードしてよいか」を判定する（#504）。
 *
 * アカウント作成直後のクラウドには初期行（profiles / user_settings /
 * characters version=1）だけが存在する。この状態で空のtasks/habitsや
 * 初期値のcharactersをシードすると、#506の移行前に存在する既存ローカルの
 * タスク・習慣・ゲーム状態を消してしまう。そこで:
 * - tasks / habits: そのセクションに1行でも届いていればシード可
 *   （墓標もクラウドに履歴がある証拠なので数える）
 * - game: charactersが初期行のまま（version 1以下）で、装備・宝箱・
 *   バトル履歴も無い場合はシードしない。ゲーム系の実操作があれば
 *   charactersのversionが進むか行が生まれる
 */
export function getSeedableSections(cache: CloudCache): CloudSectionSeedability {
    const character = Object.values(cache.characters)[0];
    const characterTouched = character !== undefined && Number(character.version) > 1;
    return {
        tasks: Object.keys(cache.tasks).length + Object.keys(cache.subtasks).length > 0,
        habits: Object.keys(cache.habits).length
            + Object.keys(cache.habit_logs).length
            + Object.keys(cache.rest_days).length
            + Object.keys(cache.stats_daily).length > 0,
        game: characterTouched
            || Object.keys(cache.inventory_items).length > 0
            || Object.keys(cache.chests).length > 0
            || Object.keys(cache.battle_attempts).length > 0,
    };
}

const notDeleted = (row: CloudRow): boolean => row.deleted_at == null;

function asString(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

// ─── スナップショット構築 ────────────────────────────────────

export function buildCanonicalTaskSnapshot(cache: CloudCache): CanonicalTaskSnapshot {
    const subtasksByTask = new Map<string, Subtask[]>();
    for (const row of Object.values(cache.subtasks)) {
        if (!notDeleted(row)) continue;
        const taskId = asString(row.task_id);
        const list = subtasksByTask.get(taskId) ?? [];
        list.push({
            id: asString(row.id),
            name: asString(row.name),
            completed: row.completed === true,
            completedAt: asNullableString(row.completed_at),
            createdAt: asString(row.created_at),
        });
        subtasksByTask.set(taskId, list);
    }
    for (const list of subtasksByTask.values()) {
        list.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    }

    const tasks: Task[] = Object.values(cache.tasks)
        .filter(notDeleted)
        .map((row) => ({
            id: asString(row.id),
            name: asString(row.name),
            dueDate: asNullableString(row.due_date),
            priority: asString(row.priority, 'medium') as Priority,
            tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [],
            subtasks: subtasksByTask.get(asString(row.id)) ?? [],
            recurrence: asString(row.recurrence, 'none') as Recurrence,
            completed: row.completed === true,
            completedAt: asNullableString(row.completed_at),
            createdAt: asString(row.created_at),
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

    return { schemaVersion: SYNC_SNAPSHOT_VERSION, tasks };
}

export function buildCanonicalHabitSnapshot(cache: CloudCache): CanonicalHabitSnapshot {
    const habits: Habit[] = Object.values(cache.habits)
        .filter(notDeleted)
        .map((row) => ({
            id: asString(row.id),
            name: asString(row.name),
            categoryId: asString(row.category_id, 'general'),
            createdAt: asString(row.created_at),
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

    const dailyRecords: HabitDailyRecord[] = Object.values(cache.habit_logs)
        .filter(notDeleted)
        .map((row) => ({
            habitId: asString(row.habit_id),
            date: asString(row.date),
            completed: row.completed === true,
            memo: asString(row.memo),
        }));

    const restDays: RestDay[] = Object.values(cache.rest_days)
        .filter(notDeleted)
        .map((row) => ({ date: asString(row.date), isRest: row.is_rest === true }));

    const allCompleteDates = Object.values(cache.stats_daily)
        .filter((row) => notDeleted(row) && row.all_habits_complete === true)
        .map((row) => asString(row.date))
        .sort();

    return { schemaVersion: SYNC_SNAPSHOT_VERSION, habits, dailyRecords, restDays, allCompleteDates };
}

/** characters 行が未取得なら null（ゲームセクションはシードしない） */
export function buildCanonicalGameSnapshot(cache: CloudCache): CanonicalGameSnapshot | null {
    const character = Object.values(cache.characters)[0];
    if (!character) return null;

    const totalXp = Number(character.total_xp ?? 0);
    const level = calculateLevel(totalXp);
    const characterState: CharacterState = {
        name: asString(character.name, CHARACTER_CONFIG.INITIAL_STATS.name),
        avatar: (character.avatar === 'male' ? 'male' : 'female'),
        level,
        totalXp,
        baseAttack: CHARACTER_CONFIG.INITIAL_STATS.attack + (level - 1) * CHARACTER_CONFIG.STAT_PER_LEVEL.attack,
        baseDefense: CHARACTER_CONFIG.INITIAL_STATS.defense + (level - 1) * CHARACTER_CONFIG.STAT_PER_LEVEL.defense,
        baseMaxHp: CHARACTER_CONFIG.INITIAL_STATS.maxHp + (level - 1) * CHARACTER_CONFIG.STAT_PER_LEVEL.maxHp,
    };

    const equipment: Equipment[] = Object.values(cache.inventory_items)
        .filter(notDeleted)
        .flatMap((row) => {
            const template = EQUIPMENT_POOL.find((candidate) => candidate.id === row.template_id);
            if (!template) return [];
            return [{ ...createEquipmentFromTemplate(asString(row.id), template), equipped: row.equipped === true }];
        });

    const chestQueue: ChestReward[] = Object.values(cache.chests)
        .filter((row) => notDeleted(row) && row.opened !== true)
        .map((row) => ({
            id: asString(row.id),
            chestType: asString(row.chest_type, 'wood') as ChestType,
            label: asString(row.label),
            opened: false,
            equipment: null,
            ...(row.is_starter_character === true ? { isStarterCharacter: true } : {}),
        }));

    // 報酬台帳はサーバーの reward_transactions が正。クライアント側の台帳は
    // 完了済みの証跡から再構成する（ローカルゲートの互換用途のみ）。
    const rewardedTaskIds = Object.values(cache.tasks)
        .filter((row) => notDeleted(row) && row.completed === true)
        .map((row) => asString(row.id));
    const rewardedSubtaskIds = Object.values(cache.subtasks)
        .filter((row) => notDeleted(row) && row.completed === true)
        .map((row) => asString(row.id));
    const habitBonusDates = Object.values(cache.stats_daily)
        .filter((row) => notDeleted(row) && row.all_habits_complete === true)
        .map((row) => asString(row.date));

    const profile = Object.values(cache.profiles)[0];

    return {
        schemaVersion: SYNC_SNAPSHOT_VERSION,
        character: characterState,
        equipment,
        chestQueue,
        gachaCount: Number(character.gacha_count ?? 0),
        rewardLedger: { rewardedTaskIds, rewardedSubtaskIds, habitBonusDates },
        activeTitle: profile ? asNullableString(profile.active_title) : null,
        debuff: {
            active: character.debuff_active === true,
            expiresAt: asNullableString(character.debuff_expires_at),
        },
        battleProgress: {
            battleUnlocked: character.battle_unlocked === true,
            currentStage: Number(character.current_stage ?? 1),
            maxClearedStage: Number(character.max_cleared_stage ?? 0),
        },
    };
}

/**
 * stats_daily行から統計ログ（TaskXpLog/HabitLog）を組み立てる。
 * 端末ローカルの統計ログとの合成は呼び出し側で mergeTaskXpLogs/mergeHabitLogs を使う
 * （このキャッシュはWeb/Mobile初回移行時の一括アップロードのみを反映しており、
 * 以後の継続更新は未対応のため、ローカル側の値を下回ることがあり得る）。
 */
export function buildStatsLogSnapshot(cache: CloudCache): { taskXpLog: TaskXpLog; habitLog: HabitLog } {
    const taskXpLog: TaskXpLog = {};
    const habitLog: HabitLog = {};
    for (const row of Object.values(cache.stats_daily)) {
        if (!notDeleted(row)) continue;
        const date = asString(row.date);
        if (!date) continue;
        taskXpLog[date] = Number(row.task_xp ?? 0);
        habitLog[date] = {
            count: Number(row.habit_count ?? 0),
            allComplete: row.all_habits_complete === true,
        };
    }
    return { taskXpLog: sanitizeTaskXpLog(taskXpLog), habitLog: sanitizeHabitLog(habitLog) };
}

// ─── user_id別namespaceの永続化（ADR-009） ──────────────────────

const CACHE_SECTIONS = {
    tasks: ['tasks', 'subtasks'],
    habits: ['habits', 'habit_logs', 'rest_days', 'stats_daily'],
    game: ['characters', 'inventory_items', 'chests', 'battle_attempts'],
    profile: ['profiles', 'user_settings'],
} as const satisfies Record<string, readonly CloudTableName[]>;

export type CloudCacheSection = keyof typeof CACHE_SECTIONS;

export function cloudCacheKey(userId: string, section: CloudCacheSection): string {
    return `life-quest:cloud:${userId}:cache:${section}:v1`;
}

/** キャッシュ全体をセクション別キーへ保存する */
export async function persistCloudCache(
    storage: RepositoryStorage,
    userId: string,
    cache: CloudCache,
): Promise<void> {
    for (const [section, tables] of Object.entries(CACHE_SECTIONS)) {
        const payload = Object.fromEntries(tables.map((table) => [table, cache[table]]));
        await storage.setItem(cloudCacheKey(userId, section as CloudCacheSection), JSON.stringify(payload));
    }
}

/** セクション別キーからキャッシュを復元する（壊れたセクションは空扱い） */
export async function loadCloudCache(
    storage: RepositoryStorage,
    userId: string,
): Promise<CloudCache> {
    const cache = createEmptyCloudCache();
    for (const [section, tables] of Object.entries(CACHE_SECTIONS)) {
        const raw = await storage.getItem(cloudCacheKey(userId, section as CloudCacheSection));
        if (!raw) continue;
        try {
            const parsed = JSON.parse(raw) as Record<string, Record<string, CloudRow>>;
            for (const table of tables) {
                const rows = parsed[table];
                if (rows && typeof rows === 'object' && !Array.isArray(rows)) {
                    cache[table] = rows;
                }
            }
        } catch {
            // 壊れたセクションは空のまま（次のプルで再構築される）
        }
    }
    return cache;
}
