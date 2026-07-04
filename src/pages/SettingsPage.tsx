import { ArrowLeft, ChevronRight, HelpCircle, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AccountSettings } from '../components/ui/AccountSettings';
import { DataBackupSettings } from '../components/ui/DataBackupSettings';
import { MotionSettings } from '../components/ui/MotionSettings';
import { ThemeSettings } from '../components/ui/ThemeSettings';
import { NotificationSettings } from '../components/ui/NotificationSettings';
import { SaveDataHealthSettings } from '../components/ui/SaveDataHealthSettings';
import { UsageStatsSettings } from '../components/ui/UsageStatsSettings';
import { useBackWithFallback } from '../hooks/useBackWithFallback';

export function SettingsPage() {
    const navigate = useNavigate();
    const handleBack = useBackWithFallback();

    return (
        <div className="app-page max-w-lg mx-auto px-5 pt-6 pb-28">
            <div className="flex items-center gap-3 mb-5">
                <button
                    onClick={handleBack}
                    className="w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-95"
                    style={{ backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border-default)' }}
                    aria-label="戻る"
                >
                    <ArrowLeft size={20} />
                </button>
                <div className="flex items-center gap-2">
                    <Settings size={22} style={{ color: 'var(--color-accent-primary)' }} />
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>設定</h1>
                </div>
            </div>

            <div className="flex flex-col gap-4">
                <AccountSettings />
                <ThemeSettings />
                <MotionSettings />
                <NotificationSettings />
                <UsageStatsSettings />
                <button
                    type="button"
                    onClick={() => navigate('/help')}
                    className="rounded-xl p-4 flex items-center justify-between gap-3 text-left transition-all active:scale-[0.99]"
                    style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}
                >
                    <div className="flex items-start gap-2 min-w-0">
                        <HelpCircle size={16} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-accent-primary)' }} />
                        <div className="min-w-0">
                            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>使い方</h2>
                            <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                                タスク、習慣、バトル、通知の説明を確認できます
                            </p>
                        </div>
                    </div>
                    <ChevronRight size={18} className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
                </button>
                <SaveDataHealthSettings />
                <DataBackupSettings />
            </div>
        </div>
    );
}
