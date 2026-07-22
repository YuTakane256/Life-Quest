/**
 * 設定（テーマ・モーション・通知）のクラウド同期。
 *
 * 設定は3つの独立したZustandストア（useThemeStore/useMotionStore/
 * useNotificationStore）に分散しているが、user_settings.settingsはjsonb
 * 1列の絶対値書き込み（`upsert_user_settings`、update_character_profile等と
 * 同じ設計）のため、どれか1つが変わっても4項目全部を集約して送る必要がある。
 *
 * `notifiedTaskIds`/`lastHabitReminderDate`はデバイスローカルの重複通知防止
 * 状態のため、明示的にallowlistから除外する（丸ごと展開しない）。
 *
 * 各ストアのset系アクションから直接呼ぶ設計（`useTitleStore.setActiveTitle`
 * と同じ「アクション内でenqueueする」規約）。クラウドpullでの適用は
 * `setState`を直接使いこれらのアクションを経由しないため、シード→再送信の
 * フィードバックループは起きない（`seedTasks`等の既存パターンと同じ）。
 *
 * このモジュールと3ストアは循環importになっている（意図的）。安全に成立する
 * 不変条件: (1) この2関数はexport function宣言のまま保つ（巻き上げされるため
 * 循環中の参照でもTDZ/undefinedにならない。export constのアロー関数へ変えない
 * こと）、(2) ストア側の値を読むのは関数本体の中だけにする（モジュール
 * トップレベルやストア定義中に`useThemeStore.getState()`等を呼ばない）。
 */
import { useThemeStore } from '../stores/useThemeStore';
import { useMotionStore } from '../stores/useMotionStore';
import { useNotificationStore } from '../stores/useNotificationStore';
import { enqueueCloudOperation } from './cloudOutbox';

export function buildSyncedSettingsPayload(): Record<string, unknown> {
    return {
        themeMode: useThemeStore.getState().mode,
        motionMode: useMotionStore.getState().mode,
        notificationsEnabled: useNotificationStore.getState().enabled,
        habitReminderHour: useNotificationStore.getState().habitReminderHour,
    };
}

/** いずれかの設定ストアのset系アクションから呼ぶ。4項目全部を集約してenqueueする。 */
export function syncSettingsToCloud(): void {
    void enqueueCloudOperation('upsert_user_settings', {
        p_settings: buildSyncedSettingsPayload(),
        p_base_version: null,
    });
}
