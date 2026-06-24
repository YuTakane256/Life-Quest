import { beforeEach, describe, expect, it } from 'vitest';
import { sanitizeHabitSortMode, useHabitSortStore } from './useHabitSortStore';
import { sanitizeTaskSortMode, useTaskSortStore } from './useTaskSortStore';
import { sanitizeThemeMode, useThemeStore } from './useThemeStore';

function reset() {
    localStorage.clear();
    useThemeStore.setState({ mode: 'system' });
    useTaskSortStore.setState({ sortMode: 'dueDate' });
    useHabitSortStore.setState({ sortMode: 'createdAt' });
}

describe('persisted UI preference sanitizers', () => {
    beforeEach(() => reset());

    describe('sanitizeThemeMode', () => {
        it('有効なテーマだけを通し、不正値は system にする', () => {
            expect(sanitizeThemeMode('light')).toBe('light');
            expect(sanitizeThemeMode('dark')).toBe('dark');
            expect(sanitizeThemeMode('system')).toBe('system');
            expect(sanitizeThemeMode('sepia')).toBe('system');
            expect(sanitizeThemeMode(null)).toBe('system');
        });

        it('setMode 経由でも不正値を system に戻す', () => {
            useThemeStore.getState().setMode('dark');
            expect(useThemeStore.getState().mode).toBe('dark');
            useThemeStore.getState().setMode('sepia' as never);
            expect(useThemeStore.getState().mode).toBe('system');
        });

        it('persisted mode を rehydrate 時にも検証する', async () => {
            useThemeStore.setState({ mode: 'dark' });
            localStorage.setItem('quest-board-theme', JSON.stringify({ state: { mode: 'light' }, version: 1 }));

            await useThemeStore.persist.rehydrate();

            expect(useThemeStore.getState().mode).toBe('light');

            localStorage.setItem('quest-board-theme', JSON.stringify({ state: { mode: 'sepia' }, version: 1 }));
            await useThemeStore.persist.rehydrate();

            expect(useThemeStore.getState().mode).toBe('system');
        });

        it('persisted state が壊れていても action を維持する', async () => {
            localStorage.setItem('quest-board-theme', JSON.stringify({ state: ['light'], version: 1 }));

            await useThemeStore.persist.rehydrate();

            expect(useThemeStore.getState().mode).toBe('system');
            expect(typeof useThemeStore.getState().setMode).toBe('function');
        });
    });

    describe('sanitizeTaskSortMode', () => {
        it('有効なタスク並び順だけを通し、不正値は dueDate にする', () => {
            expect(sanitizeTaskSortMode('dueDate')).toBe('dueDate');
            expect(sanitizeTaskSortMode('priority')).toBe('priority');
            expect(sanitizeTaskSortMode('createdAt')).toBe('createdAt');
            expect(sanitizeTaskSortMode('name')).toBe('dueDate');
            expect(sanitizeTaskSortMode(undefined)).toBe('dueDate');
        });

        it('setSortMode 経由でも不正値を dueDate に戻す', () => {
            useTaskSortStore.getState().setSortMode('priority');
            expect(useTaskSortStore.getState().sortMode).toBe('priority');
            useTaskSortStore.getState().setSortMode('name' as never);
            expect(useTaskSortStore.getState().sortMode).toBe('dueDate');
        });

        it('persisted sortMode を rehydrate 時にも検証する', async () => {
            useTaskSortStore.setState({ sortMode: 'createdAt' });
            localStorage.setItem('quest-board-task-sort', JSON.stringify({ state: { sortMode: 'priority' }, version: 1 }));

            await useTaskSortStore.persist.rehydrate();

            expect(useTaskSortStore.getState().sortMode).toBe('priority');

            localStorage.setItem('quest-board-task-sort', JSON.stringify({ state: { sortMode: 'name' }, version: 1 }));
            await useTaskSortStore.persist.rehydrate();

            expect(useTaskSortStore.getState().sortMode).toBe('dueDate');
        });

        it('persisted state が壊れていても action を維持する', async () => {
            localStorage.setItem('quest-board-task-sort', JSON.stringify({ state: 'priority', version: 1 }));

            await useTaskSortStore.persist.rehydrate();

            expect(useTaskSortStore.getState().sortMode).toBe('dueDate');
            expect(typeof useTaskSortStore.getState().setSortMode).toBe('function');
        });
    });

    describe('sanitizeHabitSortMode', () => {
        it('有効な習慣並び順だけを通し、不正値は createdAt にする', () => {
            expect(sanitizeHabitSortMode('createdAt')).toBe('createdAt');
            expect(sanitizeHabitSortMode('name')).toBe('name');
            expect(sanitizeHabitSortMode('streak')).toBe('streak');
            expect(sanitizeHabitSortMode('completionRate')).toBe('completionRate');
            expect(sanitizeHabitSortMode('priority')).toBe('createdAt');
            expect(sanitizeHabitSortMode(null)).toBe('createdAt');
        });

        it('setSortMode 経由でも不正値を createdAt に戻す', () => {
            useHabitSortStore.getState().setSortMode('streak');
            expect(useHabitSortStore.getState().sortMode).toBe('streak');
            useHabitSortStore.getState().setSortMode('priority' as never);
            expect(useHabitSortStore.getState().sortMode).toBe('createdAt');
        });

        it('persisted sortMode を rehydrate 時にも検証する', async () => {
            useHabitSortStore.setState({ sortMode: 'name' });
            localStorage.setItem('quest-board-habit-sort', JSON.stringify({ state: { sortMode: 'completionRate' }, version: 1 }));

            await useHabitSortStore.persist.rehydrate();

            expect(useHabitSortStore.getState().sortMode).toBe('completionRate');

            localStorage.setItem('quest-board-habit-sort', JSON.stringify({ state: { sortMode: 'priority' }, version: 1 }));
            await useHabitSortStore.persist.rehydrate();

            expect(useHabitSortStore.getState().sortMode).toBe('createdAt');
        });
    });
});
