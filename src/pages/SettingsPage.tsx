import { ArrowLeft, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DataBackupSettings } from '../components/ui/DataBackupSettings';
import { ThemeSettings } from '../components/ui/ThemeSettings';
import { NotificationSettings } from '../components/ui/NotificationSettings';

export function SettingsPage() {
    const navigate = useNavigate();

    return (
        <div className="max-w-lg mx-auto px-5 pt-6 pb-28">
            <div className="flex items-center gap-3 mb-5">
                <button
                    onClick={() => navigate(-1)}
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
                <ThemeSettings />
                <NotificationSettings />
                <DataBackupSettings />
            </div>
        </div>
    );
}
