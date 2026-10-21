import { describe, expect, it } from 'vitest';
import { buildCharacterProfileUpdate, captureCharacterProfile } from './characterProfile';
import { GAME_STATE_LIMITS } from './gameState';

describe('character profile edit policy', () => {
    it('copies only editable fields, allowing equal pulls and progression changes', () => {
        const original = { name: '星見ユウ', avatar: 'female' as const, totalXp: 30 };
        const accepts = captureCharacterProfile(original);
        const progressed = { ...original, totalXp: 60 };
        expect(accepts(progressed)).toBe(true);
        original.name = '同期後'; expect(accepts(original)).toBe(false);
        expect(accepts({ name: '星見ユウ', avatar: 'male' })).toBe(false);
        expect(accepts({ name: '星見ユウ', avatar: 'female' })).toBe(true);
    });
    it('preserves trim, empty fallback and 30-character limit without other fields', () => {
        expect(buildCharacterProfileUpdate('  星見ユウ ', 'male')).toEqual({ name: '星見ユウ', avatar: 'male' });
        expect(buildCharacterProfileUpdate('　 ', 'female')).toEqual({ name: '名無し', avatar: 'female' });
        expect(buildCharacterProfileUpdate('あ'.repeat(40), 'female').name).toHaveLength(GAME_STATE_LIMITS.maxCharacterNameLength);
    });
});
