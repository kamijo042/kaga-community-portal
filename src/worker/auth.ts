/**
 * 世帯アカウントの認証
 *
 * - パスワード: PBKDF2-SHA256（Web Crypto）でハッシュ化。ソルトは毎回ランダム
 * - ログイン状態: ランダムなトークンを HttpOnly Cookie に入れ、KV に「トークンのハッシュ → 世帯」を保存（30日で自動失効）
 * - アカウント本体（ログインID・ハッシュ・権限・停止）は D1 の accounts 表
 * - ログイン失敗が続いたら KV のカウンターで一時的にロック
 */

export type AuthEnv = {
	DB: D1Database;
	AUTH: KVNamespace;
	/** 最初の管理者を作るときの合言葉（npx wrangler secret put ADMIN_SETUP_CODE） */
	ADMIN_SETUP_CODE?: string;
};

export type Session = { userId: string; householdId: string; role: "member" | "admin"; loginId: string };

export const COOKIE = "kaga_sess";
const SESSION_TTL = 60 * 60 * 24 * 30; // 30日
/** Workers の Web Crypto で使える PBKDF2 の上限回数 */
const PBKDF2_ITER = 100_000;
const LOCK_LIMIT = 10; // 15分間にこの回数失敗したらロック
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

export async function hashPassword(password: string) {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const hash = await pbkdf2(password, salt, PBKDF2_ITER);
	return `pbkdf2-sha256$${PBKDF2_ITER}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string) {
	const [algo, iter, salt, hash] = stored.split("$");
	if (algo !== "pbkdf2-sha256" || !iter || !salt || !hash) return false;
	const got = await pbkdf2(password, unb64(salt), Number(iter));
	return sameBytes(got, unb64(hash));
}

/** ハッシュが存在しないIDでも同じくらい時間をかける（IDの有無を推測させない） */
const DUMMY_HASH = "pbkdf2-sha256$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
export const burnTime = (password: string) => verifyPassword(password, DUMMY_HASH);

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
		if (k === name) return decodeURIComponent(v.join("="));
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

// ---------- ログイン失敗の制限 ----------
export async function isLocked(env: AuthEnv, keys: string[]) {
	const vals = await Promise.all(keys.map((k) => env.AUTH.get("rl:" + k)));
	return vals.some((v) => Number(v ?? 0) >= LOCK_LIMIT);
}
export async function recordFailure(env: AuthEnv, keys: string[]) {
	await Promise.all(keys.map(async (k) => {
		const n = Number((await env.AUTH.get("rl:" + k)) ?? 0) + 1;
		await env.AUTH.put("rl:" + k, String(n), { expirationTtl: LOCK_TTL });
	}));
}
export async function clearFailures(env: AuthEnv, keys: string[]) {
	await Promise.all(keys.map((k) => env.AUTH.delete("rl:" + k)));
}
