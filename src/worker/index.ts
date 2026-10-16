import { handleAdmin, handleAuth, handleFamily, handleInvites } from "./accounts";
import { currentSession, edgeAllow, rateAdd, rateLimit, type Limiter } from "./auth";
import { authorize, buildStatements, sync, type Op } from "./db";
import { NOTIFY_OK, Notifier } from "./notifier";
import { handlePostPublic, handlePublic, servePublicPage } from "./public";

export { Notifier };

/**
 * wrangler.json で設定するもの
 * - DB:       D1（データ本体・アカウント）
 * - PHOTOS:   R2（写真）
 * - AUTH:     KV（ログイン状態・ログイン失敗の回数）
 * - NOTIFIER: Durable Object（リアルタイム通知）
 * - RL_AUTH / RL_AUTH_ALL / RL_USER: Rate Limiting（メモリ上の回数制限。D1 の無料枠を守る）
 * - ADMIN_SETUP_CODE: 最初の管理者を作るときの合言葉（secret）
 * - PASSWORD_PEPPER:  パスワードに混ぜる秘密の値（secret。一度決めたら変えない）
 */
interface AppEnv {
	DB: D1Database;
	PHOTOS: R2Bucket;
	AUTH: KVNamespace;
	NOTIFIER: DurableObjectNamespace<Notifier>;
	ADMIN_SETUP_CODE?: string;
	PASSWORD_PEPPER?: string;
	RL_AUTH?: Limiter;
	RL_AUTH_ALL?: Limiter;
	RL_USER?: Limiter;
	ASSETS?: Fetcher;
}

/**
 * 無料枠（D1：1日 読み取り500万行・書き込み10万行）を1人で使い切らせないための上限
 * - 1回の変更送信に入れられる操作の数
 * - 1人が1日に D1 へ書ける文の数
 * - 全件に近い読み直し（6時間より前から／初回）の1日の回数
 */
const OPS_PER_REQUEST = 100;
const WRITES_PER_DAY = 3000;
const HEAVY_SYNC_PER_DAY = 60;
const HEAVY_SYNC_AGE = 6 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60;
const BUSY = "操作が多すぎます。少し時間をおいてから試してください。";

const PHOTO_ID = /^[A-Za-z0-9_-]{1,80}$/;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTO = 3 * 1024 * 1024;

const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
			"X-Frame-Options": "DENY",
			"Referrer-Policy": "no-referrer",
			"Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
		},
	});

const notifier = (env: AppEnv) => env.NOTIFIER.get(env.NOTIFIER.idFromName("main"));
const notify = (env: AppEnv, ctx: ExecutionContext, at: number) =>
	ctx.waitUntil(notifier(env).fetch("https://notifier/notify", { method: "POST", headers: { "X-Kaga-Notify": NOTIFY_OK }, body: JSON.stringify({ type: "changed", at }) }));

/** 別サイトからの書き込み（CSRF）を防ぐ。Origin が無いリクエストも拒否する */
function sameOrigin(request: Request, url: URL) {
	return request.headers.get("Origin") === url.origin;
}

/** 中身の先頭バイトで JPEG / PNG / WebP かを決める。Content-Type ヘッダーは信用しない */
function sniffImage(buf: ArrayBuffer): "image/jpeg" | "image/png" | "image/webp" | null {
	const b = new Uint8Array(buf);
	if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
	if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
	if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
	return null;
}

