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
const jsonArr = (v: unknown) => JSON.stringify(Array.isArray(v) ? v : []);
const parseArr = (v: unknown) => { try { const x = JSON.parse(String(v ?? "[]")); return Array.isArray(x) ? x : []; } catch { return []; } };
const ok = (id: unknown): id is string => typeof id === "string" && SAFE_ID.test(id);

// ---------- 行 → 画面のデータ ----------
const toDoc = {
	households: (r: Row) => ({ id: r.id, name: r.name, district: r.district, note: r.note, createdAt: r.created_at, updatedAt: r.updated_at }),
	people: (r: Row) => ({ id: r.id, householdId: r.household_id, name: r.name, relation: r.relation, birthYear: r.birth_year, createdAt: r.created_at, updatedAt: r.updated_at }),
	jobs: (r: Row) => ({ id: r.id, owner: r.owner, title: r.title, desc: r.description, price: r.price, negotiable: !!r.negotiable, active: !!r.active, createdAt: r.created_at, updatedAt: r.updated_at }),
	items: (r: Row) => ({ id: r.id, owner: r.owner, name: r.name, desc: r.description, priceStone: r.price_stone, priceYen: r.price_yen, photos: parseArr(r.photos), status: r.status, ...(r.buyer ? { buyer: r.buyer } : {}), ...(r.done_at ? { doneAt: r.done_at } : {}), createdAt: r.created_at, updatedAt: r.updated_at }),
	posts: (r: Row) => ({
		id: r.id, owner: r.owner, cat: r.cat, kind: r.kind, title: r.title, body: r.body, link: r.link, targets: parseArr(r.targets), photo: r.photo ?? null,
		event: r.cat === "event" ? { date: r.ev_date ?? "", start: r.ev_start ?? "", end: r.ev_end ?? "", place: r.ev_place ?? "", capacity: r.ev_capacity ?? null, bring: r.ev_bring ?? "" } : null,
		createdAt: r.created_at, updatedAt: r.updated_at,
	}),
	rsvps: (r: Row) => ({ postId: r.post_id, householdId: r.household_id, s: r.status, n: r.people, at: r.updated_at }),
	threads: (r: Row) => ({ id: r.id, kind: r.kind, refId: r.ref_id, owner: r.owner, other: r.other, title: r.title, lastAt: r.last_at, lastBy: r.last_by ?? null, lastText: r.last_text, createdAt: r.created_at }),
	messages: (r: Row) => ({ id: r.id, threadId: r.thread_id, from: r.sender, text: r.text, sys: !!r.sys, t: r.sent_at }),
	reads: (r: Row) => ({ userId: r.user_id, threadId: r.thread_id, at: r.read_at }),
	seen: (r: Row) => ({ userId: r.user_id, at: r.seen_at }),
	ledger: (r: Row) => ({ id: r.id, date: r.date, kind: r.kind, refId: r.ref_id, tid: r.thread_id, from: r.payer, to: r.payee, amount: r.amount, title: r.title, by: r.recorded_by, at: r.recorded_at }),
};
export type Table = keyof typeof toDoc;

/**
 * since（ミリ秒）より後に変わった行を返す。
 * 相談・メッセージ・既読は、ログイン中の人（me）が関わるものだけを返す。
 */
export async function sync(db: D1Database, since: number, me: string | null) {
	const now = Date.now();
	const mine = ok(me) ? me : "";
	const q = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds);
	const res = await db.batch([
		q("SELECT * FROM households WHERE updated_at > ?", since),
		q("SELECT * FROM people WHERE updated_at > ?", since),
		q("SELECT * FROM jobs WHERE updated_at > ?", since),
		q("SELECT * FROM items WHERE updated_at > ?", since),
		q("SELECT * FROM posts WHERE updated_at > ?", since),
		q("SELECT * FROM rsvps WHERE updated_at > ?", since),
		q("SELECT * FROM threads WHERE updated_at > ? AND (owner = ? OR other = ?)", since, mine, mine),
		q(`SELECT m.* FROM messages m JOIN threads t ON t.id = m.thread_id
		   WHERE m.updated_at > ? AND (t.owner = ? OR t.other = ?)`, since, mine, mine),
		q("SELECT * FROM reads WHERE updated_at > ? AND user_id = ?", since, mine),
		q("SELECT * FROM seen WHERE updated_at > ? AND user_id = ?", since, mine),
		q("SELECT * FROM ledger WHERE updated_at > ?", since),
		q("SELECT tbl, id FROM tombstones WHERE deleted_at > ?", since),
	]);
	const tables: Table[] = ["households", "people", "jobs", "items", "posts", "rsvps", "threads", "messages", "reads", "seen", "ledger"];
	const rows: Record<string, unknown[]> = {};
	tables.forEach((t, i) => {
		const conv = toDoc[t] as (r: Row) => Doc;
		rows[t] = ((res[i].results ?? []) as Row[]).map((r) => conv(r));
	});
	const deleted = (res[11].results ?? []) as { tbl: string; id: string }[];
	return { now, rows, deleted };
}

