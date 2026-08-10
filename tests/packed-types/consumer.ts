import {
	BetterAuthGuard,
	BetterAuthModule,
	type AnyAuth,
	type BetterAuthInteropOptions,
} from "@nestm/better-auth";
import { typeormAdapter, type TypeormAdapterConfig } from "@nestm/better-auth/typeorm";
import type { Reflector } from "@nestjs/core";
import type { DataSource, EntityManager } from "typeorm";

declare const reflector: Reflector;
declare const auth: AnyAuth;
declare const dataSource: DataSource;
declare const scopedManager: EntityManager | undefined;

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

// The `./typeorm` subpath ships its own entry, so it needs its own coverage here: without a
// consumer import it would be published untested against its rolled-up declarations.
const typeormConfig: TypeormAdapterConfig = {
	entities: { rateLimit: "RateLimit" },
	getManager: () => scopedManager,
	transaction: true,
};
const databaseAdapter = typeormAdapter(dataSource, typeormConfig);
const defaultedAdapter = typeormAdapter(dataSource);

const moduleWithTypeormDatabase = BetterAuthModule.forRoot({
	options: { database: databaseAdapter },
});

export {
	asynchronousModule,
	databaseAdapter,
	defaultedAdapter,
	interop,
	manuallyConstructedGuard,
	moduleWithTypeormDatabase,
	synchronousModule,
};
