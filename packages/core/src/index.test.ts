import { describe, expect, it } from 'vitest';
import {
    BATTLE_SKILLS,
    clamp,
    clampString,
    getHpDisplayState,
    resolveBattleSkill,
} from './index.ts';

describe('platform-neutral core public API', () => {
    it('単一エントリポイントから共有候補の純粋関数を利用できる', () => {
        expect(clamp(12, 0, 10)).toBe(10);
        expect(clampString('Life Quest', 4)).toBe('Life');
        expect(getHpDisplayState(75, 100)).toMatchObject({ ratio: 0.75, widthPercent: '75%' });
        expect(BATTLE_SKILLS.map((skill) => skill.id)).toContain('power_strike');
        expect(resolveBattleSkill('power_strike', {
            attack: 10,
            currentHp: 50,
            maxHp: 100,
        })).toMatchObject({ type: 'damage', damage: 16 });
    });
});
