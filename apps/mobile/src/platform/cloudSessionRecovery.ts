import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadCloudCache } from '@life-quest/core/cloudCache';

/** Display provenance only. Authentication still comes from Supabase's validated session. */
export const MOBILE_CLOUD_DISPLAY_OWNER_KEY = 'life-quest:mobile:cloud-display-owner:v1';
export type MobileCloudRecoveryState = 'checking' | 'ready' | 'required' | 'storage-error';
let state: MobileCloudRecoveryState = 'checking';
let acceptedUserId: string | null = null;
let ownerWrites: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();
export const getMobileCloudRecoveryState = () => state;
export const isMobileCloudSessionAccepted = (userId: string) => acceptedUserId === userId;
export function subscribeMobileCloudRecovery(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
function publish(next: MobileCloudRecoveryState): void {
    if (state === next) return;
    state = next;
    for (const listener of [...listeners]) listener();
}

/** Written BEFORE cloud rows enter shared display stores, never stores a session/token. */
export function rememberMobileCloudDisplayOwner(userId: string, isCurrent: () => boolean = () => true): Promise<void> {
    const work = ownerWrites.then(async () => {
        if (isCurrent()) await AsyncStorage.setItem(MOBILE_CLOUD_DISPLAY_OWNER_KEY, userId);
    });
    ownerWrites = work.catch(() => undefined);
    return work;
}

export async function hasMobileCloudDisplayOwner(userId: string): Promise<boolean> {
    await ownerWrites;
    return await AsyncStorage.getItem(MOBILE_CLOUD_DISPLAY_OWNER_KEY) === userId;
}

/** Older installations lack the marker. Match existing display IDs to owner-scoped caches. */
async function readDisplayOwner(): Promise<string | null> {
    await ownerWrites;
    const marker = await AsyncStorage.getItem(MOBILE_CLOUD_DISPLAY_OWNER_KEY);
    if (marker !== null) {
        if (!marker.trim()) throw new Error('Invalid display provenance');
        return marker;
    }
    const parse = async (key: string) => {
        const raw = await AsyncStorage.getItem(key);
        return raw === null ? null : JSON.parse(raw)?.state;
    };
    const [tasks, habits, game, keys] = await Promise.all([
        parse('quest-board-tasks'), parse('quest-board-habits'), parse('quest-board-game'), AsyncStorage.getAllKeys(),
    ]);
    const taskIds = new Set((tasks?.tasks ?? []).map((task: { id: string }) => task.id));
    const habitIds = new Set((habits?.habits ?? []).map((habit: { id: string }) => habit.id));
    const equipmentIds = new Set((game?.equipment ?? []).map((item: { id: string }) => item.id));
    const chestIds = new Set((game?.chestQueue ?? []).map((chest: { id: string }) => chest.id));
    const owners = new Set<string>();
    for (const key of keys) {
        const match = /^life-quest:cloud:([^:]+):cache:[^:]+:v1$/.exec(key);
        if (match) owners.add(match[1]);
    }
    const matches: string[] = [];
    for (const owner of owners) {
        // An omitted corrupt section is not evidence that the shared display is anonymous.
        const cache = await loadCloudCache(AsyncStorage, owner, { rejectInvalidSections: true });
        if (Object.keys(cache.tasks).some((id) => taskIds.has(id))
            || Object.keys(cache.habits).some((id) => habitIds.has(id))
            || Object.keys(cache.inventory_items).some((id) => equipmentIds.has(id))
            || Object.keys(cache.chests).some((id) => chestIds.has(id))) matches.push(owner);
    }
    if (matches.length > 1) throw new Error('Ambiguous display provenance');
    return matches[0] ?? null;
}

/** Never clear, import or reward cached cloud progress while its owner is unauthenticated. */
export async function checkMobileCloudSessionOwner(
    userId: string | null, isCurrent: () => boolean = () => true,
): Promise<boolean> {
    if (!isCurrent()) return false;
    acceptedUserId = null;
    try {
        const owner = await readDisplayOwner();
        if (!isCurrent()) return false;
        if (owner) {
            // Also retain legacy provenance on a valid same-owner login, even if
            // the first cloud pull fails before an explicit logout can clean up.
            await rememberMobileCloudDisplayOwner(owner, isCurrent);
            if (!isCurrent()) return false;
            if (owner !== userId) {
                publish('required');
                return false;
            }
        }
        acceptedUserId = userId;
        return true;
    } catch {
        if (isCurrent()) publish('storage-error');
        return false;
    }
}

export function finishMobileCloudSessionCheck(): void { publish('ready'); }
export function beginMobileCloudSessionCheck(): void { acceptedUserId = null; publish('checking'); }

/** Only normal logout/account deletion may release ownership after their store cleanup. */
export function releaseMobileCloudDisplayOwner(expectedOwner?: string): Promise<void> {
    const work = ownerWrites.then(async () => {
        const owner = await AsyncStorage.getItem(MOBILE_CLOUD_DISPLAY_OWNER_KEY);
        if (expectedOwner === undefined || owner === expectedOwner) await AsyncStorage.removeItem(MOBILE_CLOUD_DISPLAY_OWNER_KEY);
    });
    ownerWrites = work.catch(() => undefined);
    return work;
}
