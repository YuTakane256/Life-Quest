import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHabitStore } from './useHabitStore';

/**
 * テスト用に "今日" の JST 日付を固定するヘルパー。
 * vi.setSystemTime で UTC を 03:00Z にセット → JST 12:00 = その日。
 */
function setToday(jstDate: string) {
    // jstDate を JST 12:00 にあたる UTC へ変換: JST 12:00 = UTC 03:00
    vi.setSystemTime(new Date(`${jstDate}T03:00:00Z`));
}

function resetStore() {
    localStorage.clear();
    useHabitStore.setState({ habits: [], dailyRecords: [], restDays: [] });
}

describe('useHabitStore', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        setToday('2025-03-15');
        resetStore();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('addHabit / deleteHabit', () => {
        it('name と categoryId 付きで追加できる', () => {
            useHabitStore.getState().addHabit('読書', 'study');
            const habits = useHabitStore.getState().habits;
            expect(habits).toHaveLength(1);
            expect(habits[0]).toMatchObject({ name: '読書', categoryId: 'study' });
            expect(habits[0].id).toMatch(/^\d+-/);
        });

        it('categoryId 未指定なら DEFAULT_CATEGORY_ID が入る', () => {
            useHabitStore.getState().addHabit('運動');
            const h = useHabitStore.getState().habits[0];
            expect(h.categoryId).toBeTruthy();
        });

        it('deleteHabit で habits と関連 dailyRecords が両方消える', () => {
            useHabitStore.getState().addHabit('A');
            const id = useHabitStore.getState().habits[0].id;
            // 別習慣も追加して紛らわせる
            useHabitStore.getState().addHabit('B');
            useHabitStore.setState((s) => ({
                dailyRecords: [
                    { habitId: id, date: '2025-03-15', completed: true, memo: '' },
                    { habitId: 'other', date: '2025-03-15', completed: true, memo: '' },
                ],
            }));
            useHabitStore.getState().deleteHabit(id);
            const state = useHabitStore.getState();
            expect(state.habits.find((h) => h.id === id)).toBeUndefined();
            expect(state.dailyRecords.find((r) => r.habitId === id)).toBeUndefined();
            // 他習慣のレコードは残る
            expect(state.dailyRecords.find((r) => r.habitId === 'other')).toBeDefined();
        });
    });

    describe('toggleHabitCompletion / setHabitMemo', () => {
        it('record がない状態で呼ぶと completed:true で新規作成', () => {
            useHabitStore.getState().addHabit('A');
            const id = useHabitStore.getState().habits[0].id;
            useHabitStore.getState().toggleHabitCompletion(id, '2025-03-15');
            const record = useHabitStore.getState().dailyRecords.find((r) => r.habitId === id);
            expect(record).toMatchObject({ completed: true, memo: '' });
        });

        it('既存 record の completed をトグルする', () => {
            useHabitStore.getState().addHabit('A');
            const id = useHabitStore.getState().habits[0].id;
            useHabitStore.setState({
                dailyRecords: [{ habitId: id, date: '2025-03-15', completed: true, memo: '' }],
            });
            useHabitStore.getState().toggleHabitCompletion(id, '2025-03-15');
            expect(useHabitStore.getState().dailyRecords[0].completed).toBe(false);
        });

        it('setHabitMemo で memo が反映される（既存 record）', () => {
            useHabitStore.getState().addHabit('A');
            const id = useHabitStore.getState().habits[0].id;
            useHabitStore.setState({
                dailyRecords: [{ habitId: id, date: '2025-03-15', completed: true, memo: '' }],
            });
            useHabitStore.getState().setHabitMemo(id, '2025-03-15', 'よく頑張った');
            expect(useHabitStore.getState().dailyRecords[0].memo).toBe('よく頑張った');
        });

        it('setHabitMemo で record が無い場合は新規作成 (completed:false)', () => {
            useHabitStore.getState().addHabit('A');
            const id = useHabitStore.getState().habits[0].id;
            useHabitStore.getState().setHabitMemo(id, '2025-03-15', 'メモのみ');
            const record = useHabitStore.getState().dailyRecords.find((r) => r.habitId === id);
            expect(record).toMatchObject({ completed: false, memo: 'メモのみ' });
        });
    });

    describe('isRestDay / setRestDay', () => {
        it('初期は false', () => {
            expect(useHabitStore.getState().isRestDay('2025-03-15')).toBe(false);
        });

        it('setRestDay 後は true', () => {
            useHabitStore.getState().setRestDay('2025-03-15');
            expect(useHabitStore.getState().isRestDay('2025-03-15')).toBe(true);
        });
    });

    describe('areAllHabitsComplete', () => {
        it('習慣 0 件 → false', () => {
            expect(useHabitStore.getState().areAllHabitsComplete('2025-03-15')).toBe(false);
        });

        it('全件達成 → true', () => {
            useHabitStore.getState().addHabit('A');
            useHabitStore.getState().addHabit('B');
            const [a, b] = useHabitStore.getState().habits;
            useHabitStore.setState({
                dailyRecords: [
                    { habitId: a.id, date: '2025-03-15', completed: true, memo: '' },
                    { habitId: b.id, date: '2025-03-15', completed: true, memo: '' },
                ],
            });
            expect(useHabitStore.getState().areAllHabitsComplete('2025-03-15')).toBe(true);
        });

        it('1件未達 → false', () => {
            useHabitStore.getState().addHabit('A');
            useHabitStore.getState().addHabit('B');
            const [a] = useHabitStore.getState().habits;
            useHabitStore.setState({
                dailyRecords: [
                    { habitId: a.id, date: '2025-03-15', completed: true, memo: '' },
                ],
            });
            expect(useHabitStore.getState().areAllHabitsComplete('2025-03-15')).toBe(false);
        });
    });

    describe('getHabitStreak', () => {
        function seedHabit(): string {
            useHabitStore.getState().addHabit('習慣');
            return useHabitStore.getState().habits[0].id;
        }

        it('連続で5日達成 → 5', () => {
            const id = seedHabit();
            useHabitStore.setState({
                dailyRecords: ['2025-03-15', '2025-03-14', '2025-03-13', '2025-03-12', '2025-03-11'].map((date) => ({
                    habitId: id, date, completed: true, memo: '',
                })),
            });
            expect(useHabitStore.getState().getHabitStreak(id)).toBe(5);
        });

        it('連続が途切れたら 0（直近未達成）', () => {
            const id = seedHabit();
            useHabitStore.setState({
                dailyRecords: [
                    // 2025-03-15 (today) と 2025-03-14 (昨日) 両方未達成
                    { habitId: id, date: '2025-03-13', completed: true, memo: '' },
                ],
            });
            expect(useHabitStore.getState().getHabitStreak(id)).toBe(0);
        });

        it('今日が未完了でも過去の連続を切らない', () => {
            const id = seedHabit();
            useHabitStore.setState({
                dailyRecords: ['2025-03-14', '2025-03-13', '2025-03-12'].map((date) => ({
                    habitId: id, date, completed: true, memo: '',
                })),
            });
            // today=2025-03-15 は未完了。過去 3 日連続をカウント
            expect(useHabitStore.getState().getHabitStreak(id)).toBe(3);
        });

        it('お休み日はストリークを途切れさせない（カウントもしない）', () => {
            const id = seedHabit();
            useHabitStore.setState({
                dailyRecords: ['2025-03-15', '2025-03-14', '2025-03-12'].map((date) => ({
                    habitId: id, date, completed: true, memo: '',
                })),
                restDays: [{ date: '2025-03-13', isRest: true }],
            });
            // 15, 14 達成 → お休み 13 スキップ → 12 達成 = 3 日カウント
            expect(useHabitStore.getState().getHabitStreak(id)).toBe(3);
        });

        it('未追加の習慣 ID は 0', () => {
            expect(useHabitStore.getState().getHabitStreak('no-such-id')).toBe(0);
        });
    });

    describe('getHabitCompletionRate', () => {
        function seedHabit(createdAt = '2025-01-01T00:00:00Z'): string {
            useHabitStore.setState({
                habits: [{ id: 'h1', name: 'A', categoryId: 'default', createdAt }],
            });
            return 'h1';
        }

        it('未追加の habit は null', () => {
            expect(useHabitStore.getState().getHabitCompletionRate('no-such-id')).toBeNull();
        });

        it('過去30日すべて達成 → 100', () => {
            const id = seedHabit();
            const records = Array.from({ length: 30 }, (_, i) => {
                const d = new Date('2025-03-15T03:00:00Z');
                d.setUTCDate(d.getUTCDate() - i);
                return { habitId: id, date: d.toISOString().slice(0, 10), completed: true, memo: '' };
            });
            useHabitStore.setState({ dailyRecords: records });
            expect(useHabitStore.getState().getHabitCompletionRate(id)).toBe(100);
        });

        it('過去30日完了 0 → 0', () => {
            const id = seedHabit();
            expect(useHabitStore.getState().getHabitCompletionRate(id)).toBe(0);
        });

        it('お休み日は分母から除外される', () => {
            const id = seedHabit('2025-03-13T00:00:00Z');
            useHabitStore.setState((s) => ({
                ...s,
                habits: [{ id, name: 'A', categoryId: 'default', createdAt: '2025-03-13T00:00:00Z' }],
                dailyRecords: [
                    { habitId: id, date: '2025-03-15', completed: true, memo: '' },
                    // 14 は未達成
                    { habitId: id, date: '2025-03-13', completed: true, memo: '' },
                ],
                restDays: [{ date: '2025-03-14', isRest: true }],
            }));
            // 対象日: 15, 13 = 2日（14 はお休みで除外）。達成 = 2 → 100%
            expect(useHabitStore.getState().getHabitCompletionRate(id)).toBe(100);
        });

        it('作成前の日数は分母に含まれない', () => {
            // 作成日 = 今日。対象 1 日のみ。
            const id = seedHabit('2025-03-15T00:00:00Z');
            useHabitStore.setState((s) => ({
                ...s,
                dailyRecords: [{ habitId: id, date: '2025-03-15', completed: true, memo: '' }],
            }));
            expect(useHabitStore.getState().getHabitCompletionRate(id)).toBe(100);
        });

        it('対象日が全部お休み → null（分母 0）', () => {
            const id = seedHabit('2025-03-15T00:00:00Z');
            useHabitStore.setState((s) => ({
                ...s,
                restDays: [{ date: '2025-03-15', isRest: true }],
            }));
            expect(useHabitStore.getState().getHabitCompletionRate(id)).toBeNull();
        });
    });
});
