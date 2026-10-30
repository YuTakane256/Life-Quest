export function containsServerCredential(content: string): boolean;
export function findClientSecretViolations(content: string, file: string): string[];
export function checkClientSecrets(root?: string, output?: Pick<Console, 'log' | 'error'>): number;
