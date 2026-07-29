import type { Auth, BetterAuthOptions } from "better-auth";
import type { createAuthMiddleware } from "better-auth/api";

/**
 * Any better-auth instance, regardless of plugin/options generics. Used
 * internally wherever the module must accept an instance it cannot know the
 * exact plugin surface of.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- deliberate: accepts any plugin configuration
export type AnyAuth = Auth<any>;

/**
 * Application-level type registry. Augment it once in your app and every
 * default-generic type in this package (`UserSession`, `AuthUser`,
 * `BetterAuthService`, ...) becomes plugin-aware without repeating generics:
 *
 * ```ts
 * declare module "@concepta/nestjs-better-auth" {
 *   interface BetterAuthTypeRegistry {
 *     auth: AppAuth;
 *   }
 * }
 * ```
 */
// oxlint-disable-next-line typescript/no-empty-interface
export interface BetterAuthTypeRegistry {}

/**
 * The auth type registered via {@link BetterAuthTypeRegistry}, falling back to
 * the plain `Auth` type when the registry has not been augmented.
 */
export type RegisteredAuth = BetterAuthTypeRegistry extends { auth: infer A extends AnyAuth }
	? A
	: Auth;

/**
 * Identity helper that preserves literal inference of `plugins` and friends,
 * so `InferAuth<typeof options>` resolves the full plugin-aware `Auth` type.
 */
export function defineBetterAuthOptions<const O extends BetterAuthOptions>(options: O): O {
	return options;
}

/** The `Auth` type that `betterAuth(options)` would return for `O`. */
export type InferAuth<O extends BetterAuthOptions> = Auth<O>;

/** The session payload (`{ user, session }`) as inferred from the auth instance. */
export type UserSession<TAuth extends AnyAuth = RegisteredAuth> = TAuth["$Infer"]["Session"];

/** The user model as inferred from the auth instance. */
export type AuthUser<TAuth extends AnyAuth = RegisteredAuth> = UserSession<TAuth>["user"];

/** The resolved better-auth `AuthContext` for the given auth instance. */
export type AuthContextOf<TAuth extends AnyAuth = RegisteredAuth> = Awaited<TAuth["$context"]>;

/**
 * The context object passed to `@BeforeHook`/`@AfterHook` methods — identical
 * to the context of better-auth's own `createAuthMiddleware`.
 */
export type AuthHookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];
