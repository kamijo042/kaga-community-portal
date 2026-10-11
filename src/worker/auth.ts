/**
 * 世帯アカウントの認証
 *
 * - パスワード: PBKDF2-SHA256（Web Crypto）でハッシュ化。ソルトは毎回ランダム
 * - ログイン状態: ランダムなトークンを HttpOnly Cookie に入れ、KV に「トークンのハッシュ → 世帯」を保存（30日で自動失効）
 * - アカウント本体（ログインID・ハッシュ・権限・停止）は D1 の accounts 表
 * - パスワードには秘密の値（ペッパー：PASSWORD_PEPPER）を混ぜてからハッシュ化する。
 *   データベースだけが漏れても、ペッパーが無ければ総当たりで解読できない
 * - 回数制限は2段構え
 *   1) Workers の Rate Limiting（メモリ上で数える。D1 の無料枠を使わない）で、短時間の連打を先に止める
 *   2) D1 のカウンターは「失敗したときだけ」書く（ログインIDごとのロック用）
 */

/** Workers の Rate Limiting バインディング（wrangler.json の ratelimits） */
export type Limiter = { limit(opts: { key: string }): Promise<{ success: boolean }> };

export type AuthEnv = {
	DB: D1Database;
	AUTH: KVNamespace;
	/** 最初の管理者を作るときの合言葉（npx wrangler secret put ADMIN_SETUP_CODE） */
	ADMIN_SETUP_CODE?: string;
	/** パスワードに混ぜる秘密の値（npx wrangler secret put PASSWORD_PEPPER）。一度決めたら変えない */
	PASSWORD_PEPPER?: string;
	/** ログイン・招待まわり：同じ回線（IPv6 は /64 単位）から 1分に10回まで */
	RL_AUTH?: Limiter;
	/** ログイン・招待まわり：全体で 1分に60回まで（1拠点あたり） */
	RL_AUTH_ALL?: Limiter;
	/** ログイン後の操作：1人 1分に120回まで */
	RL_USER?: Limiter;
};

export type Session = { userId: string; householdId: string; role: "member" | "admin"; loginId: string };

