import {
    createCanonicalSnapshotRepositories,
    type CanonicalSnapshotRepositories,
    type RepositoryStorage,
} from '@life-quest/core/syncRepository';
import { getPlatformStorageAdapter } from './storage';

/** Web localStorage wiring for the platform-neutral canonical repositories. */
export function createWebCanonicalRepositories(
    storage: RepositoryStorage = getPlatformStorageAdapter(),
): CanonicalSnapshotRepositories {
    return createCanonicalSnapshotRepositories(storage);
}
