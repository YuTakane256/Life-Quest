/** Parse only small error bodies; never include arbitrary server/gateway diagnostics. */
const MAX_ERROR_TEXT_LENGTH = 4096;
const ERROR_CODES = new Map<number, ReadonlySet<string>>([
    [400, new Set([
        'invalid_json', 'invalid_body', 'invalid_stage', 'invalid_actions', 'invalid_date',
        'invalid_platform', 'invalid_snapshot', 'invalid_content', 'payload too large', 'settings payload too large',
        'invalid ingredients: wrong count', 'apple_identity_not_found',
        'missing_or_invalid_authorization_code', 'missing_or_invalid_refresh_token',
        ...['idempotencyKey', 'taskId', 'subtaskId', 'date', 'chestId', 'itemId', 'battleAttemptId', 'client_id']
            .map((field) => `missing_or_invalid_${field}`),
    ])],
    [401, new Set(['unauthorized'])],
    [404, new Set(['not_found_or_forbidden', 'character_missing', 'unknown_template'])],
    [405, new Set(['method_not_allowed'])],
    [409, new Set([
        'stage_locked', 'battle_locked', 'cannot_sell_equipped_item', 'chest_already_opened',
        'web_migration_required', 'auth_user_mismatch', 'idempotency_key_operation_mismatch',
        'invalid ingredients', 'invalid ingredients: bad count', 'invalid ingredients: duplicates',
        'invalid ingredients: synthesis rules not satisfied', 'no synthesis candidates', 'habits_not_all_complete',
    ])],
    [413, new Set(['payload_too_large'])],
    [422, new Set(['actions_do_not_resolve_battle'])],
    [500, new Set(['internal_error', 'auth_failure', 'account_deletion_failed', 'apple_authorization_record_failed', 'idempotency_key_operation_mismatch'])],
    [503, new Set(['apple_revocation_failed'])],
]);

/** Rebuild a single fixed error code; JSON details/hints and unknown codes never escape. */
export function sanitizeEdgeErrorDetail(status: number, text: string): string {
    if (text.length > MAX_ERROR_TEXT_LENGTH) return '';
    try {
        const parsed: unknown = JSON.parse(text);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || !('error' in parsed)) return '';
        if (typeof parsed.error !== 'string' || !ERROR_CODES.get(status)?.has(parsed.error)) return '';
        return JSON.stringify({ error: parsed.error });
    } catch {
        return '';
    }
}

export function edgeHttpErrorMessage(name: string, status: number, detail: string): string {
    if (status === 413) return '送信データが大きすぎるため、処理できません。内容を確認してください。';
    return `${name} failed: ${status}${detail ? ` ${detail}` : ''}`;
}
