import {
	INVITE_TTL_MS, burnTime, checkLoginId, clearCookie, clearRate, cookieOf, createSession, currentSession, destroySession,
	hashPassword, newInviteCode, normalizeCode, passwordProblem, rateLimit, sessionCookie, sha256, sameSecret, verifyPassword,
	type AuthEnv, type Session,
} from "./auth";

/**
 * /api/auth/*   … ログイン・ログアウト・初期設定・招待の受け取り・パスワード変更
 * /api/family/* … 家族のログイン発行（同じ世帯の家族なら誰でも）
 * /api/admin/*  … 管理者による世帯の招待・再設定コード・停止
 *
 * 世帯は管理者だけが作れる（1世帯につき1回）。家族はその世帯の中に「人」として追加する。
 * ログインは人ごと。ログインを持たない家族（赤ちゃんなど）も登録できる。
 */

type Env = AuthEnv;
type Body = Record<string, unknown>;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(data), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
			"X-Frame-Options": "DENY",
			"Referrer-Policy": "no-referrer",
			...headers,
		},
	});
const fail = (message: string, status = 400, extra: Body = {}) => json({ error: message, ...extra }, status);
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const SAFE_ID = /^[A-Za-z0-9_\-:.]{1,200}$/;
const newId = (prefix: string) => prefix + Date.now().toString(36) + [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(36)).join("");
const LOGIN_ID_HELP = "ログインIDは半角英小文字・数字・記号（_ . -）で3〜32文字にしてください。";

async function readBody(request: Request): Promise<Body> {
	try { const b = await request.json(); return b && typeof b === "object" ? (b as Body) : {}; } catch { return {}; }
}

