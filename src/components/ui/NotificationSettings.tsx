import { useState } from 'react';
import { Bell } from 'lucide-react';
import { useNotificationStore } from '../../stores/useNotificationStore';
import {
    getNotificationPermission,
    requestNotificationPermission,
    runNotificationChecks,
} from '../../utils/notifications';
import { formatReminderHourLabel } from '../../utils/timeLabels';

export function NotificationSettings() {
    const enabled = useNotificationStore((s) => s.enabled);
    const setEnabled = useNotificationStore((s) => s.setEnabled);
    const reminderHour = useNotificationStore((s) => s.habitReminderHour ?? 20);
    const setReminderHour = useNotificationStore((s) => s.setHabitReminderHour);
    const [permission, setPermission] = useState(getNotificationPermission());

    const unsupported = permission === 'unsupported';
    const blocked = permission === 'denied';
    const disabled = unsupported || blocked;

    const handleToggle = async () => {
        if (enabled) {
            setEnabled(false);
            return;
        }
        // ONにする: 必要なら許可を要求する
        let current = getNotificationPermission();
        if (current === 'default') {
            current = await requestNotificationPermission();
            setPermission(current);
        }
        if (current === 'granted') {
            setEnabled(true);
            void runNotificationChecks();
        }
    };

    return (
        <section className="rounded-xl p-4" style={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border-default)' }}>
            <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                    <Bell size={16} className="mt-0.5" style={{ color: 'var(--color-accent-primary)' }} />
                    <div>
                        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>通知</h2>
                        <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                            期限が近いタスクや、やり残した習慣をお知らせします
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={handleToggle}
                    disabled={disabled}
                    role="switch"
                    aria-checked={enabled}
                    aria-label="通知のON/OFF"
                    className="relative w-11 h-6 rounded-full transition-colors flex-shrink-0"
                    style={{
                        backgroundColor: enabled ? 'var(--color-accent-primary)' : 'var(--color-bg-secondary)',
                        border: '1px solid var(--color-border-default)',
                        opacity: disabled ? 0.4 : 1,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                >
                    <span
                        className="absolute top-0.5 w-5 h-5 rounded-full transition-all"
                        style={{ left: enabled ? '21px' : '2px', backgroundColor: 'white' }}
                    />
                </button>
            </div>

            {unsupported && (
                <p className="text-xs mt-3" style={{ color: 'var(--color-text-muted)' }}>
                    このブラウザは通知に対応していません。
                </p>
            )}

            {blocked && (
                <p className="text-xs mt-3" style={{ color: 'var(--color-text-danger)' }}>
                    通知がブロックされています。ブラウザの設定でこのサイトの通知を許可してください。
                </p>
            )}

            {enabled && !disabled && (
                <>
                    <ul className="text-xs mt-3 flex flex-col gap-1" style={{ color: 'var(--color-text-muted)' }}>
                        <li>・期限の24時間前になったタスク</li>
                        <li>・指定時刻以降に未完了の習慣が残っているとき</li>
                    </ul>
                    <div className="mt-3 flex items-center justify-between gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
                        <label htmlFor="habit-reminder-hour" className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                            習慣リマインダー時刻
                        </label>
                        <select
                            id="habit-reminder-hour"
                            value={reminderHour}
                            onChange={(e) => setReminderHour(Number(e.target.value))}
                            className="px-2 py-1 rounded text-xs outline-none"
                            style={{ backgroundColor: 'var(--color-bg-card)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border-default)' }}
                        >
                            {Array.from({ length: 24 }, (_, h) => (
                                <option key={h} value={h}>{formatReminderHourLabel(h)}</option>
                            ))}
                        </select>
                    </div>
                    <p className="text-[10px] mt-2" style={{ color: 'var(--color-text-muted)' }}>
                        ※ アプリを開いている間に、{formatReminderHourLabel(reminderHour)}の未完了習慣を通知します
                    </p>
                </>
            )}
        </section>
    );
}
