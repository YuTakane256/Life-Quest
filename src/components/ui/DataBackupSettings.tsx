import { useCallback, useEffect, useRef, useState } from 'react';
import { captureAuthSessionScope, subscribeAuthSessionScope, waitForAuthLifecycleSettled } from '@life-quest/core/authLifecycle';
import { Download, Upload } from 'lucide-react';
import { createBackupImportSummary, formatBackupExportedAt, type BackupImportSummary } from '../../utils/backupSummary';
import { exportAllData, importAllData, MAX_IMPORT_FILE_SIZE, parseBackupImportJson, type BackupData } from '../../utils/dataBackup';
import { ConfirmDialog } from './ConfirmDialog';
import { withSettledGamePersistence } from '../../platform/completionRewards';
import { downloadBackupFile, reloadAfterBackupImport } from '../../platform/backupBrowser';

type BackupPhase = 'read' | 'confirm' | 'export' | 'import' | 'reload' | 'error';
interface BackupOperation {
    phase: BackupPhase;
    isActive: () => boolean;
}

export function DataBackupSettings() {
    const [importStatus, setImportStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [showImportConfirm, setShowImportConfirm] = useState(false);
    const [pendingBackup, setPendingBackup] = useState<{ data: BackupData; operation: BackupOperation } | null>(null);
    const [backupSummary, setBackupSummary] = useState<BackupImportSummary | null>(null);
    const [busy, setBusy] = useState<BackupPhase | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const mounted = useRef(false);
    const current = useRef<BackupOperation | null>(null);
    const timers = useRef(new Set<number>());

    const invalidate = useCallback(() => {
        current.current = null;
        for (const timer of timers.current) window.clearTimeout(timer);
        timers.current.clear();
    }, []);

    const reset = useCallback(() => {
        invalidate();
        setImportStatus('idle');
        setBusy(null);
        setShowImportConfirm(false);
        setPendingBackup(null);
        setBackupSummary(null);
    }, [invalidate]);

    useEffect(() => {
        mounted.current = true;
        const unsubscribe = subscribeAuthSessionScope(reset);
        return () => { mounted.current = false; invalidate(); unsubscribe(); };
    }, [invalidate, reset]);

    const begin = (phase: BackupPhase) => {
        if (!mounted.current || ['export', 'import', 'reload'].includes(current.current?.phase ?? '')) return null;
        reset();
        const scope = captureAuthSessionScope();
        const operation: BackupOperation = {
            phase,
            isActive: () => mounted.current && current.current === operation && scope.isCurrent(),
        };
        current.current = operation;
        setBusy(phase);
        return operation;
    };

    const schedule = (operation: BackupOperation, callback: () => void, delay: number) => {
        const timer = window.setTimeout(() => {
            timers.current.delete(timer);
            if (operation.isActive()) callback();
        }, delay);
        timers.current.add(timer);
    };

    const showImportError = (operation: BackupOperation) => {
        if (!operation.isActive()) return;
        operation.phase = 'error';
        setBusy(null);
        setImportStatus('error');
        setShowImportConfirm(false);
        setPendingBackup(null);
        setBackupSummary(null);
        schedule(operation, reset, 3000);
    };

    const handleExport = async () => {
        const operation = begin('export');
        if (!operation) return;
        try {
            // A new scope is published before its async storage cleanup/initialization finishes.
            await waitForAuthLifecycleSettled();
            if (!operation.isActive()) return;
            // Check inside the lock too: the session may change while persistence settles.
            const data = await withSettledGamePersistence(() => operation.isActive() ? exportAllData() : null);
            if (!operation.isActive() || !data) return;
            downloadBackupFile(data);
            reset();
        } catch { showImportError(operation); }
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (!file) return;
        // A newer selection supersedes an older read/preview, but never an active write/export.
        const operation = begin('read');
        if (!operation) return;
        // ファイルサイズチェック (5MB 上限)。ここで弾けば巨大ファイルの読み込みを避けられる。
        if (file.size > MAX_IMPORT_FILE_SIZE) {
            showImportError(operation);
            return;
        }

        // 拡張子と MIME の二重チェック。<input accept=".json"> は OS ダイアログのヒントに
        // すぎないため、任意ファイルが流れ込んでも先に弾く。
        const isJsonExt = file.name.toLowerCase().endsWith('.json');
        const isAllowedMime = file.type === '' || file.type === 'application/json'
            || file.type === 'text/plain' || file.type === 'text/json';
        if (!isJsonExt || !isAllowedMime) {
            showImportError(operation);
            return;
        }

        try {
            const text = await file.text();
            if (!operation.isActive()) return;
            const parsed = parseBackupImportJson(text);
            if (!parsed.ok) {
                showImportError(operation);
                return;
            }

            setPendingBackup({ data: parsed.data, operation });
            setBackupSummary(createBackupImportSummary(parsed.data));
            setShowImportConfirm(true);
            operation.phase = 'confirm';
            setBusy(null);
        } catch {
            showImportError(operation);
        }
    };

    const handleImportConfirm = async () => {
        const operation = current.current;
        if (!pendingBackup || pendingBackup.operation !== operation || operation.phase !== 'confirm' || !operation.isActive()) return;
        operation.phase = 'import'; // Ref gate also rejects two clicks before React re-renders.
        setBusy('import');
        try {
            await waitForAuthLifecycleSettled();
            if (!operation.isActive()) return;
            const success = await withSettledGamePersistence(() => {
                if (!operation.isActive() || !importAllData(pendingBackup.data)) return false;
                operation.phase = 'reload';
                setBusy('reload');
                setImportStatus('success');
                setShowImportConfirm(false);
                setPendingBackup(null);
                setBackupSummary(null);
                // Raw storage has committed; reload is part of that same synchronous operation.
                // Never cancel rehydration on unmount or leave stale live stores usable for 1.5s.
                reloadAfterBackupImport();
                return true;
            });
            if (!operation.isActive()) return;
            if (!success) showImportError(operation);
        } catch {
            showImportError(operation);
        }
    };

    const locked = busy === 'export' || busy === 'import' || busy === 'reload';

    return (
        <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
            <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                データバックアップ
            </h2>
            <p className="text-xs mb-4" style={{ color: 'var(--color-text-muted)' }}>
                セーブデータをJSONファイルとして保存・復元できます
            </p>

            <div className="flex gap-3">
                <button
                    onClick={handleExport}
                    disabled={busy !== null || showImportConfirm}
                    aria-busy={busy === 'export'}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all active:scale-95"
                    style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}
                >
                    <Download size={16} />
                    {busy === 'export' ? '保存中…' : '保存'}
                </button>

                <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={locked}
                    aria-busy={busy === 'read' || busy === 'import' || busy === 'reload'}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all active:scale-95"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-default)' }}
                >
                    <Upload size={16} />
                    {busy === 'read' ? '読込中…' : busy === 'import' || busy === 'reload' ? '復元中…' : '復元'}
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    disabled={locked}
                    onChange={handleFileSelect}
                    className="hidden"
                />
            </div>

            <ConfirmDialog
                open={showImportConfirm}
                title="データを上書きしますか？"
                message={<BackupPreview summary={backupSummary} />}
                confirmLabel={busy === 'import' ? '復元中…' : '上書きする'}
                confirmDisabled={busy === 'import'}
                confirmColor="var(--color-text-danger)"
                onConfirm={handleImportConfirm}
                onClose={reset}
            />

            {importStatus === 'success' && (
                <div
                    role="status"
                    className="mt-3 px-4 py-2 rounded-xl text-center text-sm font-medium animate-fade-in"
                    style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', color: 'var(--color-accent-emerald)' }}
                >
                    データを復元しました。ページを再読み込みします...
                </div>
            )}
            {importStatus === 'error' && (
                <div
                    role="alert"
                    className="mt-3 px-4 py-2 rounded-xl text-center text-sm font-medium animate-fade-in"
                    style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: 'var(--color-text-danger)' }}
                >
                    バックアップ操作に失敗しました。保存環境とバックアップファイルを確認してください。
                </div>
            )}
        </div>
    );
}

