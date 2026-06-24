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
            return {
                ...current,
                ...sanitize(readPersistedStateRecord(persisted), current),
            };
        } catch {
            return current;
        }
    };
}
