import { useState, useMemo, useRef } from 'react';
import { useStatsStore } from '../stores/useStatsStore';
import { Download, Upload, AlertTriangle } from 'lucide-react';

// ─── ヒートマップ色定義 ─────────────────────────────────────────
const TASK_COLORS = [
    'var(--color-bg-secondary)',   // 0: データなし
    'rgba(99, 102, 241, 0.25)',    // 1: 低XP (1-15)
    'rgba(99, 102, 241, 0.45)',    // 2: 中XP (16-30)
    'rgba(99, 102, 241, 0.65)',    // 3: 高XP (31-50)
    'rgba(99, 102, 241, 0.90)',    // 4: 最高XP (51+)
];
const HABIT_COLORS = [
    'var(--color-bg-secondary)',   // 0: データなし
    'rgba(16, 185, 129, 0.25)',    // 1: 1個達成
    'rgba(16, 185, 129, 0.45)',    // 2: 2-3個達成
    'rgba(16, 185, 129, 0.65)',    // 3: 4個以上
    'rgba(16, 185, 129, 0.90)',    // 4: 全達成
];

const WEEKDAY_LABELS = ['', '月', '', '水', '', '金', ''];

function getTaskLevel(xp: number): number {
    if (xp === 0) return 0;
    if (xp <= 15) return 1;
    if (xp <= 30) return 2;
    if (xp <= 50) return 3;
    return 4;
}

function getHabitLevel(count: number, allComplete: boolean): number {
    if (allComplete) return 4;
    if (count === 0) return 0;
    if (count === 1) return 1;
    if (count <= 3) return 2;
    return 3;
}

/** 過去N日分の日付配列を生成 (YYYY-MM-DD) */
function generateDateRange(days: number): string[] {
    const dates: string[] = [];
    const now = new Date();
    const jstOffset = 9 * 60 * 60 * 1000;
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now.getTime() + jstOffset - i * 86400000);
        dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
}

/** 日付を週ごとにグループ化 */
function groupByWeeks(dates: string[]): string[][] {
    const weeks: string[][] = [];
    const firstDate = new Date(dates[0] + 'T00:00:00+09:00');
    const firstDay = firstDate.getDay();
    const paddedDates = [...Array(firstDay).fill(''), ...dates];

    for (let i = 0; i < paddedDates.length; i += 7) {
        weeks.push(paddedDates.slice(i, i + 7));
    }
    const lastWeek = weeks[weeks.length - 1];
    while (lastWeek.length < 7) lastWeek.push('');
    return weeks;
}

/** 月ラベル位置を計算 */
function getMonthLabels(weeks: string[][]): { label: string; weekIndex: number }[] {
    const labels: { label: string; weekIndex: number }[] = [];
    let lastMonth = '';
    const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

    weeks.forEach((week, weekIndex) => {
        const validDate = week.find((d) => d !== '');
        if (!validDate) return;
        const month = validDate.substring(5, 7);
        if (month !== lastMonth) {
            labels.push({ label: MONTH_NAMES[parseInt(month, 10) - 1], weekIndex });
            lastMonth = month;
        }
    });
    return labels;
}

// ─── データバックアップ/復元 ────────────────────────────────────
const BACKUP_VERSION = 1;

interface BackupData {
    version: number;
    exportedAt: string;
    tasks: unknown;
    habits: unknown;
    game: unknown;
    stats: unknown;
}

function exportAllData(): BackupData {
    return {
        version: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        tasks: JSON.parse(localStorage.getItem('quest-board-tasks') || '{}'),
        habits: JSON.parse(localStorage.getItem('quest-board-habits') || '{}'),
        game: JSON.parse(localStorage.getItem('quest-board-game') || '{}'),
        stats: JSON.parse(localStorage.getItem('quest-board-stats') || '{}'),
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
        return true;
    } catch {
        return false;
    }
}

type TabMode = 'tasks' | 'habits';

