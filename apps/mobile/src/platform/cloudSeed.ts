import { battleResultRecovery } from './battleResultRecovery';
/**
 * クラウドキャッシュのMobileストア反映（#504）。
 * cloudSync.tsから分離しているのは、react-native（AppState）を importする
 * モジュールをユニットテストが読み込めないため。
 *
 * #506の移行前は初期行しか無いため、セクション単位で「クラウドが正か」を
 * 判定してからシードする（既存ローカルデータの消去防止）。
 */
import {
    buildCanonicalGameSnapshot,
    buildCanonicalHabitSnapshot,
    buildCanonicalTaskSnapshot,
    buildStatsLogSnapshot,
    extractSyncedSettings,
    extractSyncedTitle,
    getSeedableSections,
    type CloudCache,
} from '@life-quest/core/cloudCache';
import { captureAuthSessionScope } from '@life-quest/core/authLifecycle';
import { useMobileGameStore } from '../stores/useMobileGameStore';
import { resolveHabitReminderHour } from '@life-quest/core/notifications';
import { seedSectionData } from './canonicalSync';
import { useMobileStatsStore } from '../stores/useMobileStatsStore';
import { sanitizeActiveTitle, useMobileTitleStore } from '../stores/useMobileTitleStore';
import {
    sanitizeMobileMotionMode,
    sanitizeMobileThemeMode,
    useMobileSettingsStore,
} from '../stores/useMobileSettingsStore';

/** クラウドが正と言えるセクションだけをストアへ反映する。1つ以上シードしたらtrue。 */
export function applyCloudCacheToMobileStores(cache: CloudCache): boolean {
    const seedScope = captureAuthSessionScope();
    const seedable = getSeedableSections(cache);
    let seeded = false;
    let confirmedBattleAttempt: string | undefined;
    if (seedable.tasks) {
        seedSectionData('tasks', buildCanonicalTaskSnapshot(cache));
        seeded = true;
    }
    if (seedable.habits) {
        seedSectionData('habits', buildCanonicalHabitSnapshot(cache));
        seeded = true;
    }
    if (seedable.game) {
        const game = buildCanonicalGameSnapshot(cache);
        if (game) {
            const scope = captureAuthSessionScope();
            const battle = useMobileGameStore.getState().activeBattle;
            const attempt = battle?.battleAttemptId ? cache.battle_attempts[battle.battleAttemptId] : undefined;
            // Use the same character row as buildCanonicalGameSnapshot. The resolve RPC
            // commits a victory's character XP and resolved attempt at the same version.
            // Defeat changes only the attempt; the character can remain older.
            const character = Object.values(cache.characters)[0];
            const confirmed = battle?.rewardMode === 'cloud'
                && (battle.state.outcome === 'victory' || battle.state.outcome === 'defeat')
                && attempt?.id === battle.battleAttemptId && attempt.status === 'resolved'
                && attempt.stage === battle.stage && attempt.outcome === battle.state.outcome
                && scope.userId !== null && attempt.user_id === scope.userId && character?.user_id === scope.userId
                && Number.isSafeInteger(attempt.version) && attempt.version > 0
                && Number.isSafeInteger(character.version) && character.version > 0
                && (battle.state.outcome === 'defeat' || character.version >= attempt.version);
            seedSectionData('game', game);
            const current = useMobileGameStore.getState().activeBattle;
            if (confirmed && scope.isCurrent() && current?.actors === battle.actors
                && current.battleAttemptId === battle.battleAttemptId && current.stage === battle.stage
                && current.rewardMode === 'cloud' && current.state.outcome === battle.state.outcome) {
                // XP/progress came from the authoritative snapshot; never add them again
                // when the original granted:true response arrives later.
                confirmedBattleAttempt = battle.battleAttemptId ?? undefined;
                useMobileGameStore.setState({ activeBattle: { ...current, battleAttemptId: null } });
            }
            seeded = true;
        }
    }
    // 統計ログはtasks/habitsのようなクラウド優先シードではなく単調マージ（削除済みデータの
    // 実績を後退させない）。新規端末インストール直後、ローカルコレクションが空の状態で
    // statsLogSeed.tsのseedIfNeededが先に空ログを永続化してしまっても、
    // このマージによって以後のプルで正しく復元される。
    if (Object.keys(cache.stats_daily).length > 0) {
        useMobileStatsStore.getState().mergeFromCloud(buildStatsLogSnapshot(cache));
    }
    if (seedable.settings) {
        const settings = seedScope.userId === null ? null : extractSyncedSettings(cache, seedScope.userId);
        if (settings && seedScope.isCurrent()) {
            // setState直接呼び出し（set系アクション経由ではない）ため、
            // ストア内のsyncSettingsToCloudへの再送信は起きない。
            // notifiedTaskIds/lastHabitReminderDateはここで一切触れない。
            useMobileSettingsStore.setState({
                themeMode: sanitizeMobileThemeMode(settings.themeMode),
                motionMode: sanitizeMobileMotionMode(settings.motionMode),
                notificationsEnabled: settings.notificationsEnabled === true,
                habitReminderHour: resolveHabitReminderHour(settings.habitReminderHour),
            });
            seeded = true;
        }
    }
    const title = seedScope.userId === null ? null : extractSyncedTitle(cache, seedScope.userId);
    if (title && seedScope.isCurrent() && useMobileTitleStore.persist.hasHydrated()) {
        const activeTitle = sanitizeActiveTitle(title.activeTitle);
        if (useMobileTitleStore.getState().activeTitle !== activeTitle) useMobileTitleStore.setState({ activeTitle });
        seeded = true;
    }
    if (seedScope.isCurrent()) void battleResultRecovery.reconcile(cache, seedScope, confirmedBattleAttempt).catch(() => {});
    return seeded;
}
