import { PortalHub } from "./hub";

export { PortalHub };

/** wrangler.json で設定する値（npm run cf-typegen で Env 型を作り直すこともできます） */
interface AppEnv {
	PORTAL: DurableObjectNamespace<PortalHub>;
	/** 合言葉（任意）。設定すると、合言葉を入れた人だけが使えます: npx wrangler secret put PORTAL_PASSCODE */
	PORTAL_PASSCODE?: string;
}

export default {
	async fetch(request: Request, env: AppEnv): Promise<Response> {
		const url = new URL(request.url);
		if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });

		if (env.PORTAL_PASSCODE) {
			const given = request.headers.get("X-Portal-Pass") ?? url.searchParams.get("pass") ?? "";
			if (given !== env.PORTAL_PASSCODE) {
				return new Response(JSON.stringify({ error: "passcode" }), { status: 401, headers: { "Content-Type": "application/json" } });
			}
		}
		// すべてのデータは1つの Durable Object（"main"）に集める
		const stub = env.PORTAL.get(env.PORTAL.idFromName("main"));
		return stub.fetch(request);
	},
} satisfies ExportedHandler<AppEnv>;
