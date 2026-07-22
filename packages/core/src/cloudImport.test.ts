import { describe, expect, it } from 'vitest';
import { buildImportPayload, buildMobileContentPayload, preMigrationBackupKey } from './cloudImport.ts';
import type { Task } from './tasks.ts';

function task(overrides: Partial<Task> = {}): Task {
    return {
        id: 'local-task-1',
        name: 'タスク',
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

describe('buildImportPayload（#506）', () => {
    it('ローカルIDをclient_idとして送り、サブタスクはtask_client_idで親を参照する', () => {
        const payload = buildImportPayload({
            tasks: [task({
                id: '1751000000000-abc123', // Web形式の非UUID ID
                subtasks: [{ id: 'sub-1', name: '子', completed: false, completedAt: null, createdAt: '2026-07-01T00:00:00.000Z' }],
            })],
        });
        expect(payload.tasks[0].client_id).toBe('1751000000000-abc123');
        expect(payload.tasks[0]).not.toHaveProperty('id');
        expect(payload.subtasks[0]).toMatchObject({ client_id: 'sub-1', task_client_id: '1751000000000-abc123' });
    });

    it('証跡ledgerは完了済み項目とクライアント台帳の和集合（取り込み対象内のみ）', () => {
        const payload = buildImportPayload({
            tasks: [
                task({ id: 't-done', completed: true, completedAt: '2026-07-02T00:00:00.000Z' }),
                task({ id: 't-open' }),
            ],
            rewardLedger: {
                rewardedTaskIds: ['t-open', 't-unknown'], // t-unknownは取り込み対象外なので落ちる
                habitBonusDates: ['2026-07-01', 'invalid-date'],
            },
            allCompleteDates: ['2026-07-02'],
        });
        expect(payload.ledger.task_client_ids.sort()).toEqual(['t-done', 't-open']);
        expect(payload.ledger.habit_bonus_dates).toEqual(['2026-07-01', '2026-07-02']);
    });

    it('不正な日付・未知の装備テンプレート・未知の宝箱タイプは落とす', () => {
        const payload = buildImportPayload({
            tasks: [task({ dueDate: 'not-a-date' })],
            restDays: [{ date: '2026-07-01', isRest: true }, { date: 'bad', isRest: true }],
            equipment: [{ templateId: 'wooden_sword', equipped: true }, { templateId: 'hacked_sword', equipped: false }],
            chestQueue: [{ chestType: 'gold', label: '金' }, { chestType: 'diamond', label: '偽' }],
        });
        expect(payload.tasks[0].due_date).toBeNull();
        expect(payload.rest_days).toHaveLength(1);
        expect(payload.inventory_items).toEqual([{ template_id: 'wooden_sword', equipped: true }]);
        expect(payload.chests).toHaveLength(1);
        expect(payload.chests[0].chest_type).toBe('gold');
    });

    it('characterは数値を非負整数へ丸め、境界値を守る', () => {
        const payload = buildImportPayload({
            character: { totalXp: -5, gachaCount: 3.7, currentStage: 0, maxClearedStage: -1, avatar: 'male' },
        });
        expect(payload.character).toMatchObject({
            total_xp: 0, gacha_count: 3, current_stage: 1, max_cleared_stage: 0, avatar: 'male',
        });
    });

    it('親の無い習慣ログはcoreサニタイザが落とす', () => {
        const payload = buildImportPayload({
            habits: [{ id: 'h1', name: '運動', categoryId: 'health', createdAt: '2026-07-01T00:00:00.000Z' }],
            dailyRecords: [
                { habitId: 'h1', date: '2026-07-01', completed: true, memo: '' },
                { habitId: 'orphan', date: '2026-07-01', completed: true, memo: '' },
            ],
        });
        expect(payload.habit_logs).toHaveLength(1);
        expect(payload.habit_logs[0].habit_client_id).toBe('h1');
    });

    it('buildMobileContentPayloadはコンテンツのみ（ゲーム状態を含まない）', () => {
        const payload = buildMobileContentPayload({
            tasks: [task({ id: 'm-1', completed: true, completedAt: '2026-07-02T00:00:00.000Z' })],
        });
        expect(payload.character).toBeNull();
        expect(payload.inventory_items).toHaveLength(0);
        expect(payload.chests).toHaveLength(0);
        expect(payload.ledger.task_client_ids).toEqual(['m-1']); // 承認済み完了分の証跡のみ
    });

    it('preMigrationBackupKeyはuser_id別namespace', () => {
        expect(preMigrationBackupKey('u1')).toBe('life-quest:cloud:u1:pre-migration-backup:v1');
        expect(preMigrationBackupKey('u1')).not.toBe(preMigrationBackupKey('u2'));
    });

    it('settingsが無ければnull（Mobileコンテンツ移行はゲーム状態を含まないため）', () => {
        const payload = buildImportPayload({});
        expect(payload.settings).toBeNull();
        expect(buildMobileContentPayload({ tasks: [] }).settings).toBeNull();
    });

    it('settingsは4項目のallowlistのみ通し、未知のキーは落とす', () => {
        const payload = buildImportPayload({
            settings: {
                themeMode: 'dark',
                motionMode: 'reduced',
                notificationsEnabled: true,
                habitReminderHour: 21,
                notifiedTaskIds: ['should-not-leak'],
                lastHabitReminderDate: '2026-07-01',
            },
        });
        expect(payload.settings).toEqual({
            themeMode: 'dark',
            motionMode: 'reduced',
            notificationsEnabled: true,
            habitReminderHour: 21,
        });
    });

    it('settingsがオブジェクトでない場合はnull', () => {
        expect(buildImportPayload({ settings: 'not-an-object' as unknown as Record<string, unknown> }).settings).toBeNull();
        expect(buildImportPayload({ settings: ['array'] as unknown as Record<string, unknown> }).settings).toBeNull();
    });
});
