import { buildStatements, sync, type Op } from "./db";
import { Notifier } from "./notifier";

export { Notifier };

/**
 * wrangler.json で設定するもの
 * - DB:       D1（データ本体）
 * - PHOTOS:   R2（写真）
 * - NOTIFIER: Durable Object（リアルタイム通知）
 * - PORTAL_PASSCODE: 合言葉（任意・secret）  npx wrangler secret put PORTAL_PASSCODE
 */
interface AppEnv {
	DB: D1Database;
	PHOTOS: R2Bucket;
	NOTIFIER: DurableObjectNamespace<Notifier>;
	PORTAL_PASSCODE?: string;
}

const PHOTO_ID = /^[A-Za-z0-9_-]{1,80}$/;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTO = 3 * 1024 * 1024;

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

const notifier = (env: AppEnv) => env.NOTIFIER.get(env.NOTIFIER.idFromName("main"));

export default {
	async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		if (!path.startsWith("/api/")) return new Response("Not found", { status: 404 });

		// 写真の表示は合言葉なし（IDは推測できない乱数）。それ以外は合言葉が必要
		const photo = path.match(/^\/api\/photo\/([^/]+)$/);
		const publicRead = photo && request.method === "GET";
		if (env.PORTAL_PASSCODE && !publicRead) {
			const given = request.headers.get("X-Portal-Pass") ?? url.searchParams.get("pass") ?? "";
			if (given !== env.PORTAL_PASSCODE) return json({ error: "passcode" }, 401);
		}

		try {
			// ---- 差分同期 ----
			if (path === "/api/sync" && request.method === "GET") {
				const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
				return json(await sync(env.DB, since, url.searchParams.get("me")));
			}

			// ---- 変更 ----
			if (path === "/api/ops" && request.method === "POST") {
				const body = (await request.json().catch(() => null)) as { ops?: Op[] } | null;
				if (!body || !Array.isArray(body.ops)) return json({ error: "bad request" }, 400);
				const now = Date.now();
				const stmts = buildStatements(env.DB, body.ops, now);
				// D1 の batch は1回のトランザクション。大きすぎる場合は分ける
				for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
				if (stmts.length) ctx.waitUntil(notifier(env).fetch("https://notifier/notify", { method: "POST", body: JSON.stringify({ type: "changed", at: now }) }));
				return json({ ok: true, now });
			}

			// ---- リアルタイム通知（WebSocket） ----
			if (path === "/api/ws") {
				return notifier(env).fetch(new Request("https://notifier/ws", request));
			}

			// ---- 写真（R2） ----
			if (photo) {
				const id = photo[1];
				if (!PHOTO_ID.test(id)) return json({ error: "bad id" }, 400);
				const key = "photos/" + id;
				if (request.method === "GET") {
					const obj = await env.PHOTOS.get(key);
					if (!obj) return new Response("Not found", { status: 404 });
					return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType ?? "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable", ETag: obj.httpEtag } });
				}
				if (request.method === "PUT") {
					const type = (request.headers.get("Content-Type") ?? "").split(";")[0].trim();
					if (!PHOTO_TYPES.has(type)) return json({ error: "画像は JPEG / PNG / WebP のみです" }, 415);
					const buf = await request.arrayBuffer();
					if (buf.byteLength === 0 || buf.byteLength > MAX_PHOTO) return json({ error: "画像が大きすぎます" }, 413);
					await env.PHOTOS.put(key, buf, { httpMetadata: { contentType: type } });
					return json({ ok: true });
				}
				if (request.method === "DELETE") {
					await env.PHOTOS.delete(key);
					return json({ ok: true });
				}
			}

			if (path === "/api/ping") return json({ ok: true, now: Date.now() });
			return json({ error: "not found" }, 404);
		} catch (e) {
			console.error(e);
			return json({ error: "server error" }, 500);
		}
	},
} satisfies ExportedHandler<AppEnv>;
