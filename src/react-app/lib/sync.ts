import type { Household, Item, Job, LedgerEntry, Message, Post, Rsvp, State, Thread } from "./types";

/**
 * サーバー（D1）との差分のやり取り
 * - applySync: /api/sync の結果を画面のデータに反映する
 * - diffOps:   画面で変えたデータから、サーバーに送る操作を作る
 */

export type SyncResult = {
	now: number;
	rows: {
		households: Household[];
		jobs: Job[];
		items: Item[];
		posts: Omit<Post, "rsvps">[];
		rsvps: { postId: string; householdId: string; s: Rsvp["s"]; n: number; at: number }[];
		threads: Thread[];
		messages: (Message & { threadId: string })[];
		reads: { householdId: string; threadId: string; at: number }[];
		seen: { householdId: string; at: number }[];
		ledger: LedgerEntry[];
	};
	deleted: { tbl: string; id: string }[];
};

export type Op =
	| { t: "upsert"; tbl: "households" | "jobs" | "items" | "posts" | "threads" | "ledger"; doc: unknown }
	| { t: "message"; doc: Message & { threadId: string } }
	| { t: "rsvp"; postId: string; householdId: string; s: Rsvp["s"]; n: number }
	| { t: "unrsvp"; postId: string; householdId: string }
	| { t: "read"; householdId: string; threadId: string; at: number }
	| { t: "seen"; householdId: string; at: number }
	| { t: "delete"; tbl: "households" | "jobs" | "items" | "posts" | "ledger"; id: string };

/** サーバーの変更を s に書き込む（s は書き換えてよいコピー） */
export function applySync(s: State, r: SyncResult) {
	// 先に削除、そのあと追加・更新
	for (const { tbl, id } of r.deleted) {
		if (tbl === "rsvps") {
			const [postId, hid] = id.split("|");
			if (s.posts[postId]?.rsvps) delete s.posts[postId].rsvps[hid];
		} else if (tbl in s) {
			delete (s as unknown as Record<string, Record<string, unknown>>)[tbl][id];
		}
	}
	for (const h of r.rows.households) s.households[h.id] = h;
	for (const j of r.rows.jobs) s.jobs[j.id] = j;
	for (const i of r.rows.items) s.items[i.id] = i;
	for (const p of r.rows.posts) s.posts[p.id] = { ...p, rsvps: s.posts[p.id]?.rsvps ?? {} };
	for (const x of r.rows.rsvps) {
		const p = s.posts[x.postId];
		if (p) (p.rsvps ??= {})[x.householdId] = { s: x.s, n: x.n, at: x.at };
	}
	for (const t of r.rows.threads) s.threads[t.id] = t;
	const touched = new Set<string>();
	for (const m of r.rows.messages) {
		const list = (s.messages[m.threadId] ??= []);
		if (!list.some((x) => x.id === m.id)) {
			list.push({ id: m.id, from: m.from, t: m.t, text: m.text, ...(m.sys ? { sys: true } : {}) });
			touched.add(m.threadId);
		}
	}
	for (const tid of touched) s.messages[tid].sort((a, b) => a.t - b.t);
	for (const x of r.rows.reads) (s.reads[x.householdId] ??= {})[x.threadId] = Math.max(s.reads[x.householdId]?.[x.threadId] ?? 0, x.at);
	for (const x of r.rows.seen) s.seen[x.householdId] = Math.max(s.seen[x.householdId] ?? 0, x.at);
	for (const e of r.rows.ledger) s.ledger[e.id] = e;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** a（サーバーが知っている状態）→ b（画面の新しい状態）への操作 */
export function diffOps(a: State, b: State): Op[] {
	const ops: Op[] = [];
	const plain = ["households", "jobs", "items", "threads", "ledger"] as const;
	for (const tbl of plain) {
		const A = a[tbl] as Record<string, unknown>, B = b[tbl] as Record<string, unknown>;
		for (const id in B) if (!same(A[id], B[id])) ops.push({ t: "upsert", tbl, doc: B[id] });
		if (tbl !== "threads") for (const id in A) if (!(id in B)) ops.push({ t: "delete", tbl, id });
	}
	// 情報の投稿（参加表明は別に送る）
	for (const id in b.posts) {
		const { rsvps: rb = {}, ...pb } = b.posts[id];
		const old = a.posts[id];
		const { rsvps: ra = {}, ...pa } = old ?? ({ rsvps: {} } as Post);
		if (!old || !same(pa, pb)) ops.push({ t: "upsert", tbl: "posts", doc: pb });
		for (const hid in rb) if (!same(ra[hid], rb[hid])) ops.push({ t: "rsvp", postId: id, householdId: hid, s: rb[hid].s, n: rb[hid].n });
		for (const hid in ra) if (!(hid in rb)) ops.push({ t: "unrsvp", postId: id, householdId: hid });
	}
	for (const id in a.posts) if (!(id in b.posts)) ops.push({ t: "delete", tbl: "posts", id });
	// メッセージは新しく増えた分だけ
	for (const tid in b.messages) {
		const known = new Set((a.messages[tid] ?? []).map((m) => m.id));
		for (const m of b.messages[tid]) if (!known.has(m.id)) ops.push({ t: "message", doc: { ...m, threadId: tid } });
	}
	for (const hid in b.reads) for (const tid in b.reads[hid]) if (a.reads[hid]?.[tid] !== b.reads[hid][tid]) ops.push({ t: "read", householdId: hid, threadId: tid, at: b.reads[hid][tid] });
	for (const hid in b.seen) if (a.seen[hid] !== b.seen[hid]) ops.push({ t: "seen", householdId: hid, at: b.seen[hid] });
	return ops;
}
