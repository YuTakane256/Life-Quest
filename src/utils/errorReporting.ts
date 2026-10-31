import { getSafeErrorName } from '@life-quest/core/diagnostics';

interface RenderErrorInfo {
    componentStack?: string | null;
}

export type RenderErrorLogArgs = [
    message: string,
    ...details: unknown[],
];

export function createRenderErrorLogArgs(
    error: unknown,
    info: RenderErrorInfo,
    isDev: boolean,
): RenderErrorLogArgs {
    if (isDev) {
        return ['Unhandled app render error', error, info];
    }

    return [
        'Unhandled app render error',
        {
            redacted: true,
            errorName: getSafeErrorName(error),
            hasComponentStack: Boolean(info.componentStack),
        },
    ];
}
