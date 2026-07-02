import {
    sanitizeCanonicalGameSnapshot,
    sanitizeCanonicalHabitSnapshot,
    sanitizeCanonicalTaskSnapshot,
    SYNC_SNAPSHOT_VERSION,
    type CanonicalGameSnapshot,
    type CanonicalHabitSnapshot,
    type CanonicalTaskSnapshot,
} from './syncSnapshots';

export const SNAPSHOT_REPOSITORY_VERSION = 1 as const;

export const CANONICAL_STORAGE_KEYS = {
    tasks: 'life-quest:canonical:tasks:v1',
    habits: 'life-quest:canonical:habits:v1',
    game: 'life-quest:canonical:game:v1',
} as const;

export type RepositoryStorageResult<T> = T | Promise<T>;

export interface RepositoryStorage {
    getItem: (key: string) => RepositoryStorageResult<string | null>;
    setItem: (key: string, value: string) => RepositoryStorageResult<void>;
    removeItem: (key: string) => RepositoryStorageResult<void>;
}

export interface VersionedSnapshot {
    schemaVersion: number;
}

export interface SnapshotRepositoryEnvelope<TSnapshot extends VersionedSnapshot> {
    repositoryVersion: typeof SNAPSHOT_REPOSITORY_VERSION;
    revision: number;
    updatedAt: string;
    data: TSnapshot;
}

export type RepositoryLoadResult<TSnapshot extends VersionedSnapshot> =
    | { status: 'empty' }
    | { status: 'ready'; value: SnapshotRepositoryEnvelope<TSnapshot> }
    | { status: 'corrupt' }
    | { status: 'unsupported'; repositoryVersion: number | null; schemaVersion: number | null }
    | { status: 'storage-error' };

export type RepositoryWriteFailure = {
    ok: false;
    reason: 'conflict' | 'corrupt' | 'unsupported' | 'storage-error' | 'invalid';
    currentRevision: number | null;
};

export type RepositorySaveResult<TSnapshot extends VersionedSnapshot> =
    | { ok: true; value: SnapshotRepositoryEnvelope<TSnapshot> }
    | RepositoryWriteFailure;

export type RepositoryRemoveResult =
    | { ok: true; removed: boolean }
    | RepositoryWriteFailure;

export interface SnapshotRepository<TSnapshot extends VersionedSnapshot> {
    readonly storageKey: string;
    load: () => Promise<RepositoryLoadResult<TSnapshot>>;
    save: (data: unknown, expectedRevision: number | null) => Promise<RepositorySaveResult<TSnapshot>>;
    remove: (expectedRevision: number | null) => Promise<RepositoryRemoveResult>;
}

export interface SnapshotRepositoryOptions<TSnapshot extends VersionedSnapshot> {
    storage: RepositoryStorage;
    storageKey: string;
    schemaVersion: number;
    sanitize: (value: unknown) => TSnapshot;
    now?: () => Date;
}

