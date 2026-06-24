import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '../utils/dateUtils';
import { clampString } from '../utils/validation';

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.max(min, Math.min(max, Math.floor(value)))
        : fallback;
}

function sanitizeFriend(raw: unknown): FriendProfile | null {
    if (!isPlainObject(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
    const name = clampString(raw.name.trim(), MAX_FRIEND_NAME_LENGTH);
    if (name.length === 0) return null;

    return {
        id: raw.id,
        name,
        level: boundedInteger(raw.level, 1, 1, MAX_LEVEL),
        totalXp: boundedInteger(raw.totalXp, 0, 0, Number.MAX_SAFE_INTEGER),
        maxStage: boundedInteger(raw.maxStage, 0, 0, MAX_STAGE),
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
        level: boundedInteger(friend.level, 1, 1, MAX_LEVEL),
        totalXp: boundedInteger(friend.totalXp, 0, 0, Number.MAX_SAFE_INTEGER),
        maxStage: boundedInteger(friend.maxStage, 0, 0, MAX_STAGE),
    };
}

export const useFriendsStore = create<FriendsStoreState>()(
    persist(
        (set) => ({
            friends: [],
            addFriend: (friend) => {
                const safeFriend = sanitizeFriendInput(friend);
                if (!safeFriend) return;
                set((state) => ({
                    friends: [...state.friends, { id: generateId(), ...safeFriend }].slice(0, MAX_FRIENDS),
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
