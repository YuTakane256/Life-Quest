import {
    migrateLegacyQuestBoardData,
    type MigrationReport,
} from '@life-quest/core/legacyMigration';
import type { RepositoryStorage } from '@life-quest/core/syncRepository';
import { createWebCanonicalRepositories } from './canonicalRepositories';
import { getPlatformStorageAdapter } from './storage';

/**
 * Web localStorage の `quest-board-*` を canonical Repository へ初回移行する。
 * 明示的に呼び出したときだけ実行される（アプリ起動時の自動実行はしない）。
 * 旧キーは読み取り専用として扱われ、削除・上書きされない。
 */
export function migrateWebLegacyData(
    storage: RepositoryStorage = getPlatformStorageAdapter(),
): Promise<MigrationReport> {
    return migrateLegacyQuestBoardData({
        legacySource: { getItem: (key) => storage.getItem(key) },
        repositories: createWebCanonicalRepositories(storage),
        journalStorage: storage,
    });
}