export function StatsPage() {
    const [mode, setMode] = useState<TabMode>('tasks');
    const { taskXpLog, habitLog } = useStatsStore();
    const [importStatus, setImportStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [showImportConfirm, setShowImportConfirm] = useState(false);
    const [pendingFile, setPendingFile] = useState<File | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const TOTAL_DAYS = 119;
    const dates = useMemo(() => generateDateRange(TOTAL_DAYS), []);
    const weeks = useMemo(() => groupByWeeks(dates), [dates]);
    const monthLabels = useMemo(() => getMonthLabels(weeks), [weeks]);

    // 集計値
    const stats = useMemo(() => {
        if (mode === 'tasks') {
            let totalXp = 0;
            let activeDays = 0;
            let currentStreak = 0;
            let maxStreak = 0;
            let tempStreak = 0;

            for (const date of dates) {
                const xp = taskXpLog[date] || 0;
                totalXp += xp;
                if (xp > 0) {
                    activeDays++;
                    tempStreak++;
                    maxStreak = Math.max(maxStreak, tempStreak);
                } else {
                    tempStreak = 0;
                }
            }
            for (let i = dates.length - 1; i >= 0; i--) {
                if ((taskXpLog[dates[i]] || 0) > 0) currentStreak++;
                else break;
            }

            return { totalXp, activeDays, currentStreak, maxStreak };
        } else {
            let totalCompletions = 0;
            let perfectDays = 0;
            let currentStreak = 0;
            let maxStreak = 0;
            let tempStreak = 0;

            for (const date of dates) {
                const log = habitLog[date];
                const count = log?.count || 0;
                totalCompletions += count;
                if (log?.allComplete) {
                    perfectDays++;
                    tempStreak++;
                    maxStreak = Math.max(maxStreak, tempStreak);
                } else {
                    tempStreak = 0;
                }
            }
            for (let i = dates.length - 1; i >= 0; i--) {
                if (habitLog[dates[i]]?.allComplete) currentStreak++;
                else break;
            }
            return { totalXp: totalCompletions, activeDays: perfectDays, currentStreak, maxStreak };
        }
    }, [mode, dates, taskXpLog, habitLog]);

    const [tooltipInfo, setTooltipInfo] = useState<{ date: string; value: string } | null>(null);

    // エクスポート処理
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

    // インポート処理（ファイル選択）
    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setPendingFile(file);
        setShowImportConfirm(true);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // インポート確定
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
        <div className="max-w-lg mx-auto px-4 pt-6 pb-8">
            {/* ヘッダー */}
            <h1 className="text-2xl font-bold mb-4" style={{ color: 'var(--color-text-primary)' }}>統計</h1>

            {/* セグメントコントロール */}
            <div className="flex rounded-xl p-1 mb-5" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                {(['tasks', 'habits'] as TabMode[]).map((tab) => (
                    <button
                        key={tab}
                        onClick={() => setMode(tab)}
                        className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200"
                        style={{
                            backgroundColor: mode === tab ? 'var(--color-accent-primary)' : 'transparent',
                            color: mode === tab ? 'white' : 'var(--color-text-muted)',
                        }}
                    >
                        {tab === 'tasks' ? 'タスク' : '習慣'}
                    </button>
                ))}
            </div>

            {/* サマリーカード */}
            <div className="grid grid-cols-2 gap-3 mb-5">
                <SummaryCard
                    label={mode === 'tasks' ? '合計XP' : '合計達成数'}
                    value={stats.totalXp}
                    icon={mode === 'tasks' ? '⚡' : '✅'}
                />
                <SummaryCard
                    label={mode === 'tasks' ? 'アクティブ日数' : '全達成日数'}
                    value={stats.activeDays}
                    icon="📅"
                />
                <SummaryCard label="現在の連続記録" value={stats.currentStreak} icon="🔥" />
                <SummaryCard label="最長連続記録" value={stats.maxStreak} icon="🏆" />
            </div>

            {/* ヒートマップ */}
            <div className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
                <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text-primary)' }}>
                    {mode === 'tasks' ? 'XP獲得ヒートマップ' : '習慣達成ヒートマップ'}
                </h2>

                {/* 月ラベル */}
                <div className="flex ml-7 mb-1 gap-0" style={{ position: 'relative' }}>
                    {monthLabels.map(({ label, weekIndex }, i) => (
                        <div
                            key={i}
                            className="text-[10px] absolute"
                            style={{
                                color: 'var(--color-text-muted)',
                                left: `${weekIndex * 15}px`,
                            }}
                        >
                            {label}
                        </div>
                    ))}
                </div>

                {/* ヒートマップ本体 */}
                <div className="flex gap-0 mt-5" style={{ overflowX: 'auto' }}>
                    {/* 曜日ラベル */}
                    <div className="flex flex-col gap-[2px] mr-1 flex-shrink-0">
                        {WEEKDAY_LABELS.map((label, i) => (
                            <div
                                key={i}
                                className="text-[9px] flex items-center justify-end"
                                style={{ width: '22px', height: '13px', color: 'var(--color-text-muted)' }}
                            >
                                {label}
                            </div>
                        ))}
                    </div>

                    {/* 週ごとのカラム */}
                    {weeks.map((week, wi) => (
                        <div key={wi} className="flex flex-col gap-[2px]">
                            {week.map((date, di) => {
                                if (date === '') {
                                    return (
                                        <div key={`${wi}-${di}`} style={{ width: '13px', height: '13px' }} />
                                    );
                                }

                                let level: number;
                                let tooltipText: string;

                                if (mode === 'tasks') {
                                    const xp = taskXpLog[date] || 0;
                                    level = getTaskLevel(xp);
                                    tooltipText = `${xp} XP`;
                                } else {
                                    const log = habitLog[date];
                                    const count = log?.count || 0;
                                    const allComplete = log?.allComplete || false;
                                    level = getHabitLevel(count, allComplete);
                                    tooltipText = allComplete ? `${count}個 (全達成!)` : `${count}個達成`;
                                }

                                const color = mode === 'tasks' ? TASK_COLORS[level] : HABIT_COLORS[level];

                                return (
                                    <div
                                        key={`${wi}-${di}`}
                                        className="rounded-sm cursor-pointer transition-transform hover:scale-125"
                                        style={{
                                            width: '13px',
                                            height: '13px',
                                            backgroundColor: color,
                                        }}
                                        onClick={() => setTooltipInfo(tooltipInfo?.date === date ? null : { date, value: tooltipText })}
                                        onMouseEnter={() => setTooltipInfo({ date, value: tooltipText })}
                                        onMouseLeave={() => setTooltipInfo(null)}
                                    />
                                );
                            })}
                        </div>
                    ))}
                </div>

                {/* ツールチップ */}
                {tooltipInfo && (
                    <div className="mt-3 text-xs px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)' }}>
                        <span style={{ color: 'var(--color-text-muted)' }}>{tooltipInfo.date}</span>
                        <span className="ml-2 font-medium">{tooltipInfo.value}</span>
                    </div>
                )}

                {/* 凡例 */}
                <div className="flex items-center justify-end gap-1 mt-3">
                    <span className="text-[10px] mr-1" style={{ color: 'var(--color-text-muted)' }}>少</span>
                    {(mode === 'tasks' ? TASK_COLORS : HABIT_COLORS).map((color, i) => (
                        <div
                            key={i}
                            className="rounded-sm"
                            style={{ width: '11px', height: '11px', backgroundColor: color }}
                        />
                    ))}
                    <span className="text-[10px] ml-1" style={{ color: 'var(--color-text-muted)' }}>多</span>
                </div>
            </div>

            {/* ─── データバックアップ ─── */}
            <div className="mt-6 rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
                <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text-primary)' }}>
                    💾 データバックアップ
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
                        バックアップ保存
                    </button>

                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all active:scale-95"
                        style={{ backgroundColor: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-default)' }}
                    >
                        <Upload size={16} />
                        復元する
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        onChange={handleFileSelect}
                        className="hidden"
                    />
                </div>

                {/* インポート確認ダイアログ */}
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

                {/* インポート結果フィードバック */}
                {importStatus === 'success' && (
                    <div className="mt-3 px-4 py-2 rounded-xl text-center text-sm font-medium animate-fade-in"
                        style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', color: 'var(--color-accent-emerald)' }}>
                        ✅ データを復元しました。ページを再読み込みします...
                    </div>
                )}
                {importStatus === 'error' && (
                    <div className="mt-3 px-4 py-2 rounded-xl text-center text-sm font-medium animate-fade-in"
                        style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: 'var(--color-text-danger)' }}>
                        ❌ ファイルの読み込みに失敗しました。正しいバックアップファイルか確認してください。
                    </div>
                )}
            </div>
        </div>
    );
}

function SummaryCard({ label, value, icon }: { label: string; value: number; icon: string }) {
    return (
        <div className="rounded-xl px-4 py-3" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
            <div className="text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>{icon} {label}</div>
            <div className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{value.toLocaleString()}</div>
        </div>
    );
}
