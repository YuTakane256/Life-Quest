import { describe, expect, it } from 'vitest';
import { buildWebImportSnapshot } from './cloudMigration';
import { useThemeStore } from '../stores/useThemeStore';
import { useMotionStore } from '../stores/useMotionStore';
import { useNotificationStore } from '../stores/useNotificationStore';

describe('buildWebImportSnapshot の settings（初回クラウド移行スナップショット）', () => {
    it('3ストアの現在値を4項目だけ集約し、デバイスローカル項目は含めない', () => {
        useThemeStore.setState({ mode: 'dark' });
        useMotionStore.setState({ mode: 'reduced' });
        useNotificationStore.setState({
            enabled: true,
            habitReminderHour: 22,
            notifiedTaskIds: ['task-1', 'task-2'],
            lastHabitReminderDate: '2026-07-20',
        });

        const snapshot = buildWebImportSnapshot();

        expect(snapshot.settings).toEqual({
            themeMode: 'dark',
            motionMode: 'reduced',
            notificationsEnabled: true,
            habitReminderHour: 22,
        });
        expect(snapshot.settings).not.toHaveProperty('notifiedTaskIds');
        expect(snapshot.settings).not.toHaveProperty('lastHabitReminderDate');
    });
});
