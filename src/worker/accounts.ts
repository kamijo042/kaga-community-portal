import {
	INVITE_TTL_MS, burnTime, checkLoginId, clearCookie, clearRate, clientNet, cookieOf, createSession, currentSession, destroySession, edgeAllow,
	hashPassword, needsRehash, newInviteCode, normalizeCode, passwordProblem, rateCount, rateHit, rateLimit, sessionCookie, sha256, sameSecret, verifyPassword,
	type AuthEnv, type Session,
} from "./auth";

/**
 * /api/auth/*   … ログイン・ログアウト・初期設定・招待の受け取り・パスワード変更
 * /api/family/* … 家族へのログイン発行（同じ世帯の家族なら誰でも。ただし「まだログインが無い家族」だけ）
 * /api/admin/*  … 管理者による世帯の招待・再設定コード・停止・世帯の削除
 * /api/invites/* … 会員による新しい世帯の招待（1人あたり上限あり。管理者は上限なし）
 *
 * 世帯は管理者か、招待枠のある会員が作れる（1世帯につき1回）。家族はその世帯の中に「人」として追加する。
 * ログインは人ごと。ログインを持たない家族（赤ちゃんなど）も登録できる。
 */

type Env = AuthEnv & { PHOTOS?: R2Bucket };
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
		        (SELECT ip.name FROM people ip WHERE ip.id = h.invited_by) AS invited_by_name,
		        a.login_id, a.role, a.disabled, a.last_login_at,
		        (SELECT MAX(expires_at) FROM invites i WHERE i.user_id = p.id AND i.used_at IS NULL AND i.expires_at > ?) AS invite_expires
		 FROM people p JOIN households h ON h.id = p.household_id LEFT JOIN accounts a ON a.user_id = p.id
		 ${householdId ? "WHERE p.household_id = ?" : ""}
		 ORDER BY h.created_at, p.created_at`,
	).bind(...(householdId ? [Date.now(), householdId] : [Date.now()])).all<Body>();
	return (rows.results ?? []).map((r) => ({
		userId: r.user_id, householdId: r.household_id, name: r.name, relation: r.relation, householdName: r.household_name, district: r.district,
		invitedBy: r.invited_by_name ?? null, loginId: r.login_id ?? null, role: r.role ?? null, disabled: !!r.disabled, lastLoginAt: r.last_login_at ?? null, inviteExpiresAt: r.invite_expires ?? null,
	}));
}

// ======================================================================
export async function handleAuth(request: Request, env: Env, url: URL): Promise<Response | null> {
	const path = url.pathname;
	const method = request.method;
	const net = clientNet(request);
	const LOCKED = "ログインに続けて失敗したため、15分ほどロックしています。";
	const BUSY = "アクセスが集中しています。少し時間をおいてから試してください。";

	// ログイン前に使える入口は、D1 に触る前にメモリ上の回数制限で止める（無料枠を使い切らせない）
	if (method === "POST" && /^\/api\/auth\/(setup|login|invite|accept)$/.test(path)) {
		if (!(await edgeAllow(env.RL_AUTH, "auth:" + net)) || !(await edgeAllow(env.RL_AUTH_ALL, "auth"))) return fail(BUSY, 429);
	}

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
		if ((await rateCount(env, "setup:" + net)) >= 10) return fail("しばらく時間をおいてから試してください。", 429);
		if (!(await sameSecret(str(b.setupCode), env.ADMIN_SETUP_CODE))) { await rateHit(env, "setup:" + net); return fail("初期設定コードが違います。", 403); }
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
					.bind(uid, hid, loginId, await hashPassword(env, b.password as string), "admin", now, now),
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
		// 回線（IPv6 は /64）× ログインID ごとに、失敗だけを D1 で数える。回線全体の連打は上のメモリ制限で止める
		const pair = "login:" + net + ":" + (loginId ?? "-");
		const fails = await rateCount(env, pair);
		if (fails >= 10) return fail(LOCKED, 429);
		const acc = loginId
			? await env.DB.prepare("SELECT user_id, password_hash, disabled FROM accounts WHERE login_id = ?").bind(loginId)
				.first<{ user_id: string; password_hash: string; disabled: number }>()
			: null;
		const ok = acc ? await verifyPassword(env, password, acc.password_hash) : (await burnTime(env, password), false);
		if (!acc || !ok) { await rateHit(env, pair); return fail("ログインIDかパスワードが違います。", 401); }
		if (acc.disabled) return fail("このアカウントは利用停止中です。運営にお問い合わせください。", 403);
		if (fails > 0) await clearRate(env, pair);
		// ペッパー導入前のハッシュは、正しいパスワードが分かったこのときに作り直す
		if (needsRehash(env, acc.password_hash)) {
			await env.DB.prepare("UPDATE accounts SET password_hash = ? WHERE user_id = ?").bind(await hashPassword(env, password), acc.user_id).run();
		}
		return json({ ok: true }, 200, { "Set-Cookie": await startSession(env, url, acc.user_id) });
	}

	if (path === "/api/auth/logout" && method === "POST") {
		await destroySession(env, cookieOf(request));
		return json({ ok: true }, 200, { "Set-Cookie": clearCookie(url) });
	}

	// 招待コードの確認（誰あてのコードかを見せる）
	if (path === "/api/auth/invite" && method === "POST") {
		const b = await readBody(request);
		if ((await rateCount(env, "inv:" + net)) >= 30) return fail("しばらく時間をおいてから試してください。", 429);
		const inv = await findInvite(env, b.code);
		if (!inv) { await rateHit(env, "inv:" + net); return fail("招待コードが正しくないか、期限が切れています。", 404); }
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
		if ((await rateCount(env, "inv:" + net)) >= 30) return fail("しばらく時間をおいてから試してください。", 429);
		const inv = await findInvite(env, b.code);
		if (!inv) { await rateHit(env, "inv:" + net); return fail("招待コードが正しくないか、期限が切れています。", 404); }
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
		const hash = await hashPassword(env, b.password as string);
		try {
			if (existing) {
				await env.DB.prepare("UPDATE accounts SET password_hash = ?, session_epoch = session_epoch + 1, updated_at = ? WHERE user_id = ?").bind(hash, now, inv.user_id).run();
			} else {
				await env.DB.batch([
					env.DB.prepare("INSERT INTO accounts (user_id,household_id,login_id,password_hash,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
						.bind(inv.user_id, inv.household_id, loginId, hash, "member", now, now),
					// ログインを持ったので、他の世帯にも名前・写真を見せる（差分同期で配り直す）
					env.DB.prepare("UPDATE people SET updated_at = ? WHERE id = ?").bind(now, inv.user_id),
				]);
			}
		} catch { return fail("このログインIDはすでに使われています。別のIDで、新しい招待コードを発行してもらってください。", 409); }
		return json({ ok: true }, 200, { "Set-Cookie": await startSession(env, url, inv.user_id) });
	}

	if (path === "/api/auth/password" && method === "POST") {
		const s = await currentSession(env, request);
		if (!s) return fail("ログインしてください。", 401);
		if ((await rateCount(env, "pw:" + s.userId)) >= 10) return fail("しばらく時間をおいてから試してください。", 429);
		const b = await readBody(request);
		const acc = await env.DB.prepare("SELECT password_hash FROM accounts WHERE user_id = ?").bind(s.userId).first<{ password_hash: string }>();
		if (!acc || !(await verifyPassword(env, String(b.current ?? ""), acc.password_hash))) { await rateHit(env, "pw:" + s.userId); return fail("今のパスワードが違います。", 403); }
		const pwErr = passwordProblem(b.next);
		if (pwErr) return fail(pwErr);
		await env.DB.prepare("UPDATE accounts SET password_hash = ?, session_epoch = session_epoch + 1, updated_at = ? WHERE user_id = ?")
			.bind(await hashPassword(env, b.next as string), Date.now(), s.userId).run();
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
	// 家族にログインを発行する（まだログインが無い家族だけ）。
	// すでにログインがある家族のパスワード再設定は運営だけ（家族が再設定コードを出すと、その家族になりすませるため）
	if (path === "/api/family/invite" && request.method === "POST") {
		const b = await readBody(request);
		const p = await getPerson(env, str(b.userId));
		if (!p || p.household_id !== s.householdId) return fail("同じ世帯の家族にだけ発行できます。", 403);
		if (p.id === s.userId) return fail("自分のパスワードは「パスワードを変更」から変えてください。");
		const acc = await env.DB.prepare("SELECT 1 AS x FROM accounts WHERE user_id = ?").bind(p.id).first();
		if (acc) return fail("すでにログインがある家族のパスワード再設定は、運営に依頼してください。", 403);
		return json(await issueInvite(env, p, s.userId));
	}
	return fail("not found", 404);
}

// ======================================================================
/** 会員1人が招待できる世帯の数（管理者は上限なし）。招待した世帯が削除されると枠は戻る */
export const HOUSEHOLD_INVITES_PER_PERSON = 3;

/**
 * 新しい世帯を作り、世帯主あての招待コードを発行する（管理者・会員共通）。
 * 同じ世帯の二重登録を防ぐ確認つき。会員の招待枠は、同時に送られても超えないよう1文で数えて作る
 */
async function createHousehold(env: Env, s: Session, b: Body) {
	const admin = s.role === "admin";
	const headName = str(b.headName, 100);
	if (!headName) return fail("世帯主の氏名を入力してください。");
	const name = defaultHouseholdName(str(b.name, 100), headName);
	const district = str(b.district, 100);
	const compact = (v: string) => v.replace(/[\s　]/g, "");
	if (b.force !== true) {
		// 書き方の違い（空白・「家」の有無）を無視して、世帯主の名前か世帯名が同じなら確認する。
		// 夫婦が別々に招待されて1つの家族が2世帯に分かれるのを防ぐため、地区は問わない
		const base = (v: string) => compact(v).replace(/家$/, "");
		const dup = await env.DB.prepare(
			`SELECT h.name, h.district, p.name AS head FROM households h LEFT JOIN people p ON p.household_id = h.id AND p.relation = '世帯主'
			 WHERE replace(replace(p.name,' ',''),'　','') = ?
			    OR rtrim(replace(replace(h.name,' ',''),'　',''), '家') = ?
			 LIMIT 1`,
		).bind(compact(headName), base(name)).first<Body>();
		// 会員には、まだ登録していない世帯主の名前などを見せない
		if (dup) return fail(`同じ世帯がすでに登録されているかもしれません（${dup.name}${admin ? "・世帯主 " + (dup.head ?? "—") : ""}${dup.district ? "・" + dup.district : ""}）。家族の追加はその世帯の中で行ってください。`, 409, { duplicate: true });
	}
	const hid = newId("h_");
	const uid = newId("u_");
	const now = Date.now();
	const limit = admin ? 1_000_000 : HOUSEHOLD_INVITES_PER_PERSON;
	const [made] = await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO households (id,name,head_name,head_birth,district,note,members,invited_by,created_at,updated_at)
			 SELECT ?,?,'','',?,'','[]',?,?,? WHERE (SELECT COUNT(*) FROM households WHERE invited_by = ?) < ?`,
		).bind(hid, name, district, s.userId, now, now, s.userId, limit),
		env.DB.prepare(
			`INSERT INTO people (id,household_id,name,relation,birth_year,created_at,updated_at)
			 SELECT ?,?,?,'世帯主','',?,? WHERE EXISTS (SELECT 1 FROM households WHERE id = ?)`,
		).bind(uid, hid, headName, now, now, hid),
	]);
	if (!made.meta.changes) return fail(`招待できる世帯は1人${HOUSEHOLD_INVITES_PER_PERSON}世帯までです。`, 403);
	const inv = await issueInvite(env, { id: uid, household_id: hid, name: headName, relation: "世帯主" }, s.userId);
	return json({ householdId: hid, userId: uid, name, ...inv });
}

