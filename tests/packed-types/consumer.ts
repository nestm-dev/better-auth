import { BetterAuthModule } from "@nestm/better-auth";

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

export { asynchronousModule, synchronousModule };