export interface CanonicalSnapshotRepositories {
    tasks: SnapshotRepository<CanonicalTaskSnapshot>;
    habits: SnapshotRepository<CanonicalHabitSnapshot>;
    game: SnapshotRepository<CanonicalGameSnapshot>;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readVersion(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function readCurrentRevision<TSnapshot extends VersionedSnapshot>(
    result: RepositoryLoadResult<TSnapshot>,
): number | null {
    return result.status === 'ready' ? result.value.revision : null;
}

function toWriteFailure<TSnapshot extends VersionedSnapshot>(
    result: RepositoryLoadResult<TSnapshot>,
): RepositoryWriteFailure | null {
    if (result.status === 'corrupt') {
        return { ok: false, reason: 'corrupt', currentRevision: null };
    }
    if (result.status === 'unsupported') {
        return { ok: false, reason: 'unsupported', currentRevision: null };
    }
    if (result.status === 'storage-error') {
        return { ok: false, reason: 'storage-error', currentRevision: null };
    }
    return null;
}

export function createSnapshotRepository<TSnapshot extends VersionedSnapshot>(
    options: SnapshotRepositoryOptions<TSnapshot>,
): SnapshotRepository<TSnapshot> {
    let writeQueue: Promise<void> = Promise.resolve();

    const load = async (): Promise<RepositoryLoadResult<TSnapshot>> => {
        let raw: string | null;
        try {
            raw = await options.storage.getItem(options.storageKey);
        } catch {
            return { status: 'storage-error' };
        }
        if (raw === null) return { status: 'empty' };

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return { status: 'corrupt' };
        }
        if (!isRecord(parsed)) return { status: 'corrupt' };

        const repositoryVersion = readVersion(parsed.repositoryVersion);
        const data = parsed.data;
        const schemaVersion = isRecord(data) ? readVersion(data.schemaVersion) : null;
        if (repositoryVersion === null || schemaVersion === null) {
            return { status: 'corrupt' };
        }
        if (
            repositoryVersion !== SNAPSHOT_REPOSITORY_VERSION
            || schemaVersion !== options.schemaVersion
        ) {
            return { status: 'unsupported', repositoryVersion, schemaVersion };
        }

        const revision = readVersion(parsed.revision);
        if (revision === null || revision < 1 || typeof parsed.updatedAt !== 'string') {
            return { status: 'corrupt' };
        }
        const updatedAtMs = new Date(parsed.updatedAt).getTime();
        if (!Number.isFinite(updatedAtMs)) return { status: 'corrupt' };

        try {
            const sanitized = options.sanitize(data);
            if (sanitized.schemaVersion !== options.schemaVersion) {
                return { status: 'corrupt' };
            }
            return {
                status: 'ready',
                value: {
                    repositoryVersion: SNAPSHOT_REPOSITORY_VERSION,
                    revision,
                    updatedAt: new Date(updatedAtMs).toISOString(),
                    data: sanitized,
                },
            };
        } catch {
            return { status: 'corrupt' };
        }
    };

    const runExclusive = <TResult>(operation: () => Promise<TResult>): Promise<TResult> => {
        const result = writeQueue.then(operation, operation);
        writeQueue = result.then(() => undefined, () => undefined);
        return result;
    };

    const save = (
        data: unknown,
        expectedRevision: number | null,
    ): Promise<RepositorySaveResult<TSnapshot>> => runExclusive(async () => {
        const current = await load();
        const loadFailure = toWriteFailure(current);
        if (loadFailure) return loadFailure;

        const currentRevision = readCurrentRevision(current);
        if (currentRevision !== expectedRevision) {
            return { ok: false, reason: 'conflict', currentRevision };
        }

        let sanitized: TSnapshot;
        try {
            sanitized = options.sanitize(data);
        } catch {
            return { ok: false, reason: 'invalid', currentRevision };
        }
        if (sanitized.schemaVersion !== options.schemaVersion) {
            return { ok: false, reason: 'invalid', currentRevision };
        }

        let updatedAt: string;
        try {
            updatedAt = (options.now ?? (() => new Date()))().toISOString();
        } catch {
            return { ok: false, reason: 'invalid', currentRevision };
        }
        const envelope: SnapshotRepositoryEnvelope<TSnapshot> = {
            repositoryVersion: SNAPSHOT_REPOSITORY_VERSION,
            revision: (currentRevision ?? 0) + 1,
            updatedAt,
            data: sanitized,
        };
        let serialized: string;
        try {
            serialized = JSON.stringify(envelope);
        } catch {
            return { ok: false, reason: 'invalid', currentRevision };
        }
        try {
            await options.storage.setItem(options.storageKey, serialized);
            return { ok: true, value: envelope };
        } catch {
            return { ok: false, reason: 'storage-error', currentRevision };
        }
    });

    const remove = (
        expectedRevision: number | null,
    ): Promise<RepositoryRemoveResult> => runExclusive(async () => {
        const current = await load();
        const loadFailure = toWriteFailure(current);
        if (loadFailure) return loadFailure;

        const currentRevision = readCurrentRevision(current);
        if (currentRevision !== expectedRevision) {
            return { ok: false, reason: 'conflict', currentRevision };
        }
        if (current.status === 'empty') return { ok: true, removed: false };

        try {
            await options.storage.removeItem(options.storageKey);
            return { ok: true, removed: true };
        } catch {
            return { ok: false, reason: 'storage-error', currentRevision };
        }
    });

    return { storageKey: options.storageKey, load, save, remove };
}

export function createCanonicalSnapshotRepositories(
    storage: RepositoryStorage,
    now?: () => Date,
): CanonicalSnapshotRepositories {
    return {
        tasks: createSnapshotRepository({
            storage,
            storageKey: CANONICAL_STORAGE_KEYS.tasks,
            schemaVersion: SYNC_SNAPSHOT_VERSION,
            sanitize: sanitizeCanonicalTaskSnapshot,
            now,
        }),
        habits: createSnapshotRepository({
            storage,
            storageKey: CANONICAL_STORAGE_KEYS.habits,
            schemaVersion: SYNC_SNAPSHOT_VERSION,
            sanitize: sanitizeCanonicalHabitSnapshot,
            now,
        }),
        game: createSnapshotRepository({
            storage,
            storageKey: CANONICAL_STORAGE_KEYS.game,
            schemaVersion: SYNC_SNAPSHOT_VERSION,
            sanitize: sanitizeCanonicalGameSnapshot,
            now,
        }),
    };
}