/** 自分が招待した世帯の一覧と、残りの招待枠 */
async function myHouseholdInvites(env: Env, s: Session) {
	const rows = await env.DB.prepare(
		// 世帯主の続柄はあとから入れ替えられるので、「最初に登録された人（招待した相手）」と「世帯に誰かログインがあるか」で見る
		`SELECT h.id, h.name, h.district, h.created_at,
		        (SELECT p.id FROM people p WHERE p.household_id = h.id ORDER BY p.created_at, p.id LIMIT 1) AS head_id,
		        (SELECT p.name FROM people p WHERE p.household_id = h.id AND p.relation = '世帯主' ORDER BY p.created_at LIMIT 1) AS head,
		        EXISTS (SELECT 1 FROM accounts a WHERE a.household_id = h.id) AS registered,
		        (SELECT MAX(expires_at) FROM invites i WHERE i.household_id = h.id AND i.used_at IS NULL AND i.expires_at > ?) AS invite_expires
		 FROM households h
		 WHERE h.invited_by = ? ORDER BY h.created_at DESC`,
	).bind(Date.now(), s.userId).all<Body>();
	const list = (rows.results ?? []).map((r) => ({
		householdId: r.id, name: r.name, district: r.district, headId: r.head_id ?? null, headName: r.head ?? "—",
		registered: !!r.registered, inviteExpiresAt: r.invite_expires ?? null, createdAt: r.created_at,
	}));
	const admin = s.role === "admin";
	return { list, limit: admin ? null : HOUSEHOLD_INVITES_PER_PERSON, remaining: admin ? null : Math.max(0, HOUSEHOLD_INVITES_PER_PERSON - list.length) };
}

