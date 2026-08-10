import type { Page } from '@playwright/test';

const FIXED_NOW = '2026-08-10T12:00:00.000Z';

const taskParityState = {
    state: {
        tasks: [
            {
                id: 'parity-plan-week',
                name: '今週の計画を整理する',
                dueDate: null,
                priority: 'high',
                tags: ['仕事'],
                recurrence: 'none',
                completed: false,
                completedAt: null,
                createdAt: '2026-08-01T09:00:00.000Z',
                subtasks: [
                    {
                        id: 'parity-plan-week-draft',
                        name: '優先順位を書き出す',
                        completed: true,
                        completedAt: '2026-08-09T09:00:00.000Z',
                        createdAt: '2026-08-01T09:00:00.000Z',
                    },
                    {
                        id: 'parity-plan-week-review',
                        name: '予定を確認する',
                        completed: false,
                        completedAt: null,
                        createdAt: '2026-08-01T09:00:00.000Z',
                    },
                ],
            },
            {
                id: 'parity-reply-email',
                name: 'メールを返信する',
                dueDate: null,
                priority: 'medium',
                tags: ['連絡'],
                recurrence: 'none',
                completed: false,
                completedAt: null,
                createdAt: '2026-08-02T09:00:00.000Z',
                subtasks: [],
            },
            {
                id: 'parity-completed-walk',
                name: '朝の散歩を記録する',
                dueDate: null,
                priority: 'low',
                tags: ['健康'],
                recurrence: 'none',
                completed: true,
                completedAt: '2026-08-09T10:00:00.000Z',
                createdAt: '2026-08-01T09:00:00.000Z',
                subtasks: [],
            },
        ],
    },
    version: 0,
};

/** Installs an isolated, stable anonymous state before the application loads. */
export async function installTaskParityState(page: Page): Promise<void> {
    await page.clock.install({ time: new Date(FIXED_NOW) });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.addInitScript((state) => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        window.localStorage.setItem('quest-board-tasks', JSON.stringify(state.tasks));
        window.localStorage.setItem('quest-board-task-sort', JSON.stringify({ state: { sortMode: 'dueDate' }, version: 1 }));
        window.localStorage.setItem('quest-board-theme', JSON.stringify({ state: { mode: 'dark' }, version: 1 }));
        window.localStorage.setItem('quest-board-motion', JSON.stringify({ state: { mode: 'reduced' }, version: 1 }));
        window.localStorage.setItem('quest-board-login-bonus', JSON.stringify({
            state: { anonymousState: { lastLoginDate: '2026-08-10', streak: 1 } },
            version: 2,
        }));
        Math.random = () => 0.123456789;
    }, {
        tasks: taskParityState,
    });
}

export const taskParitySnapshotName = 'task-page-dark.png';
