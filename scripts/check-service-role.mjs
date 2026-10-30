/**
 * service role キーがクライアントコードへ混入していないことを検査する（ADR-007）。
 *
 * service_role はEdge Function実行環境・CIのシークレットにのみ存在してよい。
 * クライアントバンドルに含まれるソース（Web src/、Mobile apps/mobile/、共有 packages/）に
 * `service_role` への参照や、Apple/Supabaseのサーバー専用秘密値参照が現れたら失敗させる。
 * サーバー専用コード（supabase/functions/）とこのスクリプト自身、ドキュメントは対象外。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const TARGET_DIRS = ['src', 'apps/mobile/src', 'apps/mobile/app', 'packages'];
const TARGET_CONFIGS = ['apps/mobile/app.config.ts', 'apps/mobile/app.json', 'apps/mobile/eas.json'];
const IGNORED_DIR_NAMES = new Set(['node_modules', 'dist', '.expo', 'coverage']);
const TARGET_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json']);
const PATTERN = /service_role|SERVICE_ROLE|APPLE_(?:PRIVATE_KEY|TEAM_ID|KEY_ID|(?:WEB_)?CLIENT_IDS?|TOKEN_ENCRYPTION_KEY)/;

/** Static credential detection only; never return/log the matched credential. */
export function containsServerCredential(content) {
    if (/sb_secret_[A-Za-z0-9_-]+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) return true;
    for (const match of content.matchAll(/\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+\b/g)) {
        try {
            if (JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')).role === 'service_role') return true;
        } catch { /* Non-JWT source text is not a credential. */ }
    }
    return false;
}

export function findClientSecretViolations(content, file) {
    return content.split('\n').flatMap((line, index) => PATTERN.test(line) || containsServerCredential(line)
        ? [`${file}:${index + 1}: server-only reference or credential (value hidden)`] : []);
}

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

export function checkClientSecrets(root = process.cwd(), output = console) {
    const files = [];
    for (const dir of TARGET_DIRS) {
        const abs = join(root, dir);
        try { statSync(abs); } catch { continue; }
        files.push(...walk(abs));
    }
    for (const config of TARGET_CONFIGS) {
        const abs = join(root, config);
        try { statSync(abs); } catch { continue; }
        files.push(abs);
    }
    const violations = files.flatMap((file) => findClientSecretViolations(readFileSync(file, 'utf8'), relative(root, file)));
    if (violations.length) {
        output.error('Server-only credentials/references found in client inputs (values hidden):');
        violations.forEach((violation) => output.error(`  ${violation}`));
        return 1;
    }
    output.log('check:secrets OK — クライアント入力にサーバー専用秘密値は検出されませんでした');
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = checkClientSecrets();
