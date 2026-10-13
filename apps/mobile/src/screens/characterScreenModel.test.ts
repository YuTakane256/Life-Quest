import { describe, expect, it } from 'vitest';
import { GAME_STATE_LIMITS } from '@life-quest/core/gameState';
import { buildCharacterProfileUpdate } from './characterScreenModel';

describe('character profile draft', () => {
    it('名前とアバターだけを更新し、成長・報酬・装備の情報は含めない', () => {
        expect(buildCharacterProfileUpdate('  星見ユウ  ', 'male')).toEqual({
            name: '星見ユウ',
            avatar: 'male',
        });
    });
    it('空欄保存はWebと同じ名無しになり、既存保存形式の30文字上限を維持する', () => {
        expect(buildCharacterProfileUpdate(' ', 'female')).toEqual({
            name: '名無し',
            avatar: 'female',
        });
        expect(
            buildCharacterProfileUpdate('あ'.repeat(40), 'female').name,
        ).toHaveLength(GAME_STATE_LIMITS.maxCharacterNameLength);
        const existing = '長'.repeat(30);
        expect(buildCharacterProfileUpdate(existing, 'male').name).toBe(
            existing,
        );
    });
});
