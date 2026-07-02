import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    createCanonicalSnapshotRepositories,
    type CanonicalSnapshotRepositories,
    type RepositoryStorage,
} from '@life-quest/core/syncRepository';

/** Expo AsyncStorage wiring for the platform-neutral canonical repositories. */
export function createMobileCanonicalRepositories(
    storage: RepositoryStorage = AsyncStorage,
): CanonicalSnapshotRepositories {
    return createCanonicalSnapshotRepositories(storage);
}
