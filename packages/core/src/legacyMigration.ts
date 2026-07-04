/**
 * 既存の Zustand persist データ（Web localStorage / Mobile AsyncStorage の
 * `quest-board-*` キー）を canonical Repository（`life-quest:canonical:*:v1`）へ
 * 初回移行するサービス。
 *
 * 安全方針:
 * - 旧データは**読み取り専用**。型レベルでも getItem しか受け取らないため、
 *   このサービスが旧キーを削除・上書きすることは構造的にできない。
 *   移行成功後も旧データはバックアップとしてそのまま残る。
 * - canonical 側が empty のセクションにだけ書き込む。ready（既存データあり）・
 *   corrupt・unsupported・storage-error はすべて書き込み対象外として報告する。
 * - すべての旧データを読み取り・変換してから書き込みを始める（変換は純関数の
 *   converter 群で、UI一時状態・戦闘ログ・敵HPは canonical 契約に含まれない）。
 * - 書き込みは tasks → habits → game の順で、各セクションが独立。途中で失敗しても
 *   成功済みセクションは canonical に残り、再実行では empty なセクションだけを
 *   書き直すため、再実行しても安全（冪等）。報酬台帳は game セクションの1回の
 *   書き込みに閉じているため重複しない。
 * - 進行状況を journal キーへ記録し、部分失敗（finishedAt が null のまま・
 *   failed セクション）を後から検出できる。
 * - 呼び出しは明示的（アプリ起動時の自動実行はしない）。
 */
import {
    convertLegacyGameSnapshot,
    convertLegacyHabitSnapshot,
    convertLegacyTaskSnapshot,
} from './syncSnapshots.ts';
import type {
    CanonicalSnapshotRepositories,
    RepositoryStorage,
    SnapshotRepository,
    VersionedSnapshot,
} from './syncRepository.ts';

export const LEGACY_STORAGE_KEYS = {
    tasks: 'quest-board-tasks',
    habits: 'quest-board-habits',
    game: 'quest-board-game',
    title: 'quest-board-title',
} as const;

export const MIGRATION_JOURNAL_KEY = 'life-quest:migration:journal:v1';
export const MIGRATION_JOURNAL_VERSION = 1 as const;

/** 旧データソースは読み取り専用。setItem / removeItem を受け取らない。 */
export type LegacyStorageReader = Pick<RepositoryStorage, 'getItem'>;

export type MigrationSection = 'tasks' | 'habits' | 'game';

export type MigrationSectionStatus =
    /** この実行で canonical へ書き込んだ */
    | 'migrated'
    /** canonical に既存データがあるため書き込まなかった */
    | 'skipped-existing'
    /** canonical が corrupt / unsupported / storage-error のため書き込まなかった */
    | 'skipped-unsafe'
    /** 対応する旧データが存在しない */
    | 'no-legacy'
    /** 旧データのJSONが壊れているため書き込まなかった（旧データはそのまま残る） */
    | 'legacy-corrupt'
    /** 書き込みを試みたが失敗した（再実行で復旧可能） */
    | 'failed';

export interface MigrationSectionResult {
    status: MigrationSectionStatus;
    /** skipped-unsafe / failed の詳細（canonical状態や書き込み失敗理由） */
    reason?: string;
    /** migrated のとき、書き込まれた canonical revision */
    revision?: number;
}

export interface MigrationJournal {
    journalVersion: typeof MIGRATION_JOURNAL_VERSION;
    /** 何回目の移行実行か（再実行の検出用） */
    attempt: number;
    startedAt: string;
    /** null のままなら実行が中断された（部分失敗の検出） */
    finishedAt: string | null;
    sections: Record<MigrationSection, MigrationSectionStatus | 'pending'>;
}

export interface MigrationReport {
    /** 中断なし・failedセクションなしで完了したか */
    ok: boolean;
    /** 旧データの読み取り自体に失敗し、何も書き込まずに中止したか */
    aborted: boolean;
    sections: Record<MigrationSection, MigrationSectionResult>;
    /** journal の書き込み結果。移行対象が無ければ skipped */
    journal: 'saved' | 'write-failed' | 'skipped';
}

