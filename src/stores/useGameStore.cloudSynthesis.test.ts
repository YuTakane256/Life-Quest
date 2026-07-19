import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from './useGameStore';
import { EQUIPMENT_POOL } from '@life-quest/core/rewards';
import type { Equipment } from '../types';

function makeEquipment(overrides: Partial<Equipment> = {}): Equipment {
    return {
        id: 'eq-' + Math.random().toString(36).slice(2, 8),
        templateId: 'wooden_sword',
        name: '木の剣',
        slot: 'weapon',
        rarity: 'common',
        attackBonus: 2,
        defenseBonus: 0,
        hpBonus: 0,
        equipped: false,
        ...overrides,
    };
}

function reset() {
    localStorage.clear();
    useGameStore.setState({ equipment: [] });
}

const someTemplate = EQUIPMENT_POOL[0];

describe('useGameStore.applyCloudSynthesisResult', () => {
    beforeEach(() => reset());

    it('素材を除去し、サーバーのresultId/templateIdから結果装備を生成する', () => {
        const ingredients = [makeEquipment({ id: 'i1' }), makeEquipment({ id: 'i2' }), makeEquipment({ id: 'i3' })];
        useGameStore.setState({ equipment: ingredients });

        const result = useGameStore.getState().applyCloudSynthesisResult(
            ['i1', 'i2', 'i3'],
            'server-result-1',
            someTemplate.id,
        );

        expect(result).not.toBeNull();
        expect(result!.id).toBe('server-result-1');
        expect(result!.templateId).toBe(someTemplate.id);

        const state = useGameStore.getState();
        expect(state.equipment).toHaveLength(1);
        expect(state.equipment[0].id).toBe('server-result-1');
    });

    it('未知のtemplateIdでも素材は除去する（結果装備は追加しない）', () => {
        const ingredients = [makeEquipment({ id: 'i1' }), makeEquipment({ id: 'i2' }), makeEquipment({ id: 'i3' })];
        useGameStore.setState({ equipment: ingredients });

        const result = useGameStore.getState().applyCloudSynthesisResult(
            ['i1', 'i2', 'i3'],
            'server-result-1',
            'not-a-real-template',
        );

        expect(result).toBeNull();
        expect(useGameStore.getState().equipment).toHaveLength(0);
    });

    it('素材IDに含まれない装備は残す', () => {
        const ingredients = [makeEquipment({ id: 'i1' }), makeEquipment({ id: 'i2' }), makeEquipment({ id: 'i3' })];
        const untouched = makeEquipment({ id: 'kept' });
        useGameStore.setState({ equipment: [...ingredients, untouched] });

        useGameStore.getState().applyCloudSynthesisResult(['i1', 'i2', 'i3'], 'server-result-1', someTemplate.id);

        const state = useGameStore.getState();
        expect(state.equipment.some((e) => e.id === 'kept')).toBe(true);
        expect(state.equipment.some((e) => e.id === 'server-result-1')).toBe(true);
    });
});
