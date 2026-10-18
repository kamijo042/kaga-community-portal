import { clientNet, currentSession, edgeAllow, rateLimit, sha256, type AuthEnv, type Session } from "./auth";

/**
 * 会員以外も参加登録できるイベントの公開URL（/e/<token>）
 *
 * - 公開ページに出すのは「タイトル」「日時」「場所の先頭6文字」だけ。説明・参加者の名前・人数・主催者は出さない
 * - 会員以外は「名前・人数・ひとこと」だけで登録できる（連絡先は預からない）
 * - 登録した端末に編集用の鍵を渡し、その端末からだけ変更・取り消しできる（サーバーには鍵のハッシュだけ）
 * - 登録された名前は、ログインした会員だけが参加者一覧で見られる
 */

type Env = AuthEnv & { ASSETS?: Fetcher };
type Body = Record<string, unknown>;
type PostRow = { id: string; title: string; body: string; cat: string; kind: string; rsvp_on: number | null; rsvp_closed: number; ev_date: string | null; ev_start: string | null; ev_end: string | null; ev_place: string | null; ev_capacity: number | null; public_token: string | null; owner: string };

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const GUEST_ID = /^g_[A-Za-z0-9_-]{8,64}$/;
const GUESTS_PER_EVENT = 200;
const json = (data: unknown, status = 200) =>
	new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex" },
	});
const fail = (error: string, status = 400) => json({ error }, status);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max) : "");
const rand = (bytes: number) => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function readBody(request: Request): Promise<Body> {
	try { const b = await request.json(); return b && typeof b === "object" ? (b as Body) : {}; } catch { return {}; }
}

async function postByToken(env: Env, token: string) {
	if (!TOKEN.test(token)) return null;
	return env.DB.prepare(
		"SELECT id, title, body, cat, kind, rsvp_on, rsvp_closed, ev_date, ev_start, ev_end, ev_place, ev_capacity, public_token, owner FROM posts WHERE public_token = ?",
	).bind(token).first<PostRow>();
}

/** 受け付けていない理由（受け付けているなら null）。日時は加賀（日本時間）で判断する */
async function closedReason(env: Env, p: PostRow, addPeople = 0, exceptGuest = ""): Promise<string | null> {
	const on = p.rsvp_on === null ? p.cat === "event" : !!p.rsvp_on;
	if (!on) return "このイベントは参加登録を受け付けていません。";
	if (p.rsvp_closed) return "参加の受付は締め切られました。";
	if (p.ev_date && /^\d{4}-\d{2}-\d{2}$/.test(p.ev_date)) {
		const end = Date.parse(`${p.ev_date}T${/^\d{2}:\d{2}$/.test(p.ev_end ?? "") ? p.ev_end : "23:59"}:00+09:00`);
		if (Number.isFinite(end) && end < Date.now()) return "このイベントは終了しました。";
	}
	if (p.ev_capacity) {
		const r = await env.DB.prepare(
			`SELECT (SELECT COALESCE(SUM(people),0) FROM rsvps WHERE post_id = ?1 AND status = 'go')
			      + (SELECT COALESCE(SUM(people),0) FROM guests WHERE post_id = ?1 AND id <> ?2) AS n`,
		).bind(p.id, exceptGuest).first<number>("n");
		if (Number(r ?? 0) + addPeople > p.ev_capacity) return "定員に達しました。";
	}
	return null;
}

const guestFields = (b: Body) => {
	const name = str(b.name, 40);
	const people = Math.trunc(Number(b.people));
	return { name, people: Number.isFinite(people) ? Math.min(20, Math.max(1, people)) : 1, note: str(b.note, 200) };
};

