/**
 * service role キーがクライアントコードへ混入していないことを検査する（ADR-007）。
 *
 * service_role はEdge Function実行環境・CIのシークレットにのみ存在してよい。
 * クライアントバンドルに含まれるソース（Web src/、Mobile apps/mobile/、共有 packages/）に
 * `service_role` への参照や SUPABASE_SERVICE_ROLE 系の環境変数参照が現れたら失敗させる。
 * サーバー専用コード（supabase/functions/）とこのスクリプト自身、ドキュメントは対象外。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const TARGET_DIRS = ['src', 'apps/mobile/src', 'apps/mobile/app', 'packages'];
const IGNORED_DIR_NAMES = new Set(['node_modules', 'dist', '.expo', 'coverage']);
const TARGET_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']);
const PATTERN = /service_role|SERVICE_ROLE/;

function* walk(dir) {
    for (const entry of readdirSync(dir)) {
        if (IGNORED_DIR_NAMES.has(entry)) continue;
        const full = join(dir, entry);
        const stats = statSync(full);
        if (stats.isDirectory()) {
            yield* walk(full);
        } else if (TARGET_EXTENSIONS.has(entry.slice(entry.lastIndexOf('.')))) {
            yield full;
        }
    }
}

const violations = [];
for (const dir of TARGET_DIRS) {
    const abs = join(ROOT, dir);
    let exists = true;
    try {
        statSync(abs);
    } catch {
        exists = false;
    }
    if (!exists) continue;
    for (const file of walk(abs)) {
        const content = readFileSync(file, 'utf8');
        if (PATTERN.test(content)) {
            const lines = content.split('\n');
            lines.forEach((line, index) => {
                if (PATTERN.test(line)) {
                    violations.push(`${relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
                }
            });
        }
    }
}

if (violations.length > 0) {
    console.error('service_role への参照がクライアントコードに見つかりました (ADR-007 違反):');
    for (const violation of violations) console.error(`  ${violation}`);
    process.exit(1);
}
console.log('check:secrets OK — クライアントコードに service_role の参照はありません');
