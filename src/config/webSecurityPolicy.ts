/** Effective response policy; frame-ancestors and permissions cannot use HTML meta. */
export const WEB_RESPONSE_SECURITY_HEADERS = {
    'Content-Security-Policy': "frame-ancestors 'none'",
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=(), clipboard-write=(self)',
} as const;
