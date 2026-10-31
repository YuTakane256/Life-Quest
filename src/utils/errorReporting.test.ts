import { describe, expect, it } from 'vitest';
import { createRenderErrorLogArgs } from './errorReporting';

describe('createRenderErrorLogArgs', () => {
    it('keeps full render error details in development', () => {
        const error = new Error('user entered secret value');
        const info = { componentStack: '\n    at SecretComponent' };

        expect(createRenderErrorLogArgs(error, info, true)).toEqual([
            'Unhandled app render error',
            error,
            info,
        ]);
    });

    it('redacts original error and component stack in production', () => {
        const error = new TypeError('user entered secret value');
        const info = { componentStack: '\n    at SecretComponent' };

        const args = createRenderErrorLogArgs(error, info, false);

        expect(args).toEqual([
            'Unhandled app render error',
            {
                redacted: true,
                errorName: 'TypeError',
                hasComponentStack: true,
            },
        ]);
        expect(args).not.toContain(error);
        expect(JSON.stringify(args)).not.toContain('secret value');
        expect(JSON.stringify(args)).not.toContain('SecretComponent');
    });

    it('handles non-Error throwables without exposing the value', () => {
        expect(createRenderErrorLogArgs('plain secret', {}, false)).toEqual([
            'Unhandled app render error',
            {
                redacted: true,
                errorName: 'UnknownError',
                hasComponentStack: false,
            },
        ]);
    });
    it.each([new Error('private diagnostic'), new TypeError('private diagnostic')])('does not trust a custom error.name in production', (error) => {
        error.name = 'private-error-name';
        const args = createRenderErrorLogArgs(error, {}, false);
        expect(args[1]).toMatchObject({ errorName: error instanceof TypeError ? 'TypeError' : 'Error' });
        expect(JSON.stringify(args)).not.toContain('private-error-name');
    });
    it('does not invoke an error.name getter while reporting a production failure', () => {
        const error = new Error('private diagnostic');
        const readName = () => { throw new Error('private getter diagnostic'); };
        Object.defineProperty(error, 'name', { get: readName });
        expect(() => createRenderErrorLogArgs(error, {}, false)).not.toThrow();
    });

});
