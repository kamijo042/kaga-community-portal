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
	households: (r: Row) => ({ id: r.id, name: r.name, headName: r.head_name, headBirth: r.head_birth, district: r.district, note: r.note, members: parseArr(r.members), createdAt: r.created_at, updatedAt: r.updated_at }),
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
	reads: (r: Row) => ({ householdId: r.household_id, threadId: r.thread_id, at: r.read_at }),
	seen: (r: Row) => ({ householdId: r.household_id, at: r.seen_at }),
	ledger: (r: Row) => ({ id: r.id, date: r.date, kind: r.kind, refId: r.ref_id, tid: r.thread_id, from: r.payer, to: r.payee, amount: r.amount, title: r.title, by: r.recorded_by, at: r.recorded_at }),
};
export type Table = keyof typeof toDoc;

/**
 * since（ミリ秒）より後に変わった行を返す。
 * 相談・メッセージ・既読は、その世帯（me）が関わるものだけを返す。
 */
export async function sync(db: D1Database, since: number, me: string | null) {
	const now = Date.now();
	const mine = ok(me) ? me : "";
	const q = (sql: string, ...binds: unknown[]) => db.prepare(sql).bind(...binds);
	const res = await db.batch([
		q("SELECT * FROM households WHERE updated_at > ?", since),
		q("SELECT * FROM jobs WHERE updated_at > ?", since),
		q("SELECT * FROM items WHERE updated_at > ?", since),
		q("SELECT * FROM posts WHERE updated_at > ?", since),
		q("SELECT * FROM rsvps WHERE updated_at > ?", since),
		q("SELECT * FROM threads WHERE updated_at > ? AND (owner = ? OR other = ?)", since, mine, mine),
		q(`SELECT m.* FROM messages m JOIN threads t ON t.id = m.thread_id
		   WHERE m.updated_at > ? AND (t.owner = ? OR t.other = ?)`, since, mine, mine),
		q("SELECT * FROM reads WHERE updated_at > ? AND household_id = ?", since, mine),
		q("SELECT * FROM seen WHERE updated_at > ?", since),
		q("SELECT * FROM ledger WHERE updated_at > ?", since),
		q("SELECT tbl, id FROM tombstones WHERE deleted_at > ?", since),
	]);
	const tables: Table[] = ["households", "jobs", "items", "posts", "rsvps", "threads", "messages", "reads", "seen", "ledger"];
	const rows: Record<string, unknown[]> = {};
	tables.forEach((t, i) => {
		const conv = toDoc[t] as (r: Row) => Doc;
		rows[t] = ((res[i].results ?? []) as Row[]).map((r) => conv(r));
	});
	const deleted = (res[10].results ?? []) as { tbl: string; id: string }[];
	return { now, rows, deleted };
}

// ---------- 画面からの変更 → SQL ----------
export type Op =
	| { t: "upsert"; tbl: "households" | "jobs" | "items" | "posts" | "threads" | "ledger"; doc: Doc }
	| { t: "message"; doc: Doc }
	| { t: "rsvp"; postId: string; householdId: string; s: "go" | "maybe"; n: number }
	| { t: "unrsvp"; postId: string; householdId: string }
	| { t: "read"; householdId: string; threadId: string; at: number }
	| { t: "seen"; householdId: string; at: number }
	| { t: "delete"; tbl: "households" | "jobs" | "items" | "posts" | "ledger"; id: string };

const DELETABLE = new Set(["households", "jobs", "items", "posts", "ledger"]);

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
					p(`INSERT INTO households (id,name,head_name,head_birth,district,note,members,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)
					   ON CONFLICT(id) DO UPDATE SET name=excluded.name, head_name=excluded.head_name, head_birth=excluded.head_birth,
					   district=excluded.district, note=excluded.note, members=excluded.members, updated_at=excluded.updated_at`,
					d.id, str(d.name, 100), str(d.headName, 100), str(d.headBirth, 10), str(d.district, 100), str(d.note, 1000), jsonArr(d.members), created, now);
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
			if (!ok(op.householdId) || !ok(op.threadId)) continue;
			p(`INSERT INTO reads (household_id,thread_id,read_at,updated_at) VALUES (?,?,?,?)
			   ON CONFLICT(household_id,thread_id) DO UPDATE SET read_at=MAX(reads.read_at, excluded.read_at), updated_at=excluded.updated_at`,
			op.householdId, op.threadId, intOr(op.at, now), now);
		} else if (op.t === "seen") {
			if (!ok(op.householdId)) continue;
			p(`INSERT INTO seen (household_id,seen_at,updated_at) VALUES (?,?,?)
			   ON CONFLICT(household_id) DO UPDATE SET seen_at=MAX(seen.seen_at, excluded.seen_at), updated_at=excluded.updated_at`,
			op.householdId, intOr(op.at, now), now);
		} else if (op.t === "delete") {
			if (!DELETABLE.has(op.tbl) || !ok(op.id)) continue;
			p(`DELETE FROM ${op.tbl} WHERE id = ?`, op.id);
			if (op.tbl === "posts") p("DELETE FROM rsvps WHERE post_id = ?", op.id);
			p("INSERT OR REPLACE INTO tombstones (tbl,id,deleted_at) VALUES (?,?,?)", op.tbl, op.id, now);
		}
	}
	return out;
}
