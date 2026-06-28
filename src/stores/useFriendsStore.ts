import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '../utils/dateUtils';
import { clampString } from '../utils/validation';
import { isPlainObject, toBoundedInteger } from '../utils/persistSanitize';

export interface FriendProfile {
    id: string;
    name: string;
    level: number;
    totalXp: number;
    maxStage: number;
}

interface FriendsStoreState {
    friends: FriendProfile[];
    addFriend: (friend: Omit<FriendProfile, 'id'>) => void;
    updateFriend: (id: string, updates: Partial<Omit<FriendProfile, 'id'>>) => void;
    deleteFriend: (id: string) => void;
}

const MAX_FRIENDS = 30;
const MAX_FRIEND_NAME_LENGTH = 30;
const MAX_LEVEL = 9999;
const MAX_STAGE = 999;

function sanitizeFriend(raw: unknown): FriendProfile | null {
    if (!isPlainObject(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
    const name = clampString(raw.name.trim(), MAX_FRIEND_NAME_LENGTH);
    if (name.length === 0) return null;

    return {
        id: raw.id,
        name,
        level: toBoundedInteger(raw.level, 1, 1, MAX_LEVEL),
        totalXp: toBoundedInteger(raw.totalXp, 0, 0, Number.MAX_SAFE_INTEGER),
        maxStage: toBoundedInteger(raw.maxStage, 0, 0, MAX_STAGE),
    };
}

export function sanitizeFriendsState(persisted: unknown): Pick<FriendsStoreState, 'friends'> {
    if (!isPlainObject(persisted) || !Array.isArray(persisted.friends)) return { friends: [] };

    const seenIds = new Set<string>();
    const friends = persisted.friends
        .map(sanitizeFriend)
        .filter((friend): friend is FriendProfile => friend !== null)
        .filter((friend) => {
            if (seenIds.has(friend.id)) return false;
            seenIds.add(friend.id);
            return true;
        })
        .slice(0, MAX_FRIENDS);

    return { friends };
}

function sanitizeFriendInput(friend: Omit<FriendProfile, 'id'>): Omit<FriendProfile, 'id'> | null {
    const name = clampString(friend.name.trim(), MAX_FRIEND_NAME_LENGTH);
    if (name.length === 0) return null;
    return {
        name,
        level: toBoundedInteger(friend.level, 1, 1, MAX_LEVEL),
        totalXp: toBoundedInteger(friend.totalXp, 0, 0, Number.MAX_SAFE_INTEGER),
        maxStage: toBoundedInteger(friend.maxStage, 0, 0, MAX_STAGE),
    };
}

function createUniqueFriendId(existingIds: Set<string>): string {
    const baseId = generateId();
    if (!existingIds.has(baseId)) return baseId;

    let suffix = 1;
    let candidate = `${baseId}-${suffix}`;
    while (existingIds.has(candidate)) {
        suffix++;
        candidate = `${baseId}-${suffix}`;
    }
    return candidate;
}

export const useFriendsStore = create<FriendsStoreState>()(
    persist(
        (set) => ({
            friends: [],
            addFriend: (friend) => {
                const safeFriend = sanitizeFriendInput(friend);
                if (!safeFriend) return;
                set((state) => ({
                    friends: [
                        ...state.friends,
                        { id: createUniqueFriendId(new Set(state.friends.map((existing) => existing.id))), ...safeFriend },
                    ].slice(0, MAX_FRIENDS),
                }));
            },
            updateFriend: (id, updates) => set((state) => ({
                friends: state.friends.map((friend) => {
                    if (friend.id !== id) return friend;
                    const safe = sanitizeFriendInput({ ...friend, ...updates });
                    return safe ? { ...friend, ...safe } : friend;
                }),
            })),
            deleteFriend: (id) => set((state) => ({
                friends: state.friends.filter((friend) => friend.id !== id),
            })),
        }),
        {
            name: 'quest-board-friends',
            version: 1,
            merge: (persisted, current) => ({
                ...current,
                ...sanitizeFriendsState(persisted),
            }),
        }
    )
);
