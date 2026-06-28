export type PersistedStateRecord = Record<string, unknown>;

export function isPersistedStateRecord(value: unknown): value is PersistedStateRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readPersistedStateRecord(value: unknown): PersistedStateRecord {
    return isPersistedStateRecord(value) ? value : {};
}

export function createSafePersistMerge<TState extends object>(
    sanitize: (persisted: PersistedStateRecord, current: TState) => Partial<TState>
) {
    return (persisted: unknown, current: TState): TState => {
        try {
            const sanitized = sanitize(readPersistedStateRecord(persisted), current);
            const merged = { ...current } as unknown as PersistedStateRecord;
            const currentRecord = current as TState & PersistedStateRecord;

            for (const [key, value] of Object.entries(sanitized)) {
                if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
                if (typeof currentRecord[key] === 'function') continue;
                merged[key] = value;
            }

            return merged as TState;
        } catch {
            return current;
        }
    };
}
