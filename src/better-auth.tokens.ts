/**
 * Injection token for the live better-auth instance (`Auth`), whether it was
 * passed pre-built (`forRoot({ auth })`) or created internally from raw
 * options (`forRoot({ options })`).
 */
export const BETTER_AUTH_INSTANCE = Symbol("BETTER_AUTH_INSTANCE");

/**
 * Injection token for the module options object (extras stripped), exactly as
 * resolved from `forRoot`/`forRootAsync`.
 */
export const BETTER_AUTH_MODULE_OPTIONS = Symbol("BETTER_AUTH_MODULE_OPTIONS");

/**
 * Injection token for the resolved base path string the better-auth handler is
 * mounted at (e.g. `/api/auth`).
 */
export const BETTER_AUTH_BASE_PATH = Symbol("BETTER_AUTH_BASE_PATH");