export interface LegacyMigrationOptions {
    /** 旧 `quest-board-*` キーの読み取り元（読み取り専用） */
    legacySource: LegacyStorageReader;
    /** #480 の canonical Repository 群（書き込み先） */
    repositories: CanonicalSnapshotRepositories;
    /** journal の保存先ストレージ */
    journalStorage: RepositoryStorage;
    now?: () => Date;
}

type UnknownRecord = Record<string, unknown>;

/** セクションのRepositoryを共通のsnapshot型で扱う（loadとsaveしか使わない）。 */
function repositoryFor(
    repositories: CanonicalSnapshotRepositories,
    section: MigrationSection,
): SnapshotRepository<VersionedSnapshot> {
    return repositories[section] as SnapshotRepository<VersionedSnapshot>;
}

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface LegacyValue {
    present: boolean;
    corrupt: boolean;
    parsed: unknown;
}

async function readLegacyValue(source: LegacyStorageReader, key: string): Promise<LegacyValue> {
    const raw = await source.getItem(key);
    if (raw === null) return { present: false, corrupt: false, parsed: undefined };
    try {
        return { present: true, corrupt: false, parsed: JSON.parse(raw) };
    } catch {
        return { present: true, corrupt: true, parsed: undefined };
    }
}

async function readJournalAttempt(storage: RepositoryStorage): Promise<number> {
    try {
        const raw = await storage.getItem(MIGRATION_JOURNAL_KEY);
        if (raw === null) return 1;
        const parsed: unknown = JSON.parse(raw);
        if (isRecord(parsed) && typeof parsed.attempt === 'number' && Number.isInteger(parsed.attempt) && parsed.attempt >= 1) {
            return parsed.attempt + 1;
        }
        return 1;
    } catch {
        return 1;
    }
}

async function writeJournal(storage: RepositoryStorage, journal: MigrationJournal): Promise<boolean> {
    try {
        await storage.setItem(MIGRATION_JOURNAL_KEY, JSON.stringify(journal));
        return true;
    } catch {
        return false;
    }
}

/**
 * canonical 側の状態を調べ、書き込みできないセクションの結果を返す。
 * empty のときだけ null（=書き込み可）を返す。
 */
async function checkCanonicalWritable<TSnapshot extends VersionedSnapshot>(
    repository: SnapshotRepository<TSnapshot>,
): Promise<MigrationSectionResult | null> {
    const current = await repository.load();
    if (current.status === 'empty') return null;
    if (current.status === 'ready') {
        return { status: 'skipped-existing' };
    }
    return { status: 'skipped-unsafe', reason: `canonical-${current.status}` };
}

async function writeSection<TSnapshot extends VersionedSnapshot>(
    repository: SnapshotRepository<TSnapshot>,
    data: unknown,
): Promise<MigrationSectionResult> {
    // expectedRevision: null = 「empty のときだけ書き込む」。事前チェック後に他の
    // 書き込みが割り込んだ場合も conflict になり、既存データを上書きしない。
    const result = await repository.save(data, null);
    if (result.ok) {
        return { status: 'migrated', revision: result.value.revision };
    }
    return { status: 'failed', reason: result.reason };
}

/**
 * 旧 `quest-board-*` データを canonical Repository へ初回移行する。
 * 何度呼んでも安全（migrated 済みセクションは skipped-existing になる）。
 */