export const COOKIE = "kaga_sess";
const SESSION_TTL = 60 * 60 * 24 * 30; // 30日
/** Workers の Web Crypto で使える PBKDF2 の上限回数 */
const PBKDF2_ITER = 100_000;
const LOCK_TTL = 15 * 60;
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const enc = new TextEncoder();
const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256(s: string) {
	return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

/** 長さに関係なく同じ時間で比較する */
function sameBytes(a: Uint8Array, b: Uint8Array) {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
	const key = await crypto.subtle.importKey("raw", enc.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
	return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

/** ペッパー入り：HMAC-SHA256(ペッパー, パスワード) を PBKDF2 にかける */
async function peppered(pepper: string, password: string) {
	const key = await crypto.subtle.importKey("raw", enc.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	return b64(await crypto.subtle.sign("HMAC", key, enc.encode(password.normalize("NFKC"))));
}

/** 保存形式：pbkdf2-sha256p$回数$salt$hash（p = ペッパー入り）。ペッパー未設定なら従来の pbkdf2-sha256 */
export async function hashPassword(env: AuthEnv, password: string) {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	if (env.PASSWORD_PEPPER) {
		const hash = await pbkdf2(await peppered(env.PASSWORD_PEPPER, password), salt, PBKDF2_ITER);
		return `pbkdf2-sha256p$${PBKDF2_ITER}$${b64(salt)}$${b64(hash)}`;
	}
	const hash = await pbkdf2(password, salt, PBKDF2_ITER);
	return `pbkdf2-sha256$${PBKDF2_ITER}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(env: AuthEnv, password: string, stored: string) {
	const [algo, iter, salt, hash] = stored.split("$");
	const n = Number(iter);
	if (!salt || !hash || !Number.isInteger(n) || n < 1 || n > PBKDF2_ITER) return false;
	if (algo === "pbkdf2-sha256p") {
		if (!env.PASSWORD_PEPPER) return false; // ペッパーが無いと照合できない（設定漏れ）
		return sameBytes(await pbkdf2(await peppered(env.PASSWORD_PEPPER, password), unb64(salt), n), unb64(hash));
	}
	if (algo === "pbkdf2-sha256") return sameBytes(await pbkdf2(password, unb64(salt), n), unb64(hash));
	return false;
}

/** 古い形式（ペッパーなし）で保存されているか。ログイン成功時に作り直す */
export const needsRehash = (env: AuthEnv, stored: string) => !!env.PASSWORD_PEPPER && !stored.startsWith("pbkdf2-sha256p$");

/** ハッシュが存在しないIDでも同じくらい時間をかける（IDの有無を推測させない） */
const DUMMY_HASH = "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
export const burnTime = (env: AuthEnv, password: string) => verifyPassword(env, password, DUMMY_HASH);

// ---------- 入力チェック ----------
export const LOGIN_ID = /^[a-z0-9][a-z0-9_.-]{2,31}$/;
export function checkLoginId(id: unknown): string | null {
	const v = typeof id === "string" ? id.trim().toLowerCase() : "";
	return LOGIN_ID.test(v) ? v : null;
}
export function passwordProblem(pw: unknown): string | null {
	if (typeof pw !== "string" || pw.length < 8) return "パスワードは8文字以上にしてください。";
	if (pw.length > 128) return "パスワードが長すぎます。";
	return null;
}

// ---------- 招待コード ----------
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 0/O・1/I など紛らわしい文字を除く
export function newInviteCode() {
	const r = crypto.getRandomValues(new Uint8Array(10));
	const s = [...r].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join("");
	return `${s.slice(0, 5)}-${s.slice(5)}`;
}
export const normalizeCode = (c: unknown) => (typeof c === "string" ? c.toUpperCase().replace(/[^A-Z0-9]/g, "") : "");

// ---------- セッション ----------
type StoredSession = { uid: string; epoch: number; at: number };

export async function createSession(env: AuthEnv, userId: string, epoch: number) {
	const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c] as string);
	const data: StoredSession = { uid: userId, epoch, at: Date.now() };
	await env.AUTH.put("sess:" + (await sha256(token)), JSON.stringify(data), { expirationTtl: SESSION_TTL });
	return token;
}

export async function destroySession(env: AuthEnv, token: string | null) {
	if (token) await env.AUTH.delete("sess:" + (await sha256(token)));
}

export function cookieOf(request: Request, name = COOKIE) {
	const raw = request.headers.get("Cookie") ?? "";
	for (const part of raw.split(";")) {
		const [k, ...v] = part.trim().split("=");
		if (k === name) {
			try { return decodeURIComponent(v.join("=")); } catch { return null; }
		}
	}
	return null;
}

export function sessionCookie(token: string, url: URL) {
	const secure = url.protocol === "https:" || url.hostname === "localhost" ? "; Secure" : "";
	return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}${secure}`;
}
export function clearCookie(url: URL) {
	const secure = url.protocol === "https:" || url.hostname === "localhost" ? "; Secure" : "";
	return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

/** Cookie からログイン中の人を調べる（アカウントの停止・権限は毎回 D1 で確認） */
export async function currentSession(env: AuthEnv, request: Request): Promise<Session | null> {
	const token = cookieOf(request);
	if (!token || token.length > 100) return null;
	const raw = await env.AUTH.get("sess:" + (await sha256(token)));
	if (!raw) return null;
	let s: StoredSession;
	try { s = JSON.parse(raw) as StoredSession; } catch { return null; }
	if (!s.uid) return null;
	const acc = await env.DB.prepare("SELECT household_id, login_id, role, disabled, session_epoch FROM accounts WHERE user_id = ?").bind(s.uid)
		.first<{ household_id: string; login_id: string; role: "member" | "admin"; disabled: number; session_epoch: number }>();
	if (!acc || acc.disabled || acc.session_epoch !== s.epoch) return null;
	return { userId: s.uid, householdId: acc.household_id, role: acc.role, loginId: acc.login_id };
}

// ---------- 回数制限 ----------

/** 回数を数える単位の「回線」。IPv6 は /64 ごと（1契約で大量のアドレスを持てるため） */
export function clientNet(request: Request) {
	const ip = request.headers.get("CF-Connecting-IP") ?? "local";
	if (!ip.includes(":")) return ip;
	const [head, tail] = ip.split("::");
	const h = head ? head.split(":") : [];
	const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
	const groups = tail !== undefined ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
	return groups.slice(0, 4).map((x) => (x || "0").toLowerCase().replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

/** メモリ上の回数制限（D1 を使わない）。バインディングが無い環境では通す */
export async function edgeAllow(limiter: Limiter | undefined, key: string) {
	if (!limiter) return true;
	try { return (await limiter.limit({ key })).success; } catch { return true; }
}

const rateKey = (key: string) => key.slice(0, 200);

/** 今の失敗回数（読むだけ。書き込みは失敗時の rateHit だけ） */
export async function rateCount(env: AuthEnv, key: string) {
	return (await env.DB.prepare("SELECT n FROM rate_limits WHERE key = ? AND reset_at > ?").bind(rateKey(key), Date.now()).first<number>("n")) ?? 0;
}

/** 1回分を足す（1文で足すので同時アクセスでも抜けない）。上限を超えたら true */
export async function rateLimit(env: AuthEnv, key: string, limit: number, windowSec = LOCK_TTL): Promise<boolean> {
	return (await rateAdd(env, key, 1, windowSec)) > limit;
}

/** 回数を amount だけ足して、足した後の値を返す */
export async function rateAdd(env: AuthEnv, key: string, amount: number, windowSec = LOCK_TTL): Promise<number> {
	const now = Date.now();
	const row = await env.DB.prepare(
		`INSERT INTO rate_limits (key, n, reset_at) VALUES (?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET
		   n = CASE WHEN rate_limits.reset_at <= ? THEN excluded.n ELSE rate_limits.n + excluded.n END,
		   reset_at = CASE WHEN rate_limits.reset_at <= ? THEN excluded.reset_at ELSE rate_limits.reset_at END
		 RETURNING n`,
	).bind(rateKey(key), amount, now + windowSec * 1000, now, now).first<{ n: number }>();
	if (!row) throw new Error("rate limit");
	// たまに期限切れの行を掃除する（表が増え続けないように）
	if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM rate_limits WHERE reset_at < ?").bind(now - 60_000).run();
	return row.n;
}

/** 失敗を1回記録する */
export const rateHit = (env: AuthEnv, key: string) => rateAdd(env, key, 1);

export async function clearRate(env: AuthEnv, key: string) {
	await env.DB.prepare("DELETE FROM rate_limits WHERE key = ?").bind(rateKey(key)).run();
}

/** 長さが違っても比較時間が変わらない（初期設定コード用） */
export async function sameSecret(a: string, b: string) {
	const [ha, hb] = await Promise.all([
		crypto.subtle.digest("SHA-256", enc.encode(a)),
		crypto.subtle.digest("SHA-256", enc.encode(b)),
	]);
	return sameBytes(new Uint8Array(ha), new Uint8Array(hb));
}
