/**
 * D1 とのやり取り
 * - sync:  指定時刻より後に変わった行だけを返す（差分同期）
 * - ops:   画面から届いた変更（追加・更新・削除）を SQL にして実行する
 *
 * 画面側のデータ形（camelCase）と D1 の列（snake_case）の変換もここで行う。
 */

type Row = Record<string, unknown>;
type Doc = Record<string, unknown>;

const SAFE_ID = /^[A-Za-z0-9_\-:.]{1,200}$/;
const str = (v: unknown, max = 5000) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null);
const intOr = (v: unknown, d: number) => int(v) ?? d;
const bool = (v: unknown) => (v ? 1 : 0);
const parseArr = (v: unknown) => { try { const x = JSON.parse(String(v ?? "[]")); return Array.isArray(x) ? x : []; } catch { return []; } };
const ok = (id: unknown): id is string => typeof id === "string" && SAFE_ID.test(id);
const STONE_MAX = 1_000_000;
const PEOPLE_MAX = 40;
const CONTENT_MAX = 200;
const PHOTO_ID = /^[A-Za-z0-9_-]{1,80}$/;
const stone = (v: unknown) => Math.min(STONE_MAX, Math.max(0, intOr(v, 0)));
const stoneOrNull = (v: unknown) => { const n = int(v); return n === null ? null : Math.min(STONE_MAX, Math.max(0, n)); };
/** http / https だけ通す。javascript: などは空にする */
function httpUrl(v: unknown, max = 500) {
	const s = str(v, max);
	if (!s) return "";
	try {
		const u = new URL(s);
		if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) return "";
		return u.href;
	} catch { return ""; }
}
function photoList(v: unknown) {
	const ids = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && PHOTO_ID.test(x)).slice(0, 6) : [];
	return JSON.stringify(ids);
}
function shortList(v: unknown, maxItems: number, maxLen: number) {
	const xs = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, maxLen)).filter(Boolean).slice(0, maxItems) : [];
	return JSON.stringify(xs);
}
/** フリマの払い方。値段の入れ方と食い違うときは、入っている値段に合わせる */
function payModeOf(d: Doc) {
	const st = stoneOrNull(d.priceStone) !== null, yen = stoneOrNull(d.priceYen) !== null;
	const m = String(d.payMode);
	if (st && yen) return m === "both" ? "both" : "either";
	return yen ? "yen" : "stone";
}
/** 予定の日付（YYYY-MM-DD）。形が違えば日付なし */
const plausibleEvDate = (v: unknown) => { const s = str(v, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
/** 流通の日付。未来すぎる日や壊れた文字列は拒否する */
function plausibleDate(v: unknown) {
	const s = String(v ?? "");
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
	const t = Date.parse(s + "T00:00:00Z");
	return Number.isFinite(t) && t >= Date.parse("2020-01-01T00:00:00Z") && t <= Date.now() + 36 * 60 * 60 * 1000;
}

// ---------- 行 → 画面のデータ ----------
const toDoc = {
	households: (r: Row) => ({ id: r.id, name: r.name, district: r.district, note: r.note, createdAt: r.created_at, updatedAt: r.updated_at }),
	people: (r: Row) => ({ id: r.id, householdId: r.household_id, name: r.name, relation: r.relation, birthYear: r.birth_year, avatar: r.avatar ?? null, createdAt: r.created_at, updatedAt: r.updated_at }),
	jobs: (r: Row) => ({ id: r.id, owner: r.owner, type: r.type === "request" ? "request" : "offer", wantDate: r.want_date ?? "", title: r.title, desc: r.description, price: r.price, negotiable: !!r.negotiable, active: !!r.active, createdAt: r.created_at, updatedAt: r.updated_at }),
	items: (r: Row) => ({ id: r.id, owner: r.owner, name: r.name, desc: r.description, priceStone: r.price_stone, priceYen: r.price_yen, payMode: r.pay_mode ?? null, photos: parseArr(r.photos), status: r.status, ...(r.buyer ? { buyer: r.buyer } : {}), ...(r.done_at ? { doneAt: r.done_at } : {}), createdAt: r.created_at, updatedAt: r.updated_at }),
	posts: (r: Row) => ({
		id: r.id, owner: r.owner, cat: r.cat, kind: r.kind, title: r.title, body: r.body, link: r.link, targets: parseArr(r.targets), photo: r.photo ?? null,
		rsvpOn: r.rsvp_on === null || r.rsvp_on === undefined ? r.cat === "event" : !!r.rsvp_on, rsvpClosed: !!r.rsvp_closed,
		event: r.cat === "event" || r.ev_date || r.ev_start || r.ev_place ? { date: r.ev_date ?? "", start: r.ev_start ?? "", end: r.ev_end ?? "", place: r.ev_place ?? "", capacity: r.ev_capacity ?? null, bring: r.ev_bring ?? "" } : null,
		createdAt: r.created_at, updatedAt: r.updated_at,
	}),
	rsvps: (r: Row) => ({ postId: r.post_id, householdId: r.household_id, s: r.status, n: r.people, at: r.updated_at, by: r.by_user ?? null }),
	threads: (r: Row) => ({ id: r.id, kind: r.kind, refId: r.ref_id, owner: r.owner, other: r.other, title: r.title, lastAt: r.last_at, lastBy: r.last_by ?? null, lastText: r.last_text, createdAt: r.created_at }),
	messages: (r: Row) => ({ id: r.id, threadId: r.thread_id, from: r.sender, text: r.text, sys: !!r.sys, t: r.sent_at }),
	reads: (r: Row) => ({ userId: r.user_id, threadId: r.thread_id, at: r.read_at }),
	seen: (r: Row) => ({ userId: r.user_id, at: r.seen_at }),
	ledger: (r: Row) => ({ id: r.id, date: r.date, kind: r.kind, refId: r.ref_id, tid: r.thread_id, from: r.payer, to: r.payee, amount: r.amount, title: r.title, by: r.recorded_by, at: r.recorded_at }),
};
export type Table = keyof typeof toDoc;

/**
 * since（ミリ秒）より後に変わった行を返す。
 * 相談・メッセージ・既読・石の流通は、ログイン中の人（me）が関わるものだけを返す（石の流通は管理者なら全件）。
 */
export async function sync(db: D1Database, since: number, me: string | null, myHome: string | null, isAdmin = false) {
	const now = Date.now();
	const mine = ok(me) ? me : "";
	const home = ok(myHome) ? myHome : "";
	const q = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds);
	const res = await db.batch([
		q("SELECT * FROM households WHERE updated_at > ?", since),
		q("SELECT p.*, (a.user_id IS NOT NULL) AS has_login FROM people p LEFT JOIN accounts a ON a.user_id = p.id WHERE p.updated_at > ?", since),
		q("SELECT * FROM jobs WHERE updated_at > ?", since),
		q("SELECT * FROM items WHERE updated_at > ?", since),
		q("SELECT * FROM posts WHERE updated_at > ?", since),
		q("SELECT * FROM rsvps WHERE updated_at > ?", since),
		q("SELECT * FROM threads WHERE updated_at > ? AND (owner = ? OR other = ?)", since, mine, mine),
		q(`SELECT m.* FROM messages m JOIN threads t ON t.id = m.thread_id
		   WHERE m.updated_at > ? AND (t.owner = ? OR t.other = ?)`, since, mine, mine),
		q("SELECT * FROM reads WHERE updated_at > ? AND user_id = ?", since, mine),
		q("SELECT * FROM seen WHERE updated_at > ? AND user_id = ?", since, mine),
		// 石の流通は、管理者には全件、ほかの人には自分が当事者の相談の分だけ
		isAdmin
			? q("SELECT * FROM ledger WHERE updated_at > ?", since)
			: q(`SELECT * FROM ledger WHERE updated_at > ? AND (payer = ? OR payee = ? OR thread_id IN (SELECT id FROM threads WHERE owner = ? OR other = ?))`, since, mine, mine, mine, mine),
		q("SELECT tbl, id FROM tombstones WHERE deleted_at > ?", since),
	]);
	const tables: Table[] = ["households", "people", "jobs", "items", "posts", "rsvps", "threads", "messages", "reads", "seen", "ledger"];
	const rows: Record<string, unknown[]> = {};
	tables.forEach((t, i) => {
		const conv = toDoc[t] as (r: Row) => Doc;
		rows[t] = ((res[i].results ?? []) as Row[]).map((r) => {
			const doc = conv(r);
			// 連絡メモ・生まれ年・続柄は自分の世帯だけ。画面でも他世帯には出していない
			if (t === "households" && doc.id !== home) doc.note = "";
			if (t === "people" && doc.householdId !== home) {
				doc.birthYear = "";
				doc.relation = "";
				// ログインの無い家族（赤ちゃん・子どもなど）は、他の世帯には名前も写真も出さない（人数にだけ数える）
				if (!r.has_login) { doc.name = ""; doc.avatar = null; }
			}
			return doc;
		});
	});
	const deleted = (res[11].results ?? []) as { tbl: string; id: string }[];
	return { now, rows, deleted };
}

// ---------- 画面からの変更 → SQL ----------
export type Op =
	| { t: "upsert"; tbl: "households" | "people" | "jobs" | "items" | "posts" | "threads" | "ledger"; doc: Doc }
	| { t: "message"; doc: Doc }
	| { t: "rsvp"; postId: string; householdId: string; s: "go" | "maybe"; n: number; by?: string }
	| { t: "unrsvp"; postId: string; householdId: string }
	| { t: "read"; userId: string; threadId: string; at: number }
	| { t: "seen"; userId: string; at: number }
	| { t: "delete"; tbl: "people" | "jobs" | "items" | "posts" | "ledger"; id: string };

const DELETABLE = new Set(["people", "jobs", "items", "posts", "ledger"]);

export function buildStatements(db: D1Database, ops: Op[], now: number): D1PreparedStatement[] {
	const out: D1PreparedStatement[] = [];
	const p = (sql: string, ...b: unknown[]) => out.push(db.prepare(sql).bind(...b));
	const untomb = (tbl: string, id: string) => p("DELETE FROM tombstones WHERE tbl = ? AND id = ?", tbl, id);

	for (const op of ops.slice(0, 200)) {
		if (op.t === "upsert") {
			const d = op.doc ?? {};
			if (!ok(d.id)) continue;
			const created = intOr(d.createdAt, now);
			switch (op.tbl) {
				case "households":
					// 世帯は管理者だけが作る。ここでは名前・地区・メモの更新だけ
					p("UPDATE households SET name = ?, district = ?, note = ?, updated_at = ? WHERE id = ?",
						str(d.name, 100) || "世帯", str(d.district, 100), str(d.note, 1000), now, d.id);
					break;
				case "people":
					if (!ok(d.householdId) || !str(d.name, 100)) continue;
					// 世帯（household_id）は後から変えられない
					p(`INSERT INTO people (id,household_id,name,relation,birth_year,avatar,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)
					   ON CONFLICT(id) DO UPDATE SET name=excluded.name, relation=excluded.relation, birth_year=excluded.birth_year, avatar=excluded.avatar, updated_at=excluded.updated_at`,
					d.id, d.householdId, str(d.name, 100), str(d.relation, 20), str(d.birthYear, 10), ok(d.avatar) ? d.avatar : null, created, now);
					break;
				case "jobs":
					if (!ok(d.owner)) continue;
					// type（できること／お願い）は作ったときだけ決まる。あとから変えると相談の立場（石の流れ）が逆になるため
					p(`INSERT INTO jobs (id,owner,type,want_date,title,description,price,negotiable,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
					   ON CONFLICT(id) DO UPDATE SET want_date=excluded.want_date, title=excluded.title, description=excluded.description, price=excluded.price,
					   negotiable=excluded.negotiable, active=excluded.active, updated_at=excluded.updated_at`,
					d.id, d.owner, d.type === "request" ? "request" : "offer", d.type === "request" ? plausibleEvDate(d.wantDate) : null,
					str(d.title, 100), str(d.desc), stone(d.price), bool(d.negotiable), bool(d.active), created, now);
					break;
				case "items":
					if (!ok(d.owner)) continue;
					p(`INSERT INTO items (id,owner,name,description,price_stone,price_yen,pay_mode,photos,status,buyer,done_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
					   ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, price_stone=excluded.price_stone,
					   price_yen=excluded.price_yen, pay_mode=excluded.pay_mode, photos=excluded.photos, status=excluded.status, buyer=excluded.buyer, done_at=excluded.done_at, updated_at=excluded.updated_at`,
					d.id, d.owner, str(d.name, 100), str(d.desc), stoneOrNull(d.priceStone), stoneOrNull(d.priceYen), payModeOf(d), photoList(d.photos),
					["open", "nego", "done"].includes(String(d.status)) ? d.status : "open", ok(d.buyer) ? d.buyer : null, int(d.doneAt), created, now);
					break;
				case "posts": {
					if (!ok(d.owner) || !["farm", "edu", "bousai", "event"].includes(String(d.cat))) continue;
					const ev = (d.event && typeof d.event === "object" ? d.event : {}) as Doc;
					const isEv = d.cat === "event";
					const cap = int(ev.capacity);
					// 参加の受付：地域イベントは既定で受け付け。それ以外は投稿者がオンにしたときだけ
					const rsvpOn = typeof d.rsvpOn === "boolean" ? d.rsvpOn : isEv;
					p(`INSERT INTO posts (id,owner,cat,kind,title,body,link,targets,photo,ev_date,ev_start,ev_end,ev_place,ev_capacity,ev_bring,rsvp_on,rsvp_closed,created_at,updated_at)
					   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
					   ON CONFLICT(id) DO UPDATE SET cat=excluded.cat, kind=excluded.kind, title=excluded.title, body=excluded.body, link=excluded.link,
					   targets=excluded.targets, photo=excluded.photo, ev_date=excluded.ev_date, ev_start=excluded.ev_start, ev_end=excluded.ev_end,
					   ev_place=excluded.ev_place, ev_capacity=excluded.ev_capacity, ev_bring=excluded.ev_bring, rsvp_on=excluded.rsvp_on, rsvp_closed=excluded.rsvp_closed, updated_at=excluded.updated_at`,
					d.id, d.owner, d.cat, str(d.kind, 50), str(d.title, 120), str(d.body), httpUrl(d.link), shortList(d.targets, 12, 40), ok(d.photo) ? d.photo : null,
					// 日付・時間・場所はどの分類でも（任意）。定員・持ち物は地域イベントだけ
					plausibleEvDate(ev.date), str(ev.start, 5), str(ev.end, 5),
					str(ev.place, 200), (isEv || rsvpOn) && cap !== null ? Math.min(10000, Math.max(0, cap)) : null, isEv ? str(ev.bring, 200) : null,
					rsvpOn ? 1 : 0, rsvpOn && d.rsvpClosed ? 1 : 0, created, now);
					break;
				}
				case "threads":
					if (!ok(d.owner) || !ok(d.other) || !ok(d.refId) || !["job", "item", "info"].includes(String(d.kind))) continue;
					// プレビュー文はメッセージ保存時だけ更新する。クライアントの lastText は信用しない
					p(`INSERT INTO threads (id,kind,ref_id,owner,other,title,last_at,last_by,last_text,created_at,updated_at) VALUES (?,?,?,?,?,?,0,NULL,'',?,?)
					   ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at`,
					d.id, d.kind, d.refId, d.owner, d.other, str(d.title, 120), created, now);
					break;
				case "ledger":
					if (!ok(d.from) || !ok(d.to) || !ok(d.tid) || !ok(d.refId) || !["job", "item"].includes(String(d.kind))) continue;
					if (!plausibleDate(d.date)) continue;
					// 既存の行は書き換えない（金額の改ざんを防ぐ）。同じ内容の再送は無視される
					p(`INSERT OR IGNORE INTO ledger (id,date,kind,ref_id,thread_id,payer,payee,amount,title,recorded_by,recorded_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
					d.id, d.date, d.kind, d.refId, d.tid, d.from, d.to, stone(d.amount), str(d.title, 120), ok(d.by) ? d.by : "", intOr(d.at, now), now);
					break;
			}
			untomb(op.tbl, d.id as string);
		} else if (op.t === "message") {
			const d = op.doc ?? {};
			if (!ok(d.id) || !ok(d.threadId) || !ok(d.from) || typeof d.text !== "string" || !d.text) continue;
			const text = str(d.text, 4000);
			const preview = text.replace(/\s+/g, " ").slice(0, 300);
			// 時刻はサーバーのものだけ使う。未来の時刻でプレビューを固定できない
			p("INSERT OR IGNORE INTO messages (id,thread_id,sender,text,sys,sent_at,updated_at) VALUES (?,?,?,?,0,?,?)",
				d.id, d.threadId, d.from, text, now, now);
			p(`UPDATE threads SET
			   last_by = CASE WHEN ? >= threads.last_at THEN ? ELSE threads.last_by END,
			   last_text = CASE WHEN ? >= threads.last_at THEN ? ELSE threads.last_text END,
			   last_at = MAX(threads.last_at, ?), updated_at = ? WHERE id = ?`,
			now, d.from, now, preview, now, now, d.threadId);
		} else if (op.t === "rsvp") {
			if (!ok(op.postId) || !ok(op.householdId) || !["go", "maybe"].includes(op.s)) continue;
			p(`INSERT INTO rsvps (post_id,household_id,status,people,by_user,updated_at) VALUES (?,?,?,?,?,?)
			   ON CONFLICT(post_id,household_id) DO UPDATE SET status=excluded.status, people=excluded.people, by_user=excluded.by_user, updated_at=excluded.updated_at`,
			op.postId, op.householdId, op.s, Math.min(20, Math.max(op.s === "go" ? 1 : 0, intOr(op.n, 1))), ok(op.by) ? op.by : null, now);
			untomb("rsvps", `${op.postId}|${op.householdId}`);
		} else if (op.t === "unrsvp") {
			if (!ok(op.postId) || !ok(op.householdId)) continue;
			p("DELETE FROM rsvps WHERE post_id = ? AND household_id = ?", op.postId, op.householdId);
			p("INSERT OR REPLACE INTO tombstones (tbl,id,deleted_at) VALUES ('rsvps',?,?)", `${op.postId}|${op.householdId}`, now);
		} else if (op.t === "read") {
			if (!ok(op.userId) || !ok(op.threadId)) continue;
			const at = Math.min(now, Math.max(0, intOr(op.at, now)));
			p(`INSERT INTO reads (user_id,thread_id,read_at,updated_at) VALUES (?,?,?,?)
			   ON CONFLICT(user_id,thread_id) DO UPDATE SET read_at=MAX(reads.read_at, excluded.read_at), updated_at=excluded.updated_at`,
			op.userId, op.threadId, at, now);
		} else if (op.t === "seen") {
			if (!ok(op.userId)) continue;
			const at = Math.min(now, Math.max(0, intOr(op.at, now)));
			p(`INSERT INTO seen (user_id,seen_at,updated_at) VALUES (?,?,?)
			   ON CONFLICT(user_id) DO UPDATE SET seen_at=MAX(seen.seen_at, excluded.seen_at), updated_at=excluded.updated_at`,
			op.userId, at, now);
		} else if (op.t === "delete") {
			if (!DELETABLE.has(op.tbl) || !ok(op.id)) continue;
			p(`DELETE FROM ${op.tbl} WHERE id = ?`, op.id);
			if (op.tbl === "people") p("UPDATE invites SET used_at = ? WHERE user_id = ? AND used_at IS NULL", now, op.id);
			if (op.tbl === "posts") p("DELETE FROM rsvps WHERE post_id = ?", op.id);
			p("INSERT OR REPLACE INTO tombstones (tbl,id,deleted_at) VALUES (?,?,?)", op.tbl, op.id, now);
		}
	}
	return out;
}

// ---------- 権限チェック ----------
type Who = { userId: string; householdId: string; role: "member" | "admin" };
type RefRow = { id: string; owner: string; title: string; cat: string | null; rsvp_on?: number | null; rsvp_closed?: number };
type ThreadRow = { id: string; kind: string; ref_id?: string; owner: string; other: string };
type LedgerRow = { id: string; thread_id: string; kind: string; payer: string; payee: string; amount: number; date: string; title: string; recorded_by: string };

async function selectIn<T>(db: D1Database, sql: (ph: string) => string, ids: string[]): Promise<T[]> {
	const out: T[] = [];
	for (let i = 0; i < ids.length; i += 90) {
		const chunk = ids.slice(i, i + 90);
		const r = await db.prepare(sql(chunk.map(() => "?").join(","))).bind(...chunk).all<T>();
		out.push(...(r.results ?? []));
	}
	return out;
}

/**
 * ログイン中の人に許される操作だけを残す。
 * - 世帯情報・家族の登録：自分の世帯だけ（管理者は全世帯）。ログインを持つ家族は消せない
 * - 仕事・出品・投稿：自分が出したものだけ（管理者は削除・編集も可）
 * - 相談・メッセージ：自分が当事者のスレッドだけ。送信者は自分
 * - 石の流通：当事者だけ。フリマの成立は出品者だけ
 * - 参加表明：自分の世帯の分だけ ／ 既読：自分の分だけ
 */
export async function authorize(db: D1Database, ops: Op[], who: Who): Promise<Op[]> {
	const me = who.userId;
	const myHome = who.householdId;
	const admin = who.role === "admin";
	// 家族（people）の持ち主の世帯と、ログインの有無
	const personIds = [...new Set(ops.flatMap((op) => (op.t === "upsert" && op.tbl === "people" && ok(op.doc?.id) ? [op.doc.id as string] : op.t === "delete" && op.tbl === "people" && ok(op.id) ? [op.id] : [])))];
	const [peopleRows, accountRows] = await Promise.all([
		selectIn<{ id: string; household_id: string }>(db, (p) => `SELECT id, household_id FROM people WHERE id IN (${p})`, personIds),
		selectIn<{ user_id: string }>(db, (p) => `SELECT user_id FROM accounts WHERE user_id IN (${p})`, personIds),
	]);
	const personHome = new Map(peopleRows.map((r) => [r.id, r.household_id]));
	const hasLogin = new Set(accountRows.map((r) => r.user_id));
	const newHomes = [...new Set(ops.flatMap((op) => (op.t === "upsert" && op.tbl === "people" && ok(op.doc?.id) && !personHome.has(op.doc.id as string) && ok(op.doc.householdId) ? [op.doc.householdId as string] : [])))];
	const homeRows = await selectIn<{ household_id: string; n: number }>(db, (p) => `SELECT household_id, COUNT(*) AS n FROM people WHERE household_id IN (${p}) GROUP BY household_id`, newHomes);
	const homeCount = new Map(homeRows.map((r) => [r.household_id, Number(r.n)]));
	const ids = { jobs: new Set<string>(), items: new Set<string>(), posts: new Set<string>(), threads: new Set<string>(), ledger: new Set<string>() };
	for (const op of ops) {
		if (op.t === "upsert" && op.tbl in ids && ok(op.doc?.id)) {
			ids[op.tbl as keyof typeof ids].add(op.doc.id as string);
			if (op.tbl === "ledger" && ok(op.doc.tid)) ids.threads.add(op.doc.tid as string);
			if (op.tbl === "threads" && ok(op.doc.refId)) {
				const k = op.doc.kind === "job" ? "jobs" : op.doc.kind === "item" ? "items" : op.doc.kind === "info" ? "posts" : null;
				if (k) ids[k].add(op.doc.refId as string);
			}
		}
		if (op.t === "delete" && op.tbl in ids && ok(op.id)) ids[op.tbl as keyof typeof ids].add(op.id);
		if ((op.t === "rsvp" || op.t === "unrsvp") && ok(op.postId)) ids.posts.add(op.postId);
		if (op.t === "message" && ok(op.doc?.threadId)) ids.threads.add(op.doc.threadId as string);
		if (op.t === "read" && ok(op.threadId)) ids.threads.add(op.threadId);
	}
	const [jobs, items, posts, threads, ledger, caps] = await Promise.all([
		selectIn<RefRow>(db, (p) => `SELECT id, owner, title, NULL AS cat FROM jobs WHERE id IN (${p})`, [...ids.jobs]),
		selectIn<RefRow>(db, (p) => `SELECT id, owner, name AS title, NULL AS cat FROM items WHERE id IN (${p})`, [...ids.items]),
		selectIn<RefRow>(db, (p) => `SELECT id, owner, title, cat, rsvp_on, rsvp_closed FROM posts WHERE id IN (${p})`, [...ids.posts]),
		selectIn<ThreadRow>(db, (p) => `SELECT id, kind, ref_id, owner, other FROM threads WHERE id IN (${p})`, [...ids.threads]),
		selectIn<LedgerRow>(db, (p) => `SELECT id, thread_id, kind, payer, payee, amount, date, title, recorded_by FROM ledger WHERE id IN (${p})`, [...ids.ledger]),
		db.prepare("SELECT (SELECT COUNT(*) FROM jobs WHERE owner = ?) AS jobs, (SELECT COUNT(*) FROM items WHERE owner = ?) AS items, (SELECT COUNT(*) FROM posts WHERE owner = ?) AS posts")
			.bind(me, me, me).first<{ jobs: number; items: number; posts: number }>(),
	]);
	const owner: Record<"jobs" | "items" | "posts", Map<string, RefRow>> = {
		jobs: new Map(jobs.map((r) => [r.id, r])),
		items: new Map(items.map((r) => [r.id, r])),
		posts: new Map(posts.map((r) => [r.id, r])),
	};
	const made = { jobs: Number(caps?.jobs ?? 0), items: Number(caps?.items ?? 0), posts: Number(caps?.posts ?? 0) };
	const missing = [...new Set(ledger.map((l) => l.thread_id))].filter((id) => !threads.some((t) => t.id === id));
	if (missing.length) threads.push(...(await selectIn<ThreadRow>(db, (p) => `SELECT id, kind, ref_id, owner, other FROM threads WHERE id IN (${p})`, missing)));
	// 仕事の相談の石の流れ：できること＝相談した人→投稿した人／お願い＝投稿した人→引き受けた人
	const ledgerJobRefs = [...new Set(ops.flatMap((op) => (op.t === "upsert" && op.tbl === "ledger" ? [threads.find((t) => t.id === op.doc?.tid)] : [])).filter((t) => t?.kind === "job" && t.ref_id).map((t) => t!.ref_id as string))];
	const jobType = new Map((await selectIn<{ id: string; type: string }>(db, (p) => `SELECT id, type FROM jobs WHERE id IN (${p})`, ledgerJobRefs)).map((r) => [r.id, r.type]));
	const thr = new Map(threads.map((r) => [r.id, r]));
	const led = new Map(ledger.map((r) => [r.id, r]));
	const party = (t: ThreadRow | undefined) => !!t && (t.owner === me || t.other === me);

	const out: Op[] = [];
	for (const op of ops) {
		let allow = false;
		if (op.t === "upsert") {
			const d = op.doc ?? {};
			switch (op.tbl) {
				case "households": allow = d.id === myHome || admin; break;
				case "people": {
					const home = personHome.get(d.id as string);
					if (home) allow = (home === myHome || admin) && d.householdId === home;
					else if (d.householdId === myHome && (homeCount.get(myHome) ?? 0) < PEOPLE_MAX) {
						allow = true;
						homeCount.set(myHome, (homeCount.get(myHome) ?? 0) + 1);
					}
					break;
				}
				case "jobs": case "items": case "posts": {
					const cur = owner[op.tbl].get(d.id as string);
					if (cur) allow = (cur.owner === me || admin) && d.owner === cur.owner;
					else if (d.owner === me && made[op.tbl] < CONTENT_MAX) {
						allow = true;
						made[op.tbl]++;
						owner[op.tbl].set(d.id as string, { id: d.id as string, owner: me, title: str(op.tbl === "items" ? d.name : d.title, 120), cat: op.tbl === "posts" ? String(d.cat) : null });
					}
					break;
				}
				case "threads": {
					const cur = thr.get(d.id as string);
					if (cur) allow = party(cur);
					else {
						const k = d.kind === "job" ? "jobs" : d.kind === "item" ? "items" : "posts";
						const ref = owner[k].get(d.refId as string);
						allow = d.other === me && !!ref && ref.owner === d.owner && ref.owner !== me;
						if (allow && ref) {
							d.title = ref.title;
							thr.set(d.id as string, { id: d.id as string, kind: String(d.kind), owner: ref.owner, other: me });
						}
					}
					break;
				}
				case "ledger": {
					const t = thr.get(d.tid as string);
					const cur = led.get(d.id as string);
					const amount = stone(d.amount);
					const title = str(d.title, 120);
					if (!plausibleDate(d.date)) break;
					if (cur) {
						allow = cur.thread_id === d.tid && cur.kind === String(d.kind) && cur.payer === d.from && cur.payee === d.to
							&& Number(cur.amount) === amount && cur.date === String(d.date) && cur.title === title && cur.recorded_by === d.by;
					} else {
						const reqJob = !!t && t.kind === "job" && jobType.get(t.ref_id ?? "") === "request";
						const [payer, payee] = t ? (reqJob ? [t.owner, t.other] : [t.other, t.owner]) : ["", ""];
						allow = !!t && party(t) && d.by === me && d.from === payer && d.to === payee && String(d.kind) === t.kind && (t.kind !== "item" || t.owner === me);
					}
					break;
				}
			}
		} else if (op.t === "message") {
			allow = op.doc?.from === me && party(thr.get(op.doc?.threadId as string));
		} else if (op.t === "rsvp") {
			// 参加を受け付けていて、締め切られていない投稿だけ。誰が申し込んだかはサーバーが記録する
			const post = owner.posts.get(op.postId);
			const on = post ? (post.rsvp_on === null || post.rsvp_on === undefined ? post.cat === "event" : !!post.rsvp_on) : false;
			allow = op.householdId === myHome && on && !post?.rsvp_closed;
			if (allow) op.by = me;
		} else if (op.t === "unrsvp") {
			// 自分の世帯の取り消し、または投稿者（主催者）・管理者による参加者の削除
			allow = op.householdId === myHome || owner.posts.get(op.postId)?.owner === me || admin;
		} else if (op.t === "read") {
			// 既読は自分が当事者の相談だけ（存在しない相談IDで行を増やされないように）
			allow = op.userId === me && party(thr.get(op.threadId));
		} else if (op.t === "seen") {
			allow = op.userId === me;
		} else if (op.t === "delete") {
			if (op.tbl === "ledger") { const l = led.get(op.id); allow = !!l && (party(thr.get(l.thread_id)) || admin); }
			else if (op.tbl === "people") { const home = personHome.get(op.id); allow = !!home && (home === myHome || admin) && !hasLogin.has(op.id) && op.id !== me; }
			else { const cur = owner[op.tbl].get(op.id); allow = !!cur && (cur.owner === me || admin); }
		}
		if (allow) out.push(op);
	}
	return out;
}