export default {
	async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		// 会員以外も参加登録できるイベントの公開ページ（リンクのプレビュー用にタイトルと説明を入れて返す）
		if (path.startsWith("/e/")) return (await servePublicPage(request, env, url)) ?? new Response("Not found", { status: 404 });
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
			// 公開イベント（ログイン不要）：タイトルと説明の表示、会員以外の参加登録
			if (path.startsWith("/api/public/")) {
				const r = (await handlePublic(request, env, url)) as Response;
				if (request.method === "POST" && r.ok) notify(env, ctx, Date.now());
				return r;
			}

			// ---- ここから先はログインが必要 ----
			const s = await currentSession(env, request);
			if (!s) return json({ error: "login" }, 401);

			const managed = (await handleAdmin(request, env, url, s)) ?? (await handleFamily(request, env, url, s)) ?? (await handleInvites(request, env, url, s)) ?? (await handlePostPublic(request, env, url, s));
			if (managed) {
				if (request.method === "POST" && managed.ok && !managed.headers.has("X-Kaga-Dry-Run")) notify(env, ctx, Date.now());
				return managed;
			}

			// 差分同期（相談・既読はログイン中の人の分だけ）
			if (path === "/api/sync" && request.method === "GET") {
				const rawSince = Number(url.searchParams.get("since"));
				const since = Number.isFinite(rawSince) ? Math.max(0, rawSince) : 0;
				if (!(await edgeAllow(env.RL_USER, "sync:" + s.userId))) return json({ error: BUSY }, 429);
				// 全件に近い読み直しは重いので、1日の回数を D1 で数える
				if (since < Date.now() - HEAVY_SYNC_AGE && (await rateLimit(env, "heavy:" + s.userId, HEAVY_SYNC_PER_DAY, DAY))) {
					return json({ error: "読み込みが多すぎます。明日まで待つか、運営に連絡してください。" }, 429);
				}
				return json(await sync(env.DB, since, s.userId, s.householdId, s.role === "admin"));
			}

			// 変更
			if (path === "/api/ops" && request.method === "POST") {
				if (!(await edgeAllow(env.RL_USER, "ops:" + s.userId))) return json({ error: BUSY }, 429);
				const raw = await request.text();
				if (raw.length > 300_000) return json({ error: "送信データが大きすぎます" }, 413);
				let body: { ops?: Op[] } | null = null;
				try { body = JSON.parse(raw) as { ops?: Op[] }; } catch { body = null; }
				if (!body || !Array.isArray(body.ops)) return json({ error: "bad request" }, 400);
				if (body.ops.length > OPS_PER_REQUEST) return json({ error: "一度に送る変更が多すぎます" }, 413);
				const now = Date.now();
				const allowed = await authorize(env.DB, body.ops, s);
				const stmts = buildStatements(env.DB, allowed, now);
				// 1人が1日に書ける量の上限（書く前に数える）
				if (stmts.length && (await rateAdd(env, "writes:" + s.userId, stmts.length, DAY)) > WRITES_PER_DAY) {
					return json({ error: "今日の書き込みの上限に達しました。明日また試してください。" }, 429);
				}
				for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
				if (stmts.length) notify(env, ctx, now);
				return json({ ok: true, now, rejected: body.ops.length - allowed.length });
			}

			// リアルタイム通知（WebSocket）
			if (path === "/api/ws") {
				if (request.headers.get("Origin") !== url.origin) return json({ error: "forbidden" }, 403);
				if (!(await edgeAllow(env.RL_USER, "ws:" + s.userId))) return json({ error: BUSY }, 429);
				return notifier(env).fetch(new Request(`https://notifier/ws/${encodeURIComponent(s.userId)}`, request));
			}

			// 写真（R2）。表示はログイン中なら誰でも、削除はアップロードした人か管理者だけ
			if (path === "/api/photo" && request.method === "POST") {
				if (!(await edgeAllow(env.RL_USER, "photo:" + s.userId))) return json({ error: BUSY }, 429);
				if (await rateLimit(env, "photo:" + s.userId, 60, 24 * 60 * 60)) return json({ error: "画像のアップロードが多すぎます。時間をおいて試してください。" }, 429);
				const len = Number(request.headers.get("Content-Length") || 0);
				if (len > MAX_PHOTO) return json({ error: "画像が大きすぎます" }, 413);
				const buf = await request.arrayBuffer();
				if (buf.byteLength === 0 || buf.byteLength > MAX_PHOTO) return json({ error: "画像が大きすぎます" }, 413);
				const type = sniffImage(buf);
				if (!type) return json({ error: "画像は JPEG / PNG / WebP のみです" }, 415);
				const id = "p_" + [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, "0")).join("");
				await env.PHOTOS.put("photos/" + id, buf, { httpMetadata: { contentType: type }, customMetadata: { owner: s.userId } });
				return json({ id });
			}
			const photo = path.match(/^\/api\/photo\/([^/]+)$/);
			if (photo) {
				const id = photo[1];
				if (!PHOTO_ID.test(id)) return json({ error: "bad id" }, 400);
				const key = "photos/" + id;
				if (request.method === "GET") {
					const obj = await env.PHOTOS.get(key);
					if (!obj) return new Response("Not found", { status: 404 });
					const ctype = obj.httpMetadata?.contentType ?? "";
					return new Response(obj.body, {
						headers: {
							"Content-Type": PHOTO_TYPES.has(ctype) ? ctype : "application/octet-stream",
							"Cache-Control": "private, max-age=31536000, immutable",
							"X-Content-Type-Options": "nosniff",
							"Content-Security-Policy": "default-src 'none'; sandbox",
							"Content-Disposition": "inline",
							ETag: obj.httpEtag,
						},
					});
				}
				if (request.method === "PUT") return json({ error: "この方法ではアップロードできません" }, 405);
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
