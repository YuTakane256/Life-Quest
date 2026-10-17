// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { assertLocalSyncEnvironment, runSyncQuality, syncQualityPlan, syncEnvironmentKeys } from './run-sync-quality.mjs';

const env = {
    SUPABASE_DB_URL: 'postgresql://postgres:test-secret@127.0.0.1:55322/postgres',
    SUPABASE_URL: 'http://127.0.0.1:55321',
    SUPABASE_ANON_KEY: 'test-anon', SUPABASE_SERVICE_ROLE_KEY: 'test-service-secret',
    SUPABASE_FUNCTIONS_URL: 'http://127.0.0.1:55321/functions/v1',
};
describe('同期検証の安全な起動', () => {
    it('環境未設定のunitモードは実DBテストを含めない', () => {
        const plan = syncQualityPlan(['--unit'], {});
        expect(plan).toHaveLength(1);
        expect(plan[0].files).not.toContain('supabase/integration');
    });
    it.each(syncEnvironmentKeys)('%sが無ければ実DB試験を開始しない', (key) => {
        const execute = vi.fn();
        expect(() => runSyncQuality([], { ...env, [key]: '' }, execute)).toThrow(key);
        expect(execute).not.toHaveBeenCalled();
    });
    it.each(['SUPABASE_DB_URL', 'SUPABASE_URL', 'SUPABASE_FUNCTIONS_URL'])('%sの外部URLを拒否し、秘密値を出力しない', (key) => {
        const external = key === 'SUPABASE_DB_URL' ? 'postgresql://postgres:private-secret@db.example.com/db' : 'https://private-secret.example.com';
        expect(() => assertLocalSyncEnvironment({ ...env, [key]: external })).toThrow(/loopback/);
        try { assertLocalSyncEnvironment({ ...env, [key]: external }); } catch (error) { expect(error.message).not.toContain('private-secret'); }
    });
    it.each(['http://127.0.0.1:55322/functions/v1', 'http://localhost:55321/functions/v1',
        'http://127.0.0.1:55321/other', 'http://127.0.0.1:55321/functions/v1?key=private-secret'])('API不一致や別経路を拒否する', (url) => {
        expect(() => assertLocalSyncEnvironment({ ...env, SUPABASE_FUNCTIONS_URL: url })).toThrow('同じローカルAPI');
    });
    it('不正URLのエラーに接続文字列を含めない', () => {
        expect(() => assertLocalSyncEnvironment({ ...env, SUPABASE_DB_URL: 'private-secret' })).toThrow('値は非表示');
    });
    it('DB接続queryでローカル判定を迂回できない', () => {
        expect(() => assertLocalSyncEnvironment({ ...env, SUPABASE_DB_URL: `${env.SUPABASE_DB_URL}?host=external.example.com` })).toThrow('query/fragment');
    });
    it('引数をシェルへ渡さず、未知のオプションを拒否する', () => {
        const execute = vi.fn();
        expect(() => runSyncQuality(['--integration', 'evil'], env, execute)).toThrow('使い方');
        expect(execute).not.toHaveBeenCalled();
    });
    it('実DBモードは全既存統合テストを含み、境界回帰と明確に分ける', () => {
        expect(syncQualityPlan(['--integration'], env)).toEqual([
            { label: expect.stringContaining('ローカル実DB'), files: ['supabase/integration'] },
        ]);
        expect(syncQualityPlan([], env)).toHaveLength(2);
    });
    it('先の試験が失敗したら後段を実行せず失敗を返す', () => {
        const execute = vi.fn(() => ({ status: 2 }));
        expect(runSyncQuality([], env, execute)).toBe(2);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls[0][1][1]).toBe('run');
        expect(execute.mock.calls[0][2].shell).toBeUndefined();
    });
    it('全段成功の場合だけ成功を返し、中断を成功扱いにしない', () => {
        const execute = vi.fn(() => ({ status: 0 }));
        expect(runSyncQuality([], env, execute)).toBe(0); expect(execute).toHaveBeenCalledTimes(2);
        expect(() => runSyncQuality(['--unit'], {}, () => ({ signal: 'SIGTERM', status: null }))).toThrow();
    });
});
