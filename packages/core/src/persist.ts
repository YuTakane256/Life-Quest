export type PersistedStateRecord = Record<string, unknown>;

export interface PersistStorageEnvelope {
    state: PersistedStateRecord;
    version?: number;
}

export interface NormalizedPersistStorageEnvelope {
    state: PersistedStateRecord;
    version: number | null;
}

const BLOCKED_MERGE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function isPersistedStateRecord(value: unknown): value is PersistedStateRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readPersistedStateRecord(value: unknown): PersistedStateRecord {
    return isPersistedStateRecord(value) ? value : {};
}

export function isPersistStorageEnvelope(value: unknown): value is PersistStorageEnvelope {
    if (!isPersistedStateRecord(value)) return false;
    if (!isPersistedStateRecord(value.state)) return false;
    return value.version === undefined || (typeof value.version === 'number' && Number.isFinite(value.version));
}

export function readPersistStorageEnvelope(value: unknown): NormalizedPersistStorageEnvelope {
    if (!isPersistStorageEnvelope(value)) {
        return { state: {}, version: null };
    }

    return {
        state: value.state,
        version: value.version === undefined ? null : value.version,
    };
}

export function parsePersistStorageEnvelope(text: string): NormalizedPersistStorageEnvelope | null {
    try {
        return readPersistStorageEnvelope(JSON.parse(text));
    } catch {
        return null;
    }
}

export function createPersistStorageEnvelope(
    state: unknown,
    version?: number,
): PersistStorageEnvelope {
    return {
        state: readPersistedStateRecord(state),
        ...(typeof version === 'number' && Number.isFinite(version) ? { version } : {}),
    };
}

export function serializePersistStorageEnvelope(state: unknown, version?: number): string {
    return JSON.stringify(createPersistStorageEnvelope(state, version));
}

export function createSafePersistMerge<TState extends object>(
    sanitize: (persisted: PersistedStateRecord, current: TState) => Partial<TState>,
) {
    return (persisted: unknown, current: TState): TState => {
        try {
            const sanitized = sanitize(readPersistedStateRecord(persisted), current);
            const merged = { ...current } as unknown as PersistedStateRecord;
            const currentRecord = current as TState & PersistedStateRecord;

            for (const [key, value] of Object.entries(sanitized)) {
                if (BLOCKED_MERGE_KEYS.has(key)) continue;
                if (typeof currentRecord[key] === 'function') continue;
                merged[key] = value;
            }

            return merged as TState;
        } catch {
            return current;
        }
    };
}
