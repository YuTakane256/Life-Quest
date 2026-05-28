import { useRef, useState } from 'react';
import { AlertTriangle, Download, Upload } from 'lucide-react';

const BACKUP_VERSION = 1;

interface BackupData {
    version: number;
    exportedAt: string;
    tasks: unknown;
    habits: unknown;
    game: unknown;
    stats: unknown;
    theme?: unknown;
}

function exportAllData(): BackupData {
    return {
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        tasks: JSON.parse(localStorage.getItem('quest-board-tasks') || '{}'),
        habits: JSON.parse(localStorage.getItem('quest-board-habits') || '{}'),
        game: JSON.parse(localStorage.getItem('quest-board-game') || '{}'),
        stats: JSON.parse(localStorage.getItem('quest-board-stats') || '{}'),
        theme: JSON.parse(localStorage.getItem('quest-board-theme') || '{}'),
    };
}

function importAllData(data: BackupData): boolean {
    try {
        if (!data.version || !data.tasks || !data.game) {
            return false;
        }
        localStorage.setItem('quest-board-tasks', JSON.stringify(data.tasks));
        localStorage.setItem('quest-board-habits', JSON.stringify(data.habits));
        localStorage.setItem('quest-board-game', JSON.stringify(data.game));
        localStorage.setItem('quest-board-stats', JSON.stringify(data.stats));
        if (data.theme) localStorage.setItem('quest-board-theme', JSON.stringify(data.theme));
        return true;
    } catch {
        return false;
    }
}

export function DataBackupSettings() {
    const [importStatus, setImportStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [showImportConfirm, setShowImportConfirm] = useState(false);
    const [pendingFile, setPendingFile] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

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

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (fileInputRef.current) fileInputRef.current.value = '';
        if (!file) return;
        // 拡張子と MIME の二重チェック。<input accept=".json"> は OS ダイアログのヒントに
        // すぎないため、任意ファイルが流れ込んでも先に弾く。
        const isJsonExt = file.name.toLowerCase().endsWith('.json');
        const isAllowedMime = file.type === '' || file.type === 'application/json'
            || file.type === 'text/plain' || file.type === 'text/json';
        if (!isJsonExt || !isAllowedMime) {
            setImportStatus('error');
            setTimeout(() => setImportStatus('idle'), 3000);
            return;
        }
        setPendingFile(file);
        setShowImportConfirm(true);
    };

    const handleImportConfirm = async () => {
        if (!pendingFile) return;
        try {
            const text = await pendingFile.text();
            const data = JSON.parse(text) as BackupData;
            const success = importAllData(data);
            if (success) {
                setImportStatus('success');
                setShowImportConfirm(false);
                setPendingFile(null);
                setTimeout(() => window.location.reload(), 1500);
            } else {
                setImportStatus('error');
            }
        } catch {
            setImportStatus('error');
        }
        setTimeout(() => setImportStatus('idle'), 3000);
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

            {showImportConfirm && (
                <div className="mt-3 px-4 py-3 rounded-xl animate-fade-in" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                    <div className="flex items-start gap-2 mb-3">
                        <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-text-danger)' }} />
                        <div>
                            <div className="text-sm font-medium" style={{ color: 'var(--color-text-danger)' }}>データを上書きしますか？</div>
                            <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                                現在のセーブデータはバックアップファイルの内容に置き換わります。この操作は取り消せません。
                            </div>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={handleImportConfirm}
                            className="flex-1 py-2 rounded-lg text-sm font-medium"
                            style={{ backgroundColor: 'var(--color-text-danger)', color: 'white' }}
                        >
                            上書きする
                        </button>
                        <button
                            onClick={() => { setShowImportConfirm(false); setPendingFile(null); }}
                            className="flex-1 py-2 rounded-lg text-sm"
                            style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-muted)' }}
                        >
                            キャンセル
                        </button>
                    </div>
                </div>
            )}

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