// ---------- 画面からの変更 → SQL ----------
export type Op =
	| { t: "upsert"; tbl: "households" | "people" | "jobs" | "items" | "posts" | "threads" | "ledger"; doc: Doc }
	| { t: "message"; doc: Doc }
	| { t: "rsvp"; postId: string; householdId: string; s: "go" | "maybe"; n: number }
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
					p(`INSERT INTO people (id,household_id,name,relation,birth_year,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
					   ON CONFLICT(id) DO UPDATE SET name=excluded.name, relation=excluded.relation, birth_year=excluded.birth_year, updated_at=excluded.updated_at`,
					d.id, d.householdId, str(d.name, 100), str(d.relation, 20), str(d.birthYear, 10), created, now);
					break;
				case "jobs":
					if (!ok(d.owner)) continue;
					p(`INSERT INTO jobs (id,owner,title,description,price,negotiable,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)
					   ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description, price=excluded.price,
					   negotiable=excluded.negotiable, active=excluded.active, updated_at=excluded.updated_at`,
					d.id, d.owner, str(d.title, 100), str(d.desc), Math.max(0, intOr(d.price, 0)), bool(d.negotiable), bool(d.active), created, now);
					break;
				case "items":
					if (!ok(d.owner)) continue;
					p(`INSERT INTO items (id,owner,name,description,price_stone,price_yen,photos,status,buyer,done_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
					   ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, price_stone=excluded.price_stone,
					   price_yen=excluded.price_yen, photos=excluded.photos, status=excluded.status, buyer=excluded.buyer, done_at=excluded.done_at, updated_at=excluded.updated_at`,
					d.id, d.owner, str(d.name, 100), str(d.desc), int(d.priceStone), int(d.priceYen), jsonArr(d.photos),
					["open", "nego", "done"].includes(String(d.status)) ? d.status : "open", ok(d.buyer) ? d.buyer : null, int(d.doneAt), created, now);
					break;
				case "posts": {
					if (!ok(d.owner) || !["edu", "farm", "event"].includes(String(d.cat))) continue;
					const ev = (d.cat === "event" && d.event && typeof d.event === "object" ? d.event : {}) as Doc;
					p(`INSERT INTO posts (id,owner,cat,kind,title,body,link,targets,photo,ev_date,ev_start,ev_end,ev_place,ev_capacity,ev_bring,created_at,updated_at)
					   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
					   ON CONFLICT(id) DO UPDATE SET cat=excluded.cat, kind=excluded.kind, title=excluded.title, body=excluded.body, link=excluded.link,
					   targets=excluded.targets, photo=excluded.photo, ev_date=excluded.ev_date, ev_start=excluded.ev_start, ev_end=excluded.ev_end,
					   ev_place=excluded.ev_place, ev_capacity=excluded.ev_capacity, ev_bring=excluded.ev_bring, updated_at=excluded.updated_at`,
					d.id, d.owner, d.cat, str(d.kind, 50), str(d.title, 120), str(d.body), str(d.link, 500), jsonArr(d.targets), ok(d.photo) ? d.photo : null,
					d.cat === "event" ? str(ev.date, 10) || null : null, d.cat === "event" ? str(ev.start, 5) : null, d.cat === "event" ? str(ev.end, 5) : null,
					d.cat === "event" ? str(ev.place, 200) : null, d.cat === "event" ? int(ev.capacity) : null, d.cat === "event" ? str(ev.bring, 200) : null, created, now);
					break;
				}
				case "threads":
					if (!ok(d.owner) || !ok(d.other) || !ok(d.refId) || !["job", "item", "info"].includes(String(d.kind))) continue;
					// 最終メッセージの情報は、新しい方だけで上書きする
					p(`INSERT INTO threads (id,kind,ref_id,owner,other,title,last_at,last_by,last_text,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
					   ON CONFLICT(id) DO UPDATE SET title=excluded.title,
					   last_by   = CASE WHEN excluded.last_at >= threads.last_at THEN excluded.last_by   ELSE threads.last_by   END,
					   last_text = CASE WHEN excluded.last_at >= threads.last_at THEN excluded.last_text ELSE threads.last_text END,
					   last_at   = MAX(threads.last_at, excluded.last_at), updated_at=excluded.updated_at`,
					d.id, d.kind, d.refId, d.owner, d.other, str(d.title, 120), intOr(d.lastAt, 0), ok(d.lastBy) ? d.lastBy : null, str(d.lastText, 300), created, now);
					break;
				case "ledger":
					if (!ok(d.from) || !ok(d.to) || !ok(d.tid) || !ok(d.refId) || !["job", "item"].includes(String(d.kind))) continue;
					if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.date))) continue;
					p(`INSERT INTO ledger (id,date,kind,ref_id,thread_id,payer,payee,amount,title,recorded_by,recorded_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
					   ON CONFLICT(id) DO UPDATE SET date=excluded.date, amount=excluded.amount, title=excluded.title, updated_at=excluded.updated_at`,
					d.id, d.date, d.kind, d.refId, d.tid, d.from, d.to, Math.max(0, intOr(d.amount, 0)), str(d.title, 120), ok(d.by) ? d.by : "", intOr(d.at, now), now);
					break;
			}
			untomb(op.tbl, d.id as string);
		} else if (op.t === "message") {
			const d = op.doc ?? {};
			if (!ok(d.id) || !ok(d.threadId) || !ok(d.from) || typeof d.text !== "string" || !d.text) continue;
			p("INSERT OR IGNORE INTO messages (id,thread_id,sender,text,sys,sent_at,updated_at) VALUES (?,?,?,?,?,?,?)",
				d.id, d.threadId, d.from, str(d.text, 4000), bool(d.sys), intOr(d.t, now), now);
		} else if (op.t === "rsvp") {
			if (!ok(op.postId) || !ok(op.householdId) || !["go", "maybe"].includes(op.s)) continue;
			p(`INSERT INTO rsvps (post_id,household_id,status,people,updated_at) VALUES (?,?,?,?,?)
			   ON CONFLICT(post_id,household_id) DO UPDATE SET status=excluded.status, people=excluded.people, updated_at=excluded.updated_at`,
			op.postId, op.householdId, op.s, Math.min(20, Math.max(op.s === "go" ? 1 : 0, intOr(op.n, 1))), now);
			untomb("rsvps", `${op.postId}|${op.householdId}`);
		} else if (op.t === "unrsvp") {
			if (!ok(op.postId) || !ok(op.householdId)) continue;
			p("DELETE FROM rsvps WHERE post_id = ? AND household_id = ?", op.postId, op.householdId);
			p("INSERT OR REPLACE INTO tombstones (tbl,id,deleted_at) VALUES ('rsvps',?,?)", `${op.postId}|${op.householdId}`, now);
		} else if (op.t === "read") {
			if (!ok(op.userId) || !ok(op.threadId)) continue;
			p(`INSERT INTO reads (user_id,thread_id,read_at,updated_at) VALUES (?,?,?,?)
			   ON CONFLICT(user_id,thread_id) DO UPDATE SET read_at=MAX(reads.read_at, excluded.read_at), updated_at=excluded.updated_at`,
			op.userId, op.threadId, intOr(op.at, now), now);
		} else if (op.t === "seen") {
			if (!ok(op.userId)) continue;
			p(`INSERT INTO seen (user_id,seen_at,updated_at) VALUES (?,?,?)
			   ON CONFLICT(user_id) DO UPDATE SET seen_at=MAX(seen.seen_at, excluded.seen_at), updated_at=excluded.updated_at`,
			op.userId, intOr(op.at, now), now);
		} else if (op.t === "delete") {
			if (!DELETABLE.has(op.tbl) || !ok(op.id)) continue;
			p(`DELETE FROM ${op.tbl} WHERE id = ?`, op.id);
			if (op.tbl === "posts") p("DELETE FROM rsvps WHERE post_id = ?", op.id);
			p("INSERT OR REPLACE INTO tombstones (tbl,id,deleted_at) VALUES (?,?,?)", op.tbl, op.id, now);
		}
	}
	return out;
}

