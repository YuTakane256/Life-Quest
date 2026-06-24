import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sanitizeFriendsState, useFriendsStore } from './useFriendsStore';

function reset() {
    localStorage.clear();
    useFriendsStore.setState({ friends: [] });
}

describe('useFriendsStore', () => {
    beforeEach(() => {
        reset();
        vi.spyOn(Date, 'now').mockReturnValue(1);
        vi.spyOn(Math, 'random').mockReturnValue(0);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('sanitizes persisted friends and drops duplicates', () => {
        expect(sanitizeFriendsState({
            friends: [
                { id: 'a', name: '  Alice  ', level: 5.8, totalXp: 120, maxStage: 7 },
                { id: 'a', name: 'Duplicate', level: 9, totalXp: 999, maxStage: 9 },
                { id: 'b', name: '', level: 1, totalXp: 0, maxStage: 0 },
                { id: 'c', name: 'Bob', level: -1, totalXp: Number.NaN, maxStage: 99999 },
            ],
        })).toEqual({
            friends: [
                { id: 'a', name: 'Alice', level: 5, totalXp: 120, maxStage: 7 },
                { id: 'c', name: 'Bob', level: 1, totalXp: 0, maxStage: 999 },
            ],
        });
    });

    it('adds, updates, and deletes local friends', () => {
        useFriendsStore.getState().addFriend({ name: 'Alice', level: 3, totalXp: 80, maxStage: 4 });
        const id = useFriendsStore.getState().friends[0].id;

        useFriendsStore.getState().updateFriend(id, { level: 4, maxStage: 5 });
        expect(useFriendsStore.getState().friends[0]).toMatchObject({
            name: 'Alice',
            level: 4,
            totalXp: 80,
            maxStage: 5,
        });

        useFriendsStore.getState().deleteFriend(id);
        expect(useFriendsStore.getState().friends).toEqual([]);
    });
});