/** /api/public/* （ログイン不要） */
export async function handlePublic(request: Request, env: Env, url: URL): Promise<Response | null> {
	const m = url.pathname.match(/^\/api\/public\/event\/([^/]+)(\/guest(?:\/(me|update|cancel))?)?$/);
	if (!m) return url.pathname.startsWith("/api/public/") ? fail("not found", 404) : null;
	const [, token, guestPath, action] = m;
	const net = clientNet(request);
	if (!(await edgeAllow(env.RL_AUTH_ALL, "public"))) return fail("混み合っています。少し時間をおいてから試してください。", 429);
	const p = await postByToken(env, token);
	if (!p) return fail("このURLは無効です。主催者に確認してください。", 404);

	// イベントの表示：タイトル・日時・場所だけ（説明・参加者・主催者は出さない）
	if (!guestPath && request.method === "GET") {
		const reason = await closedReason(env, p);
		return json({ postId: p.id, title: p.title, kind: p.kind, date: p.ev_date ?? "", start: p.ev_start ?? "", end: p.ev_end ?? "", place: shortPlace(p.ev_place), open: !reason, reason });
	}
	if (request.method !== "POST") return fail("not found", 404);
	if (!(await edgeAllow(env.RL_AUTH, "guest:" + net))) return fail("操作が多すぎます。少し時間をおいてから試してください。", 429);
	const b = await readBody(request);
	const now = Date.now();

	// 新しく登録
	if (!action) {
		const f = guestFields(b);
		if (!f.name) return fail("お名前を入力してください。");
		if (await rateLimit(env, "guest:" + net, 30, 24 * 60 * 60)) return fail("今日はこれ以上登録できません。", 429);
		const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM guests WHERE post_id = ?").bind(p.id).first<number>("n");
		if (Number(count ?? 0) >= GUESTS_PER_EVENT) return fail("登録の上限に達しました。主催者に連絡してください。", 409);
		const reason = await closedReason(env, p, f.people);
		if (reason) return fail(reason, 409);
		const id = "g_" + rand(12);
		const editToken = rand(24);
		await env.DB.prepare("INSERT INTO guests (id,post_id,name,people,note,edit_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
			.bind(id, p.id, f.name, f.people, f.note, await sha256(editToken), now, now).run();
		return json({ ok: true, id, editToken, ...f });
	}

	// 自分の登録（登録した端末が持つ鍵で確認）
	const id = str(b.id, 80), editToken = str(b.editToken, 80);
	if (!GUEST_ID.test(id) || !editToken) return fail("登録が見つかりません。", 404);
	const g = await env.DB.prepare("SELECT id, name, people, note FROM guests WHERE id = ? AND post_id = ? AND edit_hash = ?")
		.bind(id, p.id, await sha256(editToken)).first<{ id: string; name: string; people: number; note: string }>();
	if (!g) return fail("登録が見つかりません。主催者に取り消された可能性があります。", 404);
	if (action === "me") return json({ id: g.id, name: g.name, people: g.people, note: g.note });
	if (action === "cancel") {
		await env.DB.batch([
			env.DB.prepare("DELETE FROM guests WHERE id = ?").bind(id),
			env.DB.prepare("INSERT OR REPLACE INTO tombstones (tbl,id,deleted_at) VALUES ('guests',?,?)").bind(id, now),
		]);
		return json({ ok: true });
	}
	// 変更（人数を増やすときは定員も確認）
	const f = guestFields(b);
	if (!f.name) return fail("お名前を入力してください。");
	const reason = await closedReason(env, p, f.people, id);
	if (reason) return fail(reason, 409);
	await env.DB.prepare("UPDATE guests SET name = ?, people = ?, note = ?, updated_at = ? WHERE id = ?").bind(f.name, f.people, f.note, now, id).run();
	return json({ ok: true, ...f });
}

/** /api/posts/public （投稿者だけ）：公開URLの発行・作り直し・停止 */
export async function handlePostPublic(request: Request, env: Env, url: URL, s: Session): Promise<Response | null> {
	if (url.pathname !== "/api/posts/public" || request.method !== "POST") return null;
	const b = await readBody(request);
	const postId = str(b.postId, 200);
	const p = await env.DB.prepare("SELECT id, owner FROM posts WHERE id = ?").bind(postId).first<{ id: string; owner: string }>();
	if (!p) return fail("投稿が見つかりません。", 404);
	if (p.owner !== s.userId && s.role !== "admin") return fail("投稿した人だけが操作できます。", 403);
	const token = b.action === "stop" ? null : rand(16);
	await env.DB.prepare("UPDATE posts SET public_token = ?, updated_at = ? WHERE id = ?").bind(token, Date.now(), p.id).run();
	return json({ ok: true, token });
}

/** 公開ページの場所は先頭6文字まで（番地や個人宅の名前まで出さない）。全文はサーバーから送らない */
const PLACE_CHARS = 6;
function shortPlace(place: string | null) {
	const chars = Array.from((place ?? "").replace(/\s+/g, " ").trim());
	return chars.length > PLACE_CHARS ? chars.slice(0, PLACE_CHARS).join("") + "…" : chars.join("");
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/** 日時の表示（例：11月14日（土）13:00〜15:00）。日本時間の日付として扱う */
function whenText(p: PostRow) {
	if (!p.ev_date || !/^\d{4}-\d{2}-\d{2}$/.test(p.ev_date)) return "";
	const [y, m, d] = p.ev_date.split("-").map(Number);
	const wd = "日月火水木金土"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
	return `${m}月${d}日（${wd}）${p.ev_start ? " " + p.ev_start : ""}${p.ev_end ? "〜" + p.ev_end : ""}`;
}

/** /e/<token>：アプリの画面を返しつつ、LINE などのリンクのプレビュー用にタイトル・日時・場所を入れる（検索エンジンには載せない） */
export async function servePublicPage(request: Request, env: Env, url: URL): Promise<Response | null> {
	const m = url.pathname.match(/^\/e\/([^/]+)\/?$/);
	if (!m || !env.ASSETS) return null;
	const p = await postByToken(env, m[1]).catch(() => null);
	// ログイン中の会員は、公開ページを出さずにいつもの画面でそのイベントを開く
	if (p && (await currentSession(env, request).catch(() => null))) {
		return new Response(null, { status: 302, headers: { Location: `/?post=${encodeURIComponent(p.id)}`, "Cache-Control": "no-store" } });
	}
	const page = await env.ASSETS.fetch(new Request(new URL("/", url), request));
	let html = await page.text();
	const title = p ? `${p.title}｜参加登録` : "参加登録";
	const desc = p ? [whenText(p), shortPlace(p.ev_place)].filter(Boolean).join(" ・ ").slice(0, 120) : "";
	const meta = `<meta name="robots" content="noindex"><meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}">${desc ? `<meta property="og:description" content="${esc(desc)}"><meta name="description" content="${esc(desc)}">` : ""}`;
	html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`).replace("</head>", meta + "</head>");
	const headers = new Headers(page.headers);
	headers.set("X-Robots-Tag", "noindex");
	headers.set("Cache-Control", "no-store");
	headers.delete("Content-Length");
	headers.delete("ETag");
	return new Response(html, { status: p ? 200 : 404, headers });
}
