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
    getSeedableSections,
    type CloudCache,
} from '@life-quest/core/cloudCache';
import { seedSectionData } from './canonicalSync';

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
    return seeded;
}
