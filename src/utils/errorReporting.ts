interface RenderErrorInfo {
    componentStack?: string | null;
}

export type RenderErrorLogArgs = [
    message: string,
    ...details: unknown[],
];

function getErrorName(error: unknown): string {
    return error instanceof Error && error.name ? error.name : 'UnknownError';
}

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
            errorName: getErrorName(error),
            hasComponentStack: Boolean(info.componentStack),
        },
    ];
}