function BackupPreview({ summary }: { summary: BackupImportSummary | null }) {
    if (!summary) {
        return <span>現在のセーブデータはバックアップファイルの内容に置き換わります。この操作は取り消せません。</span>;
    }

    const rows = [
        { label: 'タスク', value: summary.taskCount },
        { label: '習慣', value: summary.habitCount },
        { label: '習慣記録', value: summary.habitRecordCount },
        { label: '装備', value: summary.equipmentCount },
        { label: '未開封宝箱', value: summary.unopenedChestCount },
        { label: '開封済み宝箱', value: summary.openedChestCount },
        { label: 'タスクXP記録日', value: summary.taskXpDayCount },
        { label: '習慣ログ日', value: summary.habitLogDayCount },
    ];

    return (
        <div className="flex flex-col gap-3">
            <p>現在のセーブデータはバックアップファイルの内容に置き換わります。この操作は取り消せません。</p>
            <div className="rounded-xl p-3" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                <div className="text-xs mb-2" style={{ color: 'var(--color-text-muted)' }}>
                    作成日時: {formatBackupExportedAt(summary.exportedAt)}
                </div>
                <div className="grid grid-cols-2 gap-2">
                    {rows.map((row) => (
                        <div key={row.label} className="flex items-center justify-between gap-2 text-xs">
                            <span style={{ color: 'var(--color-text-muted)' }}>{row.label}</span>
                            <span className="font-bold" style={{ color: 'var(--color-text-primary)' }}>
                                {row.value.toLocaleString()}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
