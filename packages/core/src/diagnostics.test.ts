import { describe, expect, it, vi } from 'vitest';
import { createClientDiagnosticLogArgs, getSafeErrorName, type ClientDiagnosticEvent } from './diagnostics.ts';

const marker = 'private-diagnostic-marker';
describe('client diagnostics contain fixed metadata only', () => {
    it.each([
        [new TypeError(marker), 'TypeError'], [new RangeError(marker), 'RangeError'],
        [new SyntaxError(marker), 'SyntaxError'], [new ReferenceError(marker), 'ReferenceError'],
        [new URIError(marker), 'URIError'], [new EvalError(marker), 'EvalError'], [new Error(marker), 'Error'],
    ] as const)('classifies standard errors without copying their fields', (error, name) => {
        error.name = marker;
        Object.assign(error, { code: marker, cause: { value: marker } });
        const args = createClientDiagnosticLogArgs('canonical_sync_init_failed', error);
        expect(args).toEqual(['canonical sync init failed', { event: 'canonical_sync_init_failed', redacted: true, errorName: name }]);
        expect(JSON.stringify(args)).not.toContain(marker);
        expect(args).not.toContain(error);
    });
    it.each([null, undefined, marker, { name: 'TypeError', message: marker }, [], 42])('does not inspect non-Error values', (error) => {
        expect(getSafeErrorName(error)).toBe('UnknownError');
        expect(JSON.stringify(createClientDiagnosticLogArgs('web_cloud_import_failed', error))).not.toContain(marker);
    });
    it('does not access diagnostic getters or serialization hooks', () => {
        const read = vi.fn(() => { throw new Error(marker); });
        const error = Object.create(Error.prototype);
        for (const key of ['name', 'message', 'stack', 'code', 'cause', 'toJSON']) Object.defineProperty(error, key, { get: read });
        expect(getSafeErrorName(error)).toBe('Error');
        expect(JSON.stringify(createClientDiagnosticLogArgs('login_bonus_check_failed', error))).not.toContain(marker);
        expect(read).not.toHaveBeenCalled();
    });
    it('handles cyclic throwables without serializing them', () => {
        const error: { data: string; self?: unknown } = { data: marker }; error.self = error;
        expect(() => JSON.stringify(createClientDiagnosticLogArgs('mobile_pre_migration_backup_failed', error))).not.toThrow();
        expect(getSafeErrorName(error)).toBe('UnknownError');
    });
    it('handles a proxy that throws during classification', () => {
        const error = new Proxy({}, { getPrototypeOf() { throw new Error(marker); } });
        expect(getSafeErrorName(error)).toBe('UnknownError');
        expect(JSON.stringify(createClientDiagnosticLogArgs('task_reward_stats_failed', error))).not.toContain(marker);
    });
    it('handles revoked proxies', () => {
        const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
        expect(getSafeErrorName(proxy)).toBe('UnknownError');
    });
    it.each([marker, '__proto__', 'constructor'])('does not echo an invalid runtime event: %s', (event) => {
        const args = createClientDiagnosticLogArgs(event as ClientDiagnosticEvent, new Error(marker));
        expect(args).toEqual(['client diagnostic', { event: 'unknown_diagnostic', redacted: true, errorName: 'Error' }]);
        expect(JSON.stringify(args)).not.toContain(marker);
    });
    it('keeps a fixed outbox failure event without operation identifiers', () => {
        expect(createClientDiagnosticLogArgs('outbox_permanent_failure')).toEqual([
            'outbox op failed permanently', { event: 'outbox_permanent_failure', redacted: true, errorName: 'UnknownError' },
        ]);
    });
});
