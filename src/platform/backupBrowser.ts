import type { BackupData } from '../utils/dataBackup';
import { toIsoDatePart } from '../utils/dateUtils';

/** Browser effects stay synchronous so the caller can check its operation scope immediately before them. */
export function downloadBackupFile(data: BackupData): void {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    try {
        const link = document.createElement('a');
        link.href = url;
        link.download = `life-quest-backup-${toIsoDatePart(new Date().toISOString())}.json`;
        link.click();
    } finally {
        URL.revokeObjectURL(url);
    }
}

export function reloadAfterBackupImport(): void {
    window.location.reload();
}