const accountCount = async (env: Env) => (await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts").first<number>("n")) ?? 0;

async function startSession(env: Env, url: URL, userId: string) {
	const epoch = (await env.DB.prepare("SELECT session_epoch FROM accounts WHERE user_id = ?").bind(userId).first<number>("session_epoch")) ?? 0;
	const token = await createSession(env, userId, epoch);
	await env.DB.prepare("UPDATE accounts SET last_login_at = ? WHERE user_id = ?").bind(Date.now(), userId).run();
	return sessionCookie(token, url);
}

const insertHousehold = (env: Env, id: string, h: Body, now: number) =>
	env.DB.prepare("INSERT INTO households (id,name,head_name,head_birth,district,note,members,created_at,updated_at) VALUES (?,?,'','',?,?,'[]',?,?)")
		.bind(id, str(h.name, 100), str(h.district, 100), str(h.note, 1000), now, now);

const insertPerson = (env: Env, id: string, householdId: string, p: Body, now: number) =>
	env.DB.prepare("INSERT INTO people (id,household_id,name,relation,birth_year,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
		.bind(id, householdId, str(p.name, 100), str(p.relation, 20) || "世帯主", str(p.birthYear, 10), now, now);

const defaultHouseholdName = (name: string, headName: string) => name || (headName.split(/[\s　]/)[0] || "新しい") + "家";

type Person = { id: string; household_id: string; name: string; relation: string };
const getPerson = (env: Env, id: string) =>
	SAFE_ID.test(id) ? env.DB.prepare("SELECT id, household_id, name, relation FROM people WHERE id = ?").bind(id).first<Person>() : Promise.resolve(null);

async function issueInvite(env: Env, person: Person, by: string) {
	const code = newInviteCode();
	const now = Date.now();
	const hasAccount = await env.DB.prepare("SELECT 1 AS x FROM accounts WHERE user_id = ?").bind(person.id).first();
	const purpose = hasAccount ? "reset" : "new";
	await env.DB.batch([
		// 同じ人あての未使用コードは無効にする
		env.DB.prepare("UPDATE invites SET used_at = ? WHERE user_id = ? AND used_at IS NULL").bind(now, person.id),
		env.DB.prepare("INSERT INTO invites (code_hash,user_id,household_id,purpose,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?,?)")
			.bind(await sha256(normalizeCode(code)), person.id, person.household_id, purpose, by, now, now + INVITE_TTL_MS),
	]);
	return { code, expiresAt: now + INVITE_TTL_MS, purpose };
}

async function findInvite(env: Env, code: unknown) {
	const c = normalizeCode(code);
	if (c.length !== 10) return null;
	const inv = await env.DB.prepare("SELECT * FROM invites WHERE code_hash = ?").bind(await sha256(c))
		.first<{ code_hash: string; user_id: string; household_id: string; purpose: "new" | "reset"; expires_at: number; used_at: number | null }>();
	if (!inv || inv.used_at || inv.expires_at < Date.now()) return null;
	return inv;
}

/** 世帯の中の人ごとのログイン状況 */
async function accountRows(env: Env, householdId: string | null) {
	const rows = await env.DB.prepare(
		`SELECT p.id AS user_id, p.household_id, p.name, p.relation, h.name AS household_name, h.district,
		        a.login_id, a.role, a.disabled, a.last_login_at,
		        (SELECT MAX(expires_at) FROM invites i WHERE i.user_id = p.id AND i.used_at IS NULL AND i.expires_at > ?) AS invite_expires
		 FROM people p JOIN households h ON h.id = p.household_id LEFT JOIN accounts a ON a.user_id = p.id
		 ${householdId ? "WHERE p.household_id = ?" : ""}
		 ORDER BY h.created_at, p.created_at`,
	).bind(...(householdId ? [Date.now(), householdId] : [Date.now()])).all<Body>();
	return (rows.results ?? []).map((r) => ({
		userId: r.user_id, householdId: r.household_id, name: r.name, relation: r.relation, householdName: r.household_name, district: r.district,
		loginId: r.login_id ?? null, role: r.role ?? null, disabled: !!r.disabled, lastLoginAt: r.last_login_at ?? null, inviteExpiresAt: r.invite_expires ?? null,
	}));
}

// ======================================================================
export async function handleAuth(request: Request, env: Env, url: URL): Promise<Response | null> {
	const path = url.pathname;
	const method = request.method;
	const ip = request.headers.get("CF-Connecting-IP") ?? "local";

	if (path === "/api/auth/me" && method === "GET") {
		const s = await currentSession(env, request);
		if (s) return json({ user: s });
		return json({ user: null, needsSetup: (await accountCount(env)) === 0 });
	}

	// 最初の管理者を作る（アカウントが1つもないときだけ）
	if (path === "/api/auth/setup" && method === "POST") {
		const b = await readBody(request);
		if ((await accountCount(env)) > 0) return fail("初期設定はすでに完了しています。", 409);
		if (!env.ADMIN_SETUP_CODE) return fail("サーバーに ADMIN_SETUP_CODE が設定されていません。README の手順で設定してください。", 503);
		if (await rateLimit(env, "setup:" + ip, 10)) return fail("しばらく時間をおいてから試してください。", 429);
		if (!(await sameSecret(str(b.setupCode), env.ADMIN_SETUP_CODE))) return fail("初期設定コードが違います。", 403);
		const loginId = checkLoginId(b.loginId);
		if (!loginId) return fail(LOGIN_ID_HELP);
		const pwErr = passwordProblem(b.password);
		if (pwErr) return fail(pwErr);
		const person = (b.person ?? {}) as Body;
		const h = (b.household ?? {}) as Body;
		const name = str(person.name, 100);
		if (!name) return fail("お名前を入力してください。");
		const hid = newId("h_");
		const uid = newId("u_");
		const now = Date.now();
		try {
			await env.DB.batch([
				// 同時に2件来ても、こちらが先に失敗して全部取り消される
				env.DB.prepare("INSERT INTO app_lock (id, created_at) VALUES ('setup', ?)").bind(now),
				insertHousehold(env, hid, { ...h, name: defaultHouseholdName(str(h.name, 100), name) }, now),
				insertPerson(env, uid, hid, { ...person, relation: "世帯主" }, now),
				env.DB.prepare("INSERT INTO accounts (user_id,household_id,login_id,password_hash,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
					.bind(uid, hid, loginId, await hashPassword(b.password as string), "admin", now, now),
			]);
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			if (/unique|constraint/i.test(msg)) return fail("初期設定はすでに完了しています。", 409);
			throw e;
		}
		return json({ ok: true }, 200, { "Set-Cookie": await startSession(env, url, uid) });
	}

	if (path === "/api/auth/login" && method === "POST") {
		const b = await readBody(request);
		const loginId = checkLoginId(b.loginId);
		const password = typeof b.password === "string" ? b.password : "";
		// IP全体は緩め（同じ回線の人が巻き込まれにくい）。IDごとの試行は厳しく、ただしそのIPからだけ数える
		if (await rateLimit(env, "login:ip:" + ip, 30)) return fail("ログインに続けて失敗したため、15分ほどロックしています。", 429);
		const pair = loginId ? "login:" + ip + ":" + loginId : "";
		if (pair && (await rateLimit(env, pair, 10))) return fail("ログインに続けて失敗したため、15分ほどロックしています。", 429);
		const acc = loginId
			? await env.DB.prepare("SELECT user_id, password_hash, disabled FROM accounts WHERE login_id = ?").bind(loginId)
				.first<{ user_id: string; password_hash: string; disabled: number }>()
			: null;
		const ok = acc ? await verifyPassword(password, acc.password_hash) : (await burnTime(password), false);
		if (!acc || !ok) return fail("ログインIDかパスワードが違います。", 401);
		if (acc.disabled) return fail("このアカウントは利用停止中です。運営にお問い合わせください。", 403);
		if (pair) await clearRate(env, pair);
		return json({ ok: true }, 200, { "Set-Cookie": await startSession(env, url, acc.user_id) });
	}

	if (path === "/api/auth/logout" && method === "POST") {
		await destroySession(env, cookieOf(request));
		return json({ ok: true }, 200, { "Set-Cookie": clearCookie(url) });
	}

	// 招待コードの確認（誰あてのコードかを見せる）
	if (path === "/api/auth/invite" && method === "POST") {
		const b = await readBody(request);
		if (await rateLimit(env, "inv:" + ip, 30)) return fail("しばらく時間をおいてから試してください。", 429);
		const inv = await findInvite(env, b.code);
		if (!inv) return fail("招待コードが正しくないか、期限が切れています。", 404);
		const p = await env.DB.prepare("SELECT p.name, p.relation, h.name AS household_name, h.district FROM people p JOIN households h ON h.id = p.household_id WHERE p.id = ?")
			.bind(inv.user_id).first<Body>();
		const acc = await env.DB.prepare("SELECT login_id FROM accounts WHERE user_id = ?").bind(inv.user_id).first<{ login_id: string }>();
		return json({
			purpose: inv.purpose,
			loginId: acc?.login_id ?? null,
			person: p ? { name: p.name, relation: p.relation } : null,
			household: p ? { name: p.household_name, district: p.district } : null,
		});
	}

	// 招待コードでログインを作る／パスワードを再設定する
	if (path === "/api/auth/accept" && method === "POST") {
		const b = await readBody(request);
		if (await rateLimit(env, "inv:" + ip, 30)) return fail("しばらく時間をおいてから試してください。", 429);
		const inv = await findInvite(env, b.code);
		if (!inv) return fail("招待コードが正しくないか、期限が切れています。", 404);
		const pwErr = passwordProblem(b.password);
		if (pwErr) return fail(pwErr);
		const person = await env.DB.prepare("SELECT id FROM people WHERE id = ?").bind(inv.user_id).first();
		if (!person) return fail("招待された人が見つかりません。運営に連絡してください。", 404);
		const existing = await env.DB.prepare("SELECT login_id, disabled FROM accounts WHERE user_id = ?").bind(inv.user_id).first<{ login_id: string; disabled: number }>();
		if (existing?.disabled) return fail("このアカウントは利用停止中です。運営にお問い合わせください。", 403);
		let loginId: string | null = null;
		if (!existing) {
			loginId = checkLoginId(b.loginId);
			if (!loginId) return fail(LOGIN_ID_HELP);
			if (await env.DB.prepare("SELECT 1 AS x FROM accounts WHERE login_id = ?").bind(loginId).first()) return fail("このログインIDはすでに使われています。別のIDにしてください。", 409);
		}
		const now = Date.now();
		// 先に「使用済み」にしてからパスワードを書く。同時に2回使われない
		const claimed = await env.DB.prepare("UPDATE invites SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?").bind(now, inv.code_hash, now).run();
		if (!claimed.meta.changes) return fail("招待コードが正しくないか、期限が切れています。", 404);
		const hash = await hashPassword(b.password as string);
		try {
			if (existing) {
				await env.DB.prepare("UPDATE accounts SET password_hash = ?, session_epoch = session_epoch + 1, updated_at = ? WHERE user_id = ?").bind(hash, now, inv.user_id).run();
			} else {
				await env.DB.prepare("INSERT INTO accounts (user_id,household_id,login_id,password_hash,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
					.bind(inv.user_id, inv.household_id, loginId, hash, "member", now, now).run();
			}
		} catch { return fail("このログインIDはすでに使われています。別のIDで、新しい招待コードを発行してもらってください。", 409); }
		return json({ ok: true }, 200, { "Set-Cookie": await startSession(env, url, inv.user_id) });
	}

	if (path === "/api/auth/password" && method === "POST") {
		const s = await currentSession(env, request);
		if (!s) return fail("ログインしてください。", 401);
		if (await rateLimit(env, "pw:" + s.userId, 10)) return fail("しばらく時間をおいてから試してください。", 429);
		const b = await readBody(request);
		const acc = await env.DB.prepare("SELECT password_hash FROM accounts WHERE user_id = ?").bind(s.userId).first<{ password_hash: string }>();
		if (!acc || !(await verifyPassword(String(b.current ?? ""), acc.password_hash))) return fail("今のパスワードが違います。", 403);
		await clearRate(env, "pw:" + s.userId);
		const pwErr = passwordProblem(b.next);
		if (pwErr) return fail(pwErr);
		await env.DB.prepare("UPDATE accounts SET password_hash = ?, session_epoch = session_epoch + 1, updated_at = ? WHERE user_id = ?")
			.bind(await hashPassword(b.next as string), Date.now(), s.userId).run();
		return json({ ok: true }, 200, { "Set-Cookie": await startSession(env, url, s.userId) });
	}

	return null;
}

// ======================================================================
/** 家族のログイン（同じ世帯の家族なら誰でも） */
export async function handleFamily(request: Request, env: Env, url: URL, s: Session): Promise<Response | null> {
	const path = url.pathname;
	if (!path.startsWith("/api/family/")) return null;

	if (path === "/api/family/accounts" && request.method === "GET") {
		return json({ accounts: await accountRows(env, s.householdId) });
	}
	// 家族にログインを発行する（すでにあればパスワード再設定コード）
	if (path === "/api/family/invite" && request.method === "POST") {
		const b = await readBody(request);
		const p = await getPerson(env, str(b.userId));
		if (!p || p.household_id !== s.householdId) return fail("同じ世帯の家族にだけ発行できます。", 403);
		if (p.id === s.userId) return fail("自分のパスワードは「パスワードを変更」から変えてください。");
		const acc = await env.DB.prepare("SELECT role, disabled FROM accounts WHERE user_id = ?").bind(p.id).first<{ role: string; disabled: number }>();
		if (acc?.disabled) return fail("利用停止中のアカウントには発行できません。", 403);
		// 家族が管理者のパスワードを書き換えて、管理者としてログインするのを防ぐ
		if (acc?.role === "admin" && s.role !== "admin") return fail("管理者の再設定コードは、ほかの管理者に依頼してください。", 403);
		return json(await issueInvite(env, p, s.userId));
	}
	return fail("not found", 404);
}

// ======================================================================
export async function handleAdmin(request: Request, env: Env, url: URL, s: Session): Promise<Response | null> {
	const path = url.pathname;
	if (!path.startsWith("/api/admin/")) return null;
	if (s.role !== "admin") return fail("管理者だけが使えます。", 403);

	if (path === "/api/admin/accounts" && request.method === "GET") {
		return json({ accounts: await accountRows(env, null) });
	}

	// 新しい世帯を作り、世帯主あての招待コードを発行（同じ世帯の二重登録はしない）
	if (path === "/api/admin/households" && request.method === "POST") {
		const b = await readBody(request);
		const headName = str(b.headName, 100);
		if (!headName) return fail("世帯主の氏名を入力してください。");
		const name = defaultHouseholdName(str(b.name, 100), headName);
		const district = str(b.district, 100);
		const compact = (v: string) => v.replace(/[\s　]/g, "");
		if (b.force !== true) {
			const dup = await env.DB.prepare(
				`SELECT h.name, h.district, p.name AS head FROM households h LEFT JOIN people p ON p.household_id = h.id AND p.relation = '世帯主'
				 WHERE replace(replace(p.name,' ',''),'　','') = ? OR (h.name = ? AND h.district = ?) LIMIT 1`,
			).bind(compact(headName), name, district).first<Body>();
			if (dup) return fail(`同じ世帯がすでに登録されているかもしれません（${dup.name}・世帯主 ${dup.head ?? "—"}${dup.district ? "・" + dup.district : ""}）。家族の追加はその世帯の中で行ってください。`, 409, { duplicate: true });
		}
		const hid = newId("h_");
		const uid = newId("u_");
		const now = Date.now();
		await env.DB.batch([
			insertHousehold(env, hid, { name, district }, now),
			insertPerson(env, uid, hid, { name: headName, relation: "世帯主" }, now),
		]);
		const inv = await issueInvite(env, { id: uid, household_id: hid, name: headName, relation: "世帯主" }, s.userId);
		return json({ householdId: hid, userId: uid, name, ...inv });
	}

	if (path === "/api/admin/invite" && request.method === "POST") {
		const b = await readBody(request);
		const p = await getPerson(env, str(b.userId));
		if (!p) return fail("その人が見つかりません。", 404);
		return json(await issueInvite(env, p, s.userId));
	}

	if (path === "/api/admin/account" && request.method === "POST") {
		const b = await readBody(request);
		const uid = str(b.userId);
		if (uid === s.userId) return fail("自分自身のアカウントは変更できません。");
		const sets: string[] = [];
		const binds: unknown[] = [];
		if (typeof b.disabled === "boolean") { sets.push("disabled = ?", "session_epoch = session_epoch + 1"); binds.push(b.disabled ? 1 : 0); }
		if (b.role === "admin" || b.role === "member") { sets.push("role = ?"); binds.push(b.role); }
		if (!sets.length) return fail("変更内容がありません。");
		const r = await env.DB.prepare(`UPDATE accounts SET ${sets.join(", ")}, updated_at = ? WHERE user_id = ?`).bind(...binds, Date.now(), uid).run();
		if (!r.meta.changes) return fail("アカウントが見つかりません。", 404);
		return json({ ok: true });
	}

	return fail("not found", 404);
}