export async function handleInvites(request: Request, env: Env, url: URL, s: Session): Promise<Response | null> {
	const path = url.pathname;
	if (!path.startsWith("/api/invites/")) return null;

	if (path === "/api/invites/households" && request.method === "GET") return json(await myHouseholdInvites(env, s));
	if (path === "/api/invites/households" && request.method === "POST") {
		// 作りすぎ・総当たりを防ぐ（1日20回まで。重複確認で弾かれた分も数える）
		if (await rateLimit(env, "hhinv:" + s.userId, 20, 24 * 60 * 60)) return fail("今日はこれ以上招待できません。明日また試してください。", 429);
		return createHousehold(env, s, await readBody(request));
	}
	// 自分が招待した世帯が、まだ誰も登録していないときだけ、招待した相手（最初に登録された人）あてに出し直せる。
	// 世帯の誰かが登録したあとは出せない（招待した人がその世帯の別の家族のログインを作れてしまうため）
	if (path === "/api/invites/reissue" && request.method === "POST") {
		const b = await readBody(request);
		const row = await env.DB.prepare(
			`SELECT p.id, p.household_id, p.name, p.relation FROM households h JOIN people p ON p.household_id = h.id
			 WHERE h.id = ? AND h.invited_by = ? ORDER BY p.created_at, p.id LIMIT 1`,
		).bind(str(b.householdId), s.userId).first<Person>();
		if (!row) return fail("あなたが招待した世帯ではありません。", 403);
		const acc = await env.DB.prepare("SELECT 1 AS x FROM accounts WHERE household_id = ?").bind(row.household_id).first();
		if (acc) return fail("この世帯はすでに登録が済んでいます。", 409);
		return json(await issueInvite(env, row, s.userId));
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
		return createHousehold(env, s, await readBody(request));
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

	// 世帯をまるごと削除（テスト用の世帯の片付けなど）。自分の世帯は消せない
	// confirm が true でなければ、消える件数だけを返す
	if (path === "/api/admin/household/delete" && request.method === "POST") {
		const b = await readBody(request);
		const hid = str(b.householdId);
		if (!SAFE_ID.test(hid)) return fail("世帯が見つかりません。", 404);
		if (hid === s.householdId) return fail("自分の世帯は削除できません。");
		const h = await env.DB.prepare("SELECT id, name FROM households WHERE id = ?").bind(hid).first<{ id: string; name: string }>();
		if (!h) return fail("世帯が見つかりません。", 404);
		const summary = await householdFootprint(env, hid);
		if (b.confirm !== true) return json({ name: h.name, ...summary.counts }, 200, { "X-Kaga-Dry-Run": "1" });
		const now = Date.now();
		await env.DB.batch(deleteHouseholdStatements(env, hid, now));
		if (env.PHOTOS && summary.photos.length) {
			const keys = summary.photos.map((id) => "photos/" + id);
			for (let i = 0; i < keys.length; i += 1000) { try { await env.PHOTOS.delete(keys.slice(i, i + 1000)); } catch (e) { console.error(e); } }
		}
		return json({ ok: true, name: h.name, ...summary.counts });
	}

	// 世帯の統合：from の家族・ログイン・招待・参加表明を into に移し、from を消す。
	// 仕事・出品・投稿・相談・石の流通は「人」の名義なので、そのまま into の家族のものになる。
	// confirm が true でなければ、移る内容だけを返す
	if (path === "/api/admin/household/merge" && request.method === "POST") {
		const b = await readBody(request);
		const from = str(b.from), into = str(b.into);
		if (!SAFE_ID.test(from) || !SAFE_ID.test(into) || from === into) return fail("統合する世帯を選んでください。");
		const hs = await env.DB.prepare("SELECT id, name FROM households WHERE id IN (?, ?)").bind(from, into).all<{ id: string; name: string }>();
		const fromH = hs.results?.find((h) => h.id === from), intoH = hs.results?.find((h) => h.id === into);
		if (!fromH || !intoH) return fail("世帯が見つかりません。", 404);
		const people = (await env.DB.prepare("SELECT name, relation FROM people WHERE household_id = ? ORDER BY created_at").bind(from).all<{ name: string; relation: string }>()).results ?? [];
		const intoHasHead = !!(await env.DB.prepare("SELECT 1 AS x FROM people WHERE household_id = ? AND relation = '世帯主'").bind(into).first());
		const info = { from: fromH.name, into: intoH.name, people: people.map((p) => p.name), headBecomes: intoHasHead && people.some((p) => p.relation === "世帯主") ? "配偶者" : null };
		if (b.confirm !== true) return json(info, 200, { "X-Kaga-Dry-Run": "1" });
		const now = Date.now();
		const q = (sql: string, ...binds: unknown[]) => env.DB.prepare(sql).bind(...binds);
		await env.DB.batch([
			// 世帯主は1人に（統合先に世帯主がいれば、移ってくる世帯主は「配偶者」に。あとで家族が変えられる）
			q(`UPDATE people SET relation = '配偶者' WHERE household_id = ? AND relation = '世帯主' AND EXISTS (SELECT 1 FROM people WHERE household_id = ? AND relation = '世帯主')`, from, into),
			q("UPDATE people SET household_id = ?, updated_at = ? WHERE household_id = ?", into, now, from),
			q("UPDATE accounts SET household_id = ?, updated_at = ? WHERE household_id = ?", into, now, from),
			q("UPDATE invites SET household_id = ? WHERE household_id = ?", into, from),
			// 参加表明は世帯単位。統合先がまだ表明していないイベントだけ引き継ぐ
			q(`INSERT OR IGNORE INTO rsvps (post_id, household_id, status, people, updated_at) SELECT post_id, ?, status, people, ? FROM rsvps WHERE household_id = ?`, into, now, from),
			q(`INSERT OR REPLACE INTO tombstones (tbl, id, deleted_at) SELECT 'rsvps', post_id || '|' || household_id, ? FROM rsvps WHERE household_id = ?`, now, from),
			q("DELETE FROM rsvps WHERE household_id = ?", from),
			// 統合元の世帯のメモは、統合先が空なら引き継ぐ
			q(`UPDATE households SET note = CASE WHEN note = '' THEN (SELECT note FROM households WHERE id = ?) ELSE note END, updated_at = ? WHERE id = ?`, from, now, into),
			q("INSERT OR REPLACE INTO tombstones (tbl, id, deleted_at) VALUES ('households', ?, ?)", from, now),
			q("DELETE FROM households WHERE id = ?", from),
		]);
		return json({ ok: true, ...info });
	}

	return fail("not found", 404);
}

// ---------- 世帯の削除 ----------
// 世帯の人（P）と、その人たちが関わる相談（T）
const P = "(SELECT id FROM people WHERE household_id = ?1)";
const T = `(SELECT id FROM threads WHERE owner IN ${P} OR other IN ${P})`;
const PHOTO_ID = /^[A-Za-z0-9_-]{1,80}$/;

/** 消える件数と、R2 から消す写真 */
async function householdFootprint(env: Env, hid: string) {
	const c = (sql: string) => env.DB.prepare(`SELECT COUNT(*) AS n FROM ${sql}`).bind(hid);
	const [people, logins, jobs, items, posts, threads, ledger, pics] = await env.DB.batch([
		c("people WHERE household_id = ?1"),
		c("accounts WHERE household_id = ?1"),
		c(`jobs WHERE owner IN ${P}`),
		c(`items WHERE owner IN ${P}`),
		c(`posts WHERE owner IN ${P}`),
		c(`threads WHERE id IN ${T}`),
		c(`ledger WHERE payer IN ${P} OR payee IN ${P}`),
		env.DB.prepare(
			`SELECT j.value AS id FROM items i, json_each(i.photos) j WHERE i.owner IN ${P}
			 UNION SELECT photo FROM posts WHERE owner IN ${P} AND photo IS NOT NULL
			 UNION SELECT avatar FROM people WHERE household_id = ?1 AND avatar IS NOT NULL`,
		).bind(hid),
	]);
	const n = (r: D1Result) => Number((r.results?.[0] as { n?: number } | undefined)?.n ?? 0);
	return {
		counts: { people: n(people), logins: n(logins), jobs: n(jobs), items: n(items), posts: n(posts), threads: n(threads), ledger: n(ledger) },
		photos: ((pics.results ?? []) as { id: unknown }[]).map((r) => String(r.id)).filter((id) => PHOTO_ID.test(id)),
	};
}

/**
 * 世帯と、その世帯の人が持つものをすべて消す（1つのトランザクション）。
 * ほかの人の画面からも消えるように、消した行は tombstones に記録する。
 * ログイン中の端末は、アカウントが無くなるので次の通信でログアウトになる。
 */
function deleteHouseholdStatements(env: Env, hid: string, now: number) {
	const q = (sql: string) => env.DB.prepare(sql).bind(hid);
	const tomb = (tbl: string, idExpr: string, from: string) =>
		env.DB.prepare(`INSERT OR REPLACE INTO tombstones (tbl, id, deleted_at) SELECT '${tbl}', ${idExpr}, ?2 FROM ${from}`).bind(hid, now);
	return [
		// 相談とメッセージ（メッセージは相談IDで消したことを伝える）
		tomb("threads", "id", `threads WHERE id IN ${T}`),
		tomb("messages", "id", `threads WHERE id IN ${T}`),
		q(`DELETE FROM messages WHERE thread_id IN ${T}`),
		q(`DELETE FROM reads WHERE thread_id IN ${T} OR user_id IN ${P}`),
		q(`DELETE FROM threads WHERE id IN ${T}`),
		// イベントの参加表明（この世帯の表明と、この世帯のイベントへの表明）
		tomb("rsvps", "post_id || '|' || household_id", `rsvps WHERE household_id = ?1 OR post_id IN (SELECT id FROM posts WHERE owner IN ${P})`),
		q(`DELETE FROM rsvps WHERE (household_id = ?1 OR post_id IN (SELECT id FROM posts WHERE owner IN ${P}))`),
		// 仕事・出品・情報・石の記録
		...(["jobs", "items", "posts"] as const).flatMap((t) => [
			tomb(t, "id", `${t} WHERE owner IN ${P}`),
			q(`DELETE FROM ${t} WHERE owner IN ${P}`),
		]),
		tomb("ledger", "id", `ledger WHERE payer IN ${P} OR payee IN ${P}`),
		q(`DELETE FROM ledger WHERE payer IN ${P} OR payee IN ${P}`),
		// ログイン・招待・既読時刻
		q(`DELETE FROM seen WHERE user_id IN ${P}`),
		q("DELETE FROM invites WHERE household_id = ?1"),
		q("DELETE FROM accounts WHERE household_id = ?1"),
		// 人と世帯
		tomb("people", "id", "people WHERE household_id = ?1"),
		q("DELETE FROM people WHERE household_id = ?1"),
		tomb("households", "id", "households WHERE id = ?1"),
		q("DELETE FROM households WHERE id = ?1"),
	];
}
