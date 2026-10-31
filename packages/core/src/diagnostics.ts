/** Fixed event labels: never interpolate account, operation IDs, payloads or exception text. */
const DIAGNOSTIC_LABELS = {
    canonical_sync_init_failed: 'canonical sync init failed',
    login_bonus_check_failed: 'checkDailyLogin failed',
    task_reward_stats_failed: 'Reward is committed, but its statistics could not be saved.',
    anonymous_session_prepare_failed: 'Anonymous session preparation failed; cloud cache is retained.',
    web_cloud_import_failed: 'web cloud import failed (will retry next login)',
    mobile_pre_migration_backup_failed: 'pre-migration backup failed',
    outbox_permanent_failure: 'outbox op failed permanently',
} as const;

export type ClientDiagnosticEvent = keyof typeof DIAGNOSTIC_LABELS;
export type SafeErrorName = 'TypeError' | 'RangeError' | 'SyntaxError' | 'ReferenceError' | 'URIError' | 'EvalError' | 'Error' | 'UnknownError';

/** Class identity only. error.name/message/stack/code/cause/toJSON may contain data or getters. */
export function getSafeErrorName(error: unknown): SafeErrorName {
    try {
        if (error instanceof TypeError) return 'TypeError';
        if (error instanceof RangeError) return 'RangeError';
        if (error instanceof SyntaxError) return 'SyntaxError';
        if (error instanceof ReferenceError) return 'ReferenceError';
        if (error instanceof URIError) return 'URIError';
        if (error instanceof EvalError) return 'EvalError';
        return error instanceof Error ? 'Error' : 'UnknownError';
    } catch {
        // Hostile/revoked proxies must not break the recovery path while being reported.
        return 'UnknownError';
    }
}

export function createClientDiagnosticLogArgs(event: ClientDiagnosticEvent, error?: unknown): [
    message: string,
    metadata: { event: ClientDiagnosticEvent | 'unknown_diagnostic'; redacted: true; errorName: SafeErrorName },
] {
    if (typeof event !== 'string' || !Object.prototype.hasOwnProperty.call(DIAGNOSTIC_LABELS, event)) {
        return ['client diagnostic', { event: 'unknown_diagnostic', redacted: true, errorName: getSafeErrorName(error) }];
    }
    return [DIAGNOSTIC_LABELS[event], { event, redacted: true, errorName: getSafeErrorName(error) }];
}
