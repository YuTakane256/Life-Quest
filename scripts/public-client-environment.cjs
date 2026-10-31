/** Build-time checks only; this module must never be imported by application code. */
function containsServiceRoleJwt(value) {
    const payload = value.split('.')[1];
    if (!payload) return false;
    try {
        return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role === 'service_role';
    } catch {
        return false;
    }
}

/** Static classification, not JWT signature validation. Never return the matched value. */
function containsServerCredential(content) {
    if (/sb_secret_[A-Za-z0-9_-]+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) return true;
    for (const match of content.matchAll(/\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+\b/g)) {
        if (containsServiceRoleJwt(match[0])) return true;
    }
    return false;
}

function assertPublicMobileEnvironment(environment) {
    for (const [name, value] of Object.entries(environment)) {
        if (!name.startsWith('EXPO_PUBLIC_') || typeof value !== 'string') continue;
        // Keep the release validator's conservative prefix/payload checks, plus private keys.
        if (/sb_secret_/i.test(value) || containsServiceRoleJwt(value) || containsServerCredential(value)) {
            throw new Error('Public mobile environment contains a server-only credential: sb_secret_*, JWT role=service_role or private key (value hidden).');
        }
    }
}

exports.containsServerCredential = containsServerCredential;
exports.assertPublicMobileEnvironment = assertPublicMobileEnvironment;
