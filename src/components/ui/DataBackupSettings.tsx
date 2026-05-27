import { useRef, useState } from 'react';
import { AlertTriangle, Download, Upload } from 'lucide-react';

const BACKUP_VERSION = 1;
const MAX_IMPORT_FILE_SIZE = 5 * 1024 * 1024; // 5MB

interface BackupData {
    version: number;
    exportedAt: string;
    tasks: unknown;
    habits: unknown;
    game: unknown;
    stats: unknown;
    theme?: unknown;
}

/** Plain object（配列・null は除く）かどうか */
function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** バックアップ JSON が想定する構造になっているか検証する型ガード */
function isValidBackup(data: unknown): data is BackupData {
    if (!isPlainObject(data)) return false;
    if (data.version !== BACKUP_VERSION) return false;
    if (typeof data.exportedAt !== 'string') return false;
    // exportedAt は ISO 8601 形式（Date でパースできること）
    if (Number.isNaN(new Date(data.exportedAt).getTime())) return false;
    if (!isPlainObject(data.tasks)) return false;
    if (!isPlainObject(data.habits)) return false;
    if (!isPlainObject(data.game)) return false;
    if (!isPlainObject(data.stats)) return false;
    // theme は省略可だが、あればオブジェクト
    if (data.theme !== undefined && !isPlainObject(data.theme)) return false;
    return true;
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
        // ファイルサイズチェック (5MB 上限)。ここで弾けば巨大ファイルの読み込みを避けられる。
        if (file.size > MAX_IMPORT_FILE_SIZE) {
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
            const parsed: unknown = JSON.parse(text);
            if (!isValidBackup(parsed)) {
                setImportStatus('error');
                setShowImportConfirm(false);
                setPendingFile(null);
                setTimeout(() => setImportStatus('idle'), 3000);
                return;
            }
            const success = importAllData(parsed);
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
