export function formatHourLabel(hour: number): string {
    const safeHour = Number.isFinite(hour) ? Math.max(0, Math.min(23, Math.floor(hour))) : 0;
    return `${safeHour.toString().padStart(2, '0')}:00`;
}

export function formatReminderHourLabel(hour: number): string {
    return `${formatHourLabel(hour)}以降`;
}
