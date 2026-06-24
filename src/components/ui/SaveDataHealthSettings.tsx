import { useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { inspectSaveDataHealth, type SaveDataSectionStatus } from '../../utils/saveDataHealth';
import { formatStorageBytes } from '../../utils/storageUsage';

const STATUS_LABELS: Record<SaveDataSectionStatus, string> = {
    healthy: '正常',
    missing: '未作成',
    invalid: '要確認',
};

const STATUS_COLORS: Record<SaveDataSectionStatus, string> = {
    healthy: 'var(--color-accent-emerald)',
    missing: 'var(--color-text-muted)',
    invalid: 'var(--color-text-danger)',
};

export function SaveDataHealthSettings() {
    const [, setRefreshToken] = useState(0);
    const report = inspectSaveDataHealth();

    const headline = report.invalidCount > 0
        ? `${report.invalidCount}件の破損候補`
        : report.available
            ? '保存データは読み取り可能'
            : '保存データを確認できません';

    return (
        <section className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
            <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-start gap-2 min-w-0">
                    <ShieldCheck size={16} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-accent-primary)' }} />
                    <div className="min-w-0">
                        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>セーブデータ診断</h2>
                        <p className="text-xs mt-1" style={{ color: report.invalidCount > 0 ? 'var(--color-text-danger)' : 'var(--color-text-muted)' }}>
                            {headline}
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => setRefreshToken((value) => value + 1)}
                    className="w-9 h-9 rounded-lg flex items-center justify-center transition-all active:scale-95"
                    style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' }}
                    aria-label="診断を更新"
                >
                    <RefreshCw size={15} />
                </button>
            </div>

            {report.available && (
                <>
                    <div className="grid grid-cols-3 gap-2 mb-3">
                        <Summary label="正常" value={report.healthyCount} color="var(--color-accent-emerald)" />
                        <Summary label="未作成" value={report.missingCount} color="var(--color-text-muted)" />
                        <Summary label="要確認" value={report.invalidCount} color="var(--color-text-danger)" />
                    </div>
                    <div className="text-[11px] mb-3" style={{ color: 'var(--color-text-muted)' }}>
                        推定サイズ: {formatStorageBytes(report.totalBytes)}
                    </div>
                    <div className="flex flex-col gap-1.5">
                        {report.sections.map((section) => (
                            <div key={section.key} className="flex items-center justify-between gap-2 text-xs">
                                <span className="truncate" style={{ color: 'var(--color-text-secondary)' }}>
                                    {section.label}
                                </span>
                                <span className="font-semibold flex-shrink-0" style={{ color: STATUS_COLORS[section.status] }}>
                                    {STATUS_LABELS[section.status]}
                                </span>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </section>
    );
}

function Summary({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div className="rounded-lg px-2 py-2 text-center" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
            <div className="text-base font-bold" style={{ color }}>{value}</div>
            <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{label}</div>
        </div>
    );
}