export async function migrateLegacyQuestBoardData(
    options: LegacyMigrationOptions,
): Promise<MigrationReport> {
    const now = options.now ?? (() => new Date());

    // ── フェーズ1: すべての旧データを読み取る（1つでも読めなければ中止） ──
    let tasks: LegacyValue;
    let habits: LegacyValue;
    let game: LegacyValue;
    let title: LegacyValue;
    try {
        tasks = await readLegacyValue(options.legacySource, LEGACY_STORAGE_KEYS.tasks);
        habits = await readLegacyValue(options.legacySource, LEGACY_STORAGE_KEYS.habits);
        game = await readLegacyValue(options.legacySource, LEGACY_STORAGE_KEYS.game);
        title = await readLegacyValue(options.legacySource, LEGACY_STORAGE_KEYS.title);
    } catch {
        const failure: MigrationSectionResult = { status: 'failed', reason: 'legacy-read-error' };
        return {
            ok: false,
            aborted: true,
            sections: { tasks: failure, habits: failure, game: failure },
            journal: 'skipped',
        };
    }

    // ── フェーズ2: 書き込み前にすべて変換する ──
    // ゲームは称号・タスク・サブタスク・習慣を移行証跡として受け取り、
    // 完了済みの作業が移行後に再度報酬化されないよう台帳へ焼き込む。
    // 壊れた旧データ（corrupt）は証跡としても使わない。
    const sections: Record<MigrationSection, MigrationSectionResult> = {
        tasks: { status: 'no-legacy' },
        habits: { status: 'no-legacy' },
        game: { status: 'no-legacy' },
    };
    const conversions: Partial<Record<MigrationSection, unknown>> = {};

    if (tasks.present) {
        if (tasks.corrupt) {
            sections.tasks = { status: 'legacy-corrupt' };
        } else {
            conversions.tasks = convertLegacyTaskSnapshot(tasks.parsed);
        }
    }
    if (habits.present) {
        if (habits.corrupt) {
            sections.habits = { status: 'legacy-corrupt' };
        } else {
            conversions.habits = convertLegacyHabitSnapshot(habits.parsed);
        }
    }
    // 報酬証跡を焼き込むため、game 自体が無くても tasks / habits / title の
    // いずれかが健全に存在すれば game セクションを作る。
    const hasGameEvidence = conversions.tasks !== undefined
        || conversions.habits !== undefined
        || (title.present && !title.corrupt);
    if (game.present && game.corrupt) {
        sections.game = { status: 'legacy-corrupt' };
    } else if ((game.present && !game.corrupt) || hasGameEvidence) {
        conversions.game = convertLegacyGameSnapshot({
            game: game.corrupt ? undefined : game.parsed,
            title: title.corrupt ? undefined : title.parsed,
            tasks: tasks.corrupt ? undefined : tasks.parsed,
            habits: habits.corrupt ? undefined : habits.parsed,
        });
    }

    // ── フェーズ3: canonical 側の状態を確認する ──
    const plan: MigrationSection[] = [];
    for (const section of ['tasks', 'habits', 'game'] as const) {
        if (conversions[section] === undefined) continue;
        const blocked = await checkCanonicalWritable(repositoryFor(options.repositories, section));
        if (blocked) {
            sections[section] = blocked;
        } else {
            plan.push(section);
        }
    }

    // 移行対象が1つも無ければ journal を作らずに終了する（新規インストールを汚さない）
    if (plan.length === 0) {
        const ok = Object.values(sections).every((result) => result.status !== 'failed');
        return { ok, aborted: false, sections, journal: 'skipped' };
    }

    // ── フェーズ4: journal を開始し、セクションごとに書き込む ──
    const journal: MigrationJournal = {
        journalVersion: MIGRATION_JOURNAL_VERSION,
        attempt: await readJournalAttempt(options.journalStorage),
        startedAt: now().toISOString(),
        finishedAt: null,
        sections: {
            tasks: plan.includes('tasks') ? 'pending' : sections.tasks.status,
            habits: plan.includes('habits') ? 'pending' : sections.habits.status,
            game: plan.includes('game') ? 'pending' : sections.game.status,
        },
    };
    let journalHealthy = await writeJournal(options.journalStorage, journal);

    for (const section of plan) {
        sections[section] = await writeSection(repositoryFor(options.repositories, section), conversions[section]);
        journal.sections[section] = sections[section].status;
        journalHealthy = await writeJournal(options.journalStorage, journal) && journalHealthy;
    }

    journal.finishedAt = now().toISOString();
    journalHealthy = await writeJournal(options.journalStorage, journal) && journalHealthy;

    const ok = Object.values(sections).every((result) => result.status !== 'failed');
    return {
        ok,
        aborted: false,
        sections,
        journal: journalHealthy ? 'saved' : 'write-failed',
    };
}
