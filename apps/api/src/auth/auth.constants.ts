export const SESSION_COOKIE = 'assetnest_session';
/** Absolute session lifetime; sliding renewal updates lastSeenAt, not expiry. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
/** Consecutive failures before the account locks. */
export const MAX_FAILED_ATTEMPTS = 5;
/** Lockout duration once MAX_FAILED_ATTEMPTS is reached. */
export const LOCKOUT_MINUTES = 15;
