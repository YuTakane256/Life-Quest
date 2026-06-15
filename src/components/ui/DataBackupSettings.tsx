import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { exportAllData, importAllData, isValidBackup, MAX_IMPORT_FILE_SIZE } from '../../utils/dataBackup';
import { ConfirmDialog } from './ConfirmDialog';

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
                setShowImportConfirm(false);
                setPendingFile(null);
            }
        } catch {
            setImportStatus('error');
            setShowImportConfirm(false);
            setPendingFile(null);
        }
        setTimeout(() => setImportStatus('idle'), 3000);
    };

    const handleImportCancel = () => {
        setShowImportConfirm(false);
        setPendingFile(null);
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
                message="現在のセーブデータはバックアップファイルの内容に置き換わります。この操作は取り消せません。"
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
