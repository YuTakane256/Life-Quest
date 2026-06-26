import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { createBackupImportSummary, formatBackupExportedAt, type BackupImportSummary } from '../../utils/backupSummary';
import { exportAllData, importAllData, MAX_IMPORT_FILE_SIZE, parseBackupImportJson, type BackupData } from '../../utils/dataBackup';
import { ConfirmDialog } from './ConfirmDialog';

export function DataBackupSettings() {
    const [importStatus, setImportStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [showImportConfirm, setShowImportConfirm] = useState(false);
    const [pendingBackup, setPendingBackup] = useState<BackupData | null>(null);
    const [backupSummary, setBackupSummary] = useState<BackupImportSummary | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const showImportError = () => {
        setImportStatus('error');
        setShowImportConfirm(false);
        setPendingBackup(null);
        setBackupSummary(null);
        setTimeout(() => setImportStatus('idle'), 3000);
    };

    const handleExport = () => {
        const data = exportAllData();
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `life-quest-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (!file) return;
        // ファイルサイズチェック (5MB 上限)。ここで弾けば巨大ファイルの読み込みを避けられる。
        if (file.size > MAX_IMPORT_FILE_SIZE) {
            showImportError();
            return;
        }

        // 拡張子と MIME の二重チェック。<input accept=".json"> は OS ダイアログのヒントに
        // すぎないため、任意ファイルが流れ込んでも先に弾く。
        const isJsonExt = file.name.toLowerCase().endsWith('.json');
        const isAllowedMime = file.type === '' || file.type === 'application/json'
            || file.type === 'text/plain' || file.type === 'text/json';
        if (!isJsonExt || !isAllowedMime) {
            showImportError();
            return;
        }

        try {
            const text = await file.text();
            const parsed = parseBackupImportJson(text);
            if (!parsed.ok) {
                showImportError();
                return;
            }

            setPendingBackup(parsed.data);
            setBackupSummary(createBackupImportSummary(parsed.data));
            setShowImportConfirm(true);
        } catch {
            showImportError();
        }
    };

    const handleImportConfirm = () => {
        if (!pendingBackup) return;
        try {
            const success = importAllData(pendingBackup);
            if (success) {
                setImportStatus('success');
                setShowImportConfirm(false);
                setPendingBackup(null);
                setBackupSummary(null);
                setTimeout(() => window.location.reload(), 1500);
                setTimeout(() => setImportStatus('idle'), 3000);
            } else {
                showImportError();
            }
        } catch {
            showImportError();
        }
    };

    const handleImportCancel = () => {
        setShowImportConfirm(false);
        setPendingBackup(null);
        setBackupSummary(null);
    };

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
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all active:scale-95"
                    style={{ backgroundColor: 'var(--color-accent-primary)', color: 'white' }}
                >
                    <Download size={16} />
                    保存
                </button>

                <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all active:scale-95"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-default)' }}
                >
                    <Upload size={16} />
                    復元
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleFileSelect}
                    className="hidden"
                />
            </div>

            <ConfirmDialog
                open={showImportConfirm}
                title="データを上書きしますか？"
                message={<BackupPreview summary={backupSummary} />}
                confirmLabel="上書きする"
                confirmColor="var(--color-text-danger)"
                onConfirm={handleImportConfirm}
                onClose={handleImportCancel}
            />

            {importStatus === 'success' && (
                <div
                    className="mt-3 px-4 py-2 rounded-xl text-center text-sm font-medium animate-fade-in"
                    style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', color: 'var(--color-accent-emerald)' }}
                >
                    データを復元しました。ページを再読み込みします...
                </div>
            )}
            {importStatus === 'error' && (
                <div
                    className="mt-3 px-4 py-2 rounded-xl text-center text-sm font-medium animate-fade-in"
                    style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: 'var(--color-text-danger)' }}
                >
                    ファイルの読み込みに失敗しました。正しいバックアップファイルか確認してください。
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
