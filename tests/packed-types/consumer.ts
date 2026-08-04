import {
	BetterAuthGuard,
	BetterAuthModule,
	type AnyAuth,
	type BetterAuthInteropOptions,
} from "@nestm/better-auth";
import type { Reflector } from "@nestjs/core";

declare const reflector: Reflector;
declare const auth: AnyAuth;

// Patch releases must preserve the guard's original two-argument constructor.
const manuallyConstructedGuard = new BetterAuthGuard(reflector, auth);
const interop: BetterAuthInteropOptions = { publicKeys: ["legacy:public", Symbol()] };

const synchronousModule = BetterAuthModule.forRoot({
	options: {
		emailAndPassword: { enabled: true },
	},
	disableGlobalGuard: true,
});

const asynchronousModule = BetterAuthModule.forRootAsync({
	isGlobal: false,
	inject: ["AUTH_BASE_URL"],
	useFactory: (baseURL: string) => ({
		options: { baseURL },
	}),
});

export { asynchronousModule, interop, manuallyConstructedGuard, synchronousModule };
