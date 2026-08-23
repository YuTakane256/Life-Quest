import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const releaseIdentifier = 'com.yutakane.lifequest';
const parityIdentifier = 'com.yutakane.lifequest.parity';
const previewIdentifier = 'com.yutakane.lifequest.preview';
const releaseScheme = 'lifequest';
const parityScheme = 'lifequest-parity';
const previewScheme = 'lifequest-preview';
const forbiddenSecretPattern = /service_role|SUPABASE_SERVICE_ROLE|GOOGLE.*(?:CLIENT_)?SECRET|APPLE.*(?:PRIVATE_KEY|SECRET)|PRIVATE_KEY/i;

function fail(message) {
    throw new Error(`Mobile release configuration is invalid: ${message}`);
}

function readJson(relativePath) {
    return JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8'));
}

function assert(condition, message) {
    if (!condition) fail(message);
}

function containsServiceRoleJwt(value) {
    const payload = value.split('.')[1];
    if (!payload) return false;
    try {
        const decoded = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64url').toString('utf8');
        return JSON.parse(decoded).role === 'service_role';
    } catch {
        return false;
    }
}

function validatePublicEnvironment(environment) {
    for (const [name, value] of Object.entries(environment)) {
        if (!name.startsWith('EXPO_PUBLIC_') || typeof value !== 'string') continue;
        assert(!/sb_secret_/i.test(value), `${name} must not contain an sb_secret_* key`);
        assert(!containsServiceRoleJwt(value), `${name} must not contain a JWT with role=service_role`);
    }
}

function expoPublicConfig(variant) {
    const output = execFileSync(
        'npm',
        ['exec', '--workspace', '@life-quest/mobile', 'expo', 'config', '--', '--type', 'public', '--json'],
        {
            cwd: root,
            env: { ...process.env, LIFE_QUEST_APP_VARIANT: variant },
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    );
    return JSON.parse(output);
}

function validateProfile(profiles, name, expectedVariant) {
    const profile = profiles[name];
    assert(profile, `missing ${name} EAS build profile`);
    assert(profile.environment === name, `${name} must use the ${name} EAS environment`);
    assert(profile.env?.LIFE_QUEST_APP_VARIANT === expectedVariant, `${name} must set LIFE_QUEST_APP_VARIANT=${expectedVariant}`);
}

function validatePublicConfig(config, variant, expectedIdentifier, expectedScheme) {
    assert(config.ios?.bundleIdentifier === expectedIdentifier, `${variant} iOS bundle identifier must be ${expectedIdentifier}`);
    assert(config.android?.package === expectedIdentifier, `${variant} Android package must be ${expectedIdentifier}`);
    assert(config.extra?.appVariant === variant, `${variant} public config must expose its app variant`);
    assert(config.scheme === expectedScheme, `${variant} OAuth scheme must be ${expectedScheme}`);
    assert(!forbiddenSecretPattern.test(JSON.stringify(config)), `${variant} public Expo config contains a secret-like value`);
}

const eas = readJson('apps/mobile/eas.json');
const profiles = eas.build;
const appConfigSource = readFileSync(new URL('../apps/mobile/app.config.ts', import.meta.url), 'utf8');

validatePublicEnvironment(process.env);
assert(!JSON.stringify(eas).match(/(?:projectId|owner|credentialsSource|clientSecret|service_role)/i), 'eas.json must not contain project, credential, or secret placeholders');
assert(eas.cli?.appVersionSource === 'remote', 'EAS must manage build-number increments remotely');
validateProfile(profiles, 'development', 'parity');
validateProfile(profiles, 'preview', 'preview');
validateProfile(profiles, 'production', 'release');
assert(profiles.development.developmentClient === true, 'development must enable a development client');
assert(profiles.development.distribution === 'internal', 'development must use internal distribution');
assert(profiles.preview.distribution === 'internal', 'preview must use internal distribution');
assert(profiles.preview.autoIncrement === true, 'preview must auto-increment build numbers');
assert(profiles.production.autoIncrement === true, 'production must auto-increment build numbers');
assert(appConfigSource.includes("'expo-web-browser'"), 'expo-web-browser plugin must be retained for OAuth callbacks');

validatePublicConfig(expoPublicConfig('release'), 'release', releaseIdentifier, releaseScheme);
validatePublicConfig(expoPublicConfig('parity'), 'parity', parityIdentifier, parityScheme);
validatePublicConfig(expoPublicConfig('preview'), 'preview', previewIdentifier, previewScheme);

console.log('Mobile release configuration is valid.');
