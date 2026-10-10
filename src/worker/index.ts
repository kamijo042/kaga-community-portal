import { handleAdmin, handleAuth, handleFamily } from "./accounts";
import { currentSession } from "./auth";
import { authorize, buildStatements, sync, type Op } from "./db";
import { Notifier } from "./notifier";

export { Notifier };

/**
 * wrangler.json で設定するもの
 * - DB:       D1（データ本体・アカウント）
 * - PHOTOS:   R2（写真）
 * - AUTH:     KV（ログイン状態・ログイン失敗の回数）
 * - NOTIFIER: Durable Object（リアルタイム通知）
 * - ADMIN_SETUP_CODE: 最初の管理者を作るときの合言葉（secret）
 */
interface AppEnv {
	DB: D1Database;
	PHOTOS: R2Bucket;
	AUTH: KVNamespace;
	NOTIFIER: DurableObjectNamespace<Notifier>;
	ADMIN_SETUP_CODE?: string;
}

const PHOTO_ID = /^[A-Za-z0-9_-]{1,80}$/;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTO = 3 * 1024 * 1024;

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

const notifier = (env: AppEnv) => env.NOTIFIER.get(env.NOTIFIER.idFromName("main"));
const notify = (env: AppEnv, ctx: ExecutionContext, at: number) =>
	ctx.waitUntil(notifier(env).fetch("https://notifier/notify", { method: "POST", body: JSON.stringify({ type: "changed", at }) }));

/** 別サイトからの書き込み（CSRF）を防ぐ：Origin が自分と違えば拒否 */
function sameOrigin(request: Request, url: URL) {
	const origin = request.headers.get("Origin");
	return !origin || origin === url.origin;
}

export default {
	async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		if (!path.startsWith("/api/")) return new Response("Not found", { status: 404 });
		if (request.method !== "GET" && !sameOrigin(request, url)) return json({ error: "forbidden" }, 403);

		try {
			// ---- ログイン関連（ログイン前でも使える） ----
			if (path.startsWith("/api/auth/")) {
				const r = await handleAuth(request, env, url);
				if (r) {
					// 新しい世帯ができたときなどに全員の画面を更新
					if (request.method === "POST" && r.ok && /\/(setup|accept)$/.test(path)) notify(env, ctx, Date.now());
					return r;
				}
				return json({ error: "not found" }, 404);
			}
			if (path === "/api/ping") return json({ ok: true, now: Date.now() });

			// ---- ここから先はログインが必要 ----
			const s = await currentSession(env, request);
			if (!s) return json({ error: "login" }, 401);

			const managed = (await handleAdmin(request, env, url, s)) ?? (await handleFamily(request, env, url, s));
			if (managed) {
				if (request.method === "POST" && managed.ok) notify(env, ctx, Date.now());
				return managed;
			}

			// 差分同期（相談・既読はログイン中の人の分だけ）
			if (path === "/api/sync" && request.method === "GET") {
				const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
				return json(await sync(env.DB, since, s.userId));
			}

			// 変更
			if (path === "/api/ops" && request.method === "POST") {
				const body = (await request.json().catch(() => null)) as { ops?: Op[] } | null;
				if (!body || !Array.isArray(body.ops)) return json({ error: "bad request" }, 400);
				const now = Date.now();
				const allowed = await authorize(env.DB, body.ops.slice(0, 200), s);
				const stmts = buildStatements(env.DB, allowed, now);
				for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
				if (stmts.length) notify(env, ctx, now);
				return json({ ok: true, now, rejected: body.ops.length - allowed.length });
			}

			// リアルタイム通知（WebSocket）
			if (path === "/api/ws") {
				return notifier(env).fetch(new Request("https://notifier/ws", request));
			}

			// 写真（R2）。表示はログイン中なら誰でも、削除はアップロードした人か管理者だけ
			const photo = path.match(/^\/api\/photo\/([^/]+)$/);
			if (photo) {
				const id = photo[1];
				if (!PHOTO_ID.test(id)) return json({ error: "bad id" }, 400);
				const key = "photos/" + id;
				if (request.method === "GET") {
					const obj = await env.PHOTOS.get(key);
					if (!obj) return new Response("Not found", { status: 404 });
					return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType ?? "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable", ETag: obj.httpEtag } });
				}
				if (request.method === "PUT") {
					const type = (request.headers.get("Content-Type") ?? "").split(";")[0].trim();
					if (!PHOTO_TYPES.has(type)) return json({ error: "画像は JPEG / PNG / WebP のみです" }, 415);
					const buf = await request.arrayBuffer();
					if (buf.byteLength === 0 || buf.byteLength > MAX_PHOTO) return json({ error: "画像が大きすぎます" }, 413);
					if (await env.PHOTOS.head(key)) return json({ error: "exists" }, 409);
					await env.PHOTOS.put(key, buf, { httpMetadata: { contentType: type }, customMetadata: { owner: s.userId } });
					return json({ ok: true });
				}
				if (request.method === "DELETE") {
					const head = await env.PHOTOS.head(key);
					if (head && (head.customMetadata?.owner === s.userId || s.role === "admin")) await env.PHOTOS.delete(key);
					return json({ ok: true });
				}
			}

			return json({ error: "not found" }, 404);
		} catch (e) {
			console.error(e);
			return json({ error: "server error" }, 500);
		}
	},
} satisfies ExportedHandler<AppEnv>;
