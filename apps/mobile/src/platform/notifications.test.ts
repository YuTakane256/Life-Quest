/**
 * Mobile通知チェックのテスト。「見た目だけのトグル」への退行防止として、
 * トグルON+許可済みのときに実際にexpo-notificationsへ通知が渡ることを検証する。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
    default: {
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => undefined),
        removeItem: vi.fn(async () => undefined),
    },
}));

vi.mock('react-native', () => ({
    AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));

interface MockNotificationRequest {
    identifier: string;
    content: { title: string; body: string };
    trigger: null;
}

const { scheduleNotificationAsync, getPermissionsAsync, requestPermissionsAsync } = vi.hoisted(() => ({
    scheduleNotificationAsync: vi.fn(async (_request: MockNotificationRequest) => 'id'),
    getPermissionsAsync: vi.fn(async () => ({ granted: true, canAskAgain: true })),
    requestPermissionsAsync: vi.fn(async () => ({ granted: true, canAskAgain: true })),
}));

vi.mock('expo-notifications', () => ({
    setNotificationHandler: vi.fn(),
    getPermissionsAsync,
    requestPermissionsAsync,
    scheduleNotificationAsync,
}));

// 時刻依存を固定する（JST 2026-07-13 21時 = 既定リマインダー20時以降）
vi.mock('../utils/date', () => ({
    getTodayJst: () => '2026-07-13',
    getJstHour: () => 21,
}));

import type { Task } from '@life-quest/core/tasks';
import { ensureNotificationPermission, runMobileNotificationChecks } from './notifications';
import { useMobileSettingsStore } from '../stores/useMobileSettingsStore';
import { useMobileTaskStore } from '../stores/useMobileTaskStore';
import { useMobileHabitStore } from '../stores/useMobileHabitStore';

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
    return {
        id,
        name: `タスク${id}`,
        dueDate: null,
        priority: 'medium',
        tags: [],
        subtasks: [],
        recurrence: 'none',
        completed: false,
        completedAt: null,
        createdAt: '2026-07-01T00:00:00.000Z',
        ...overrides,
    };
}

describe('runMobileNotificationChecks', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-07-13T12:00:00.000Z'));
        vi.clearAllMocks();
        useMobileSettingsStore.setState({
            notificationsEnabled: true,
            habitReminderHour: 20,
            notifiedTaskIds: [],
            lastHabitReminderDate: null,
        });
        useMobileTaskStore.setState({ tasks: [], pendingCompletions: [], hasHydrated: true });
        useMobileHabitStore.setState({ habits: [], records: [], restDays: [], hasHydrated: true });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('トグルOFFなら何も通知しない', async () => {
        useMobileSettingsStore.setState({ notificationsEnabled: false });
        useMobileTaskStore.setState({ tasks: [makeTask('t1', { dueDate: '2026-07-13' })] });
        await runMobileNotificationChecks();
        expect(scheduleNotificationAsync).not.toHaveBeenCalled();
    });

    it('許可が無ければ何も通知しない', async () => {
        getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: true });
        useMobileTaskStore.setState({ tasks: [makeTask('t1', { dueDate: '2026-07-13' })] });
        await runMobileNotificationChecks();
        expect(scheduleNotificationAsync).not.toHaveBeenCalled();
    });

    it('期限が近いタスクをWebと同一文言で通知し、既通知として記録する（再実行で二重通知しない）', async () => {
        useMobileTaskStore.setState({
            tasks: [
                makeTask('due', { dueDate: '2026-07-13' }),
                makeTask('far', { dueDate: '2026-08-01' }),
            ],
        });

        await runMobileNotificationChecks();

        const taskCalls = scheduleNotificationAsync.mock.calls
            .map(([request]) => request as { identifier: string; content: { title: string; body: string } })
            .filter((request) => request.identifier.startsWith('task-deadline-'));
        expect(taskCalls).toHaveLength(1);
        expect(taskCalls[0]).toMatchObject({
            identifier: 'task-deadline-due',
            content: {
                title: 'タスクの期限が近づいています',
                body: '「タスクdue」の期限が近づいています',
            },
        });
        expect(useMobileSettingsStore.getState().notifiedTaskIds).toContain('due');

        scheduleNotificationAsync.mockClear();
        await runMobileNotificationChecks();
        expect(scheduleNotificationAsync.mock.calls.filter(
            ([request]) => (request as { identifier: string }).identifier.startsWith('task-deadline-'),
        )).toHaveLength(0);
    });

    it('リマインダー時刻以降・未完了の習慣があれば件数入りで通知し、本日分を記録する', async () => {
        useMobileHabitStore.setState({
            habits: [
                { id: 'h1', name: '運動', categoryId: 'health', createdAt: '2026-07-01T00:00:00.000Z' },
                { id: 'h2', name: '読書', categoryId: 'learning', createdAt: '2026-07-01T00:00:00.000Z' },
            ],
            records: [{ habitId: 'h1', date: '2026-07-13', completed: true, memo: '' }],
            restDays: [],
        });

        await runMobileNotificationChecks();

        const habitCall = scheduleNotificationAsync.mock.calls
            .map(([request]) => request as { identifier: string; content: { body: string } })
            .find((request) => request.identifier === 'habit-reminder-2026-07-13');
        expect(habitCall?.content.body).toBe('未完了の習慣が1件あります。寝る前に済ませましょう！');
        expect(useMobileSettingsStore.getState().lastHabitReminderDate).toBe('2026-07-13');
    });

    it('全習慣が完了済みなら習慣リマインダーは送らない', async () => {
        useMobileHabitStore.setState({
            habits: [{ id: 'h1', name: '運動', categoryId: 'health', createdAt: '2026-07-01T00:00:00.000Z' }],
            records: [{ habitId: 'h1', date: '2026-07-13', completed: true, memo: '' }],
            restDays: [],
        });
        await runMobileNotificationChecks();
        expect(scheduleNotificationAsync).not.toHaveBeenCalled();
        expect(useMobileSettingsStore.getState().lastHabitReminderDate).toBeNull();
    });

    it('通知の表示に失敗した場合は既通知として記録せず、次回に再試行できる', async () => {
        scheduleNotificationAsync.mockRejectedValueOnce(new Error('boom'));
        useMobileTaskStore.setState({ tasks: [makeTask('due', { dueDate: '2026-07-13' })] });
        await runMobileNotificationChecks();
        expect(useMobileSettingsStore.getState().notifiedTaskIds).not.toContain('due');
    });
});

describe('ensureNotificationPermission', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('既に許可済みなら再要求しない', async () => {
        getPermissionsAsync.mockResolvedValueOnce({ granted: true, canAskAgain: true });
        expect(await ensureNotificationPermission()).toBe(true);
        expect(requestPermissionsAsync).not.toHaveBeenCalled();
    });

    it('未確定なら要求し、拒否されたらfalse', async () => {
        getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: true });
        requestPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false });
        expect(await ensureNotificationPermission()).toBe(false);
    });

    it('再要求できない拒否状態ではダイアログを出さずfalse', async () => {
        getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false });
        expect(await ensureNotificationPermission()).toBe(false);
        expect(requestPermissionsAsync).not.toHaveBeenCalled();
    });
});
