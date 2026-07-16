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
    getSeedableSections,
    type CloudCache,
} from '@life-quest/core/cloudCache';
import { seedSectionData } from './canonicalSync';
import { useMobileStatsStore } from '../stores/useMobileStatsStore';

/** クラウドが正と言えるセクションだけをストアへ反映する。1つ以上シードしたらtrue。 */
export function applyCloudCacheToMobileStores(cache: CloudCache): boolean {
    const seedable = getSeedableSections(cache);
    let seeded = false;
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
            seedSectionData('game', game);
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
    return seeded;
}
