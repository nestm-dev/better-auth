import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";

export const auth = betterAuth({
	baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
	secret: process.env.BETTER_AUTH_SECRET ?? "example-secret-change-me-32-characters!",
	emailAndPassword: { enabled: true },
	// In-memory database — replace with a real adapter in production.
	plugins: [bearer()],
	telemetry: { enabled: false },
});