// ---------- 権限チェック ----------
type Who = { userId: string; householdId: string; role: "member" | "admin" };
type OwnerRow = { id: string; owner: string };
type ThreadRow = { id: string; kind: string; owner: string; other: string };
type LedgerRow = { id: string; thread_id: string; kind: string };

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
		if (op.t === "message" && ok(op.doc?.threadId)) ids.threads.add(op.doc.threadId as string);
	}
	const [jobs, items, posts, threads, ledger] = await Promise.all([
		selectIn<OwnerRow>(db, (p) => `SELECT id, owner FROM jobs WHERE id IN (${p})`, [...ids.jobs]),
		selectIn<OwnerRow>(db, (p) => `SELECT id, owner FROM items WHERE id IN (${p})`, [...ids.items]),
		selectIn<OwnerRow>(db, (p) => `SELECT id, owner FROM posts WHERE id IN (${p})`, [...ids.posts]),
		selectIn<ThreadRow>(db, (p) => `SELECT id, kind, owner, other FROM threads WHERE id IN (${p})`, [...ids.threads]),
		selectIn<LedgerRow>(db, (p) => `SELECT id, thread_id, kind FROM ledger WHERE id IN (${p})`, [...ids.ledger]),
	]);
	const owner = {
		jobs: new Map(jobs.map((r) => [r.id, r.owner])),
		items: new Map(items.map((r) => [r.id, r.owner])),
		posts: new Map(posts.map((r) => [r.id, r.owner])),
	};
	const missing = [...new Set(ledger.map((l) => l.thread_id))].filter((id) => !threads.some((t) => t.id === id));
	if (missing.length) threads.push(...(await selectIn<ThreadRow>(db, (p) => `SELECT id, kind, owner, other FROM threads WHERE id IN (${p})`, missing)));
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
					allow = home ? (home === myHome || admin) && d.householdId === home : d.householdId === myHome;
					break;
				}
				case "jobs": case "items": case "posts": {
					const cur = owner[op.tbl].get(d.id as string);
					allow = cur ? (cur === me || admin) && d.owner === cur : d.owner === me;
					if (allow && !cur) owner[op.tbl].set(d.id as string, me);
					break;
				}
				case "threads": {
					const cur = thr.get(d.id as string);
					if (cur) allow = party(cur);
					else {
						const k = d.kind === "job" ? "jobs" : d.kind === "item" ? "items" : "posts";
						const refOwner = owner[k].get(d.refId as string);
						allow = d.other === me && !!refOwner && refOwner === d.owner && refOwner !== me;
						if (allow) thr.set(d.id as string, { id: d.id as string, kind: String(d.kind), owner: refOwner as string, other: me });
					}
					break;
				}
				case "ledger": {
					const t = thr.get(d.tid as string);
					allow = !!t && party(t) && d.by === me && d.from === t.other && d.to === t.owner && d.kind === t.kind && (t.kind !== "item" || t.owner === me);
					break;
				}
			}
		} else if (op.t === "message") {
			allow = op.doc?.from === me && party(thr.get(op.doc?.threadId as string));
		} else if (op.t === "rsvp" || op.t === "unrsvp") {
			allow = op.householdId === myHome;
		} else if (op.t === "read" || op.t === "seen") {
			allow = op.userId === me;
		} else if (op.t === "delete") {
			if (op.tbl === "ledger") { const l = led.get(op.id); allow = !!l && (party(thr.get(l.thread_id)) || admin); }
			else if (op.tbl === "people") { const home = personHome.get(op.id); allow = !!home && (home === myHome || admin) && !hasLogin.has(op.id) && op.id !== me; }
			else { const cur = owner[op.tbl].get(op.id); allow = !!cur && (cur === me || admin); }
		}
		if (allow) out.push(op);
	}
	return out;
}
