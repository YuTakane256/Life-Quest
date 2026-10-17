export const syncEnvironmentKeys: string[];
export function assertLocalSyncEnvironment(env: Record<string, string | undefined>): void;
export function syncQualityPlan(args: string[], env: Record<string, string | undefined>): Array<{ label: string; files: string[] }>;
