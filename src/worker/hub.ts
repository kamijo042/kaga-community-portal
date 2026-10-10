import { DurableObject } from "cloudflare:workers";

/**
 * PortalHub — ポータル全体のデータを持つ Durable Object（1つだけ使う）
 *
 * - データは「コレクション/ID」ごとに storage に保存（キー: d:<col>/<id>）
 * - 変更のたびに rev（版番号）を上げ、接続中の WebSocket 全員に通知
 * - 写真は p:<photoId> に data URL で保存
 */

export const COLS = ["households", "jobs", "items", "threads", "messages", "reads", "posts", "seen", "ledger"] as const;
type Col = (typeof COLS)[number];
type Doc = Record<string, unknown>;
type Patch = { set?: Record<string, unknown>; del?: string[]; by?: string | null };

const SAFE_ID = /^[A-Za-z0-9_\-:.]{1,200}$/;
const PHOTO_ID = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_PHOTO = 1_500_000;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}
function splitKey(key: string): [Col, string] | null {
	const i = key.indexOf("/");
	if (i < 0) return null;
	const col = key.slice(0, i) as Col;
	const id = key.slice(i + 1);
	if (!COLS.includes(col) || !SAFE_ID.test(id)) return null;
	return [col, id];
}

export class PortalHub extends DurableObject {
	private state: Record<Col, Record<string, unknown>> | null = null;
	private rev = 0;

	private async load() {
		if (this.state) return this.state;
		const s = Object.fromEntries(COLS.map((c) => [c, {}])) as Record<Col, Record<string, unknown>>;
		const rows = await this.ctx.storage.list<unknown>({ prefix: "d:" });
		for (const [k, v] of rows) {
			const parts = splitKey(k.slice(2));
			if (parts) s[parts[0]][parts[1]] = v;
		}
		this.rev = (await this.ctx.storage.get<number>("rev")) ?? 0;
		this.state = s;
		return s;
	}

	private broadcast() {
		const msg = JSON.stringify({ rev: this.rev });
		for (const ws of this.ctx.getWebSockets()) {
			try { ws.send(msg); } catch { /* 切断済みは無視 */ }
		}
	}

	private async applyPatch(p: Patch): Promise<number> {
		const s = await this.load();
		const by = typeof p.by === "string" ? p.by : null;
		const puts: Record<string, unknown> = {};
		const dels: string[] = [];

		for (const [key, val] of Object.entries(p.set ?? {})) {
			const parts = splitKey(key);
			if (!parts || val === null || typeof val !== "object") continue;
			const [col, id] = parts;
			const cur = s[col][id];
			let next: unknown = val;
			if (col === "messages" && Array.isArray(val)) {
				// チャットは双方が同時に書くので、メッセージIDで合算する（削除はしない）
				const map = new Map<string, Doc>();
				for (const m of (Array.isArray(cur) ? cur : []) as Doc[]) map.set(String(m.id), m);
				for (const m of val as Doc[]) if (m && typeof m === "object" && m.id) map.set(String(m.id), m);
				next = [...map.values()].sort((a, b) => Number(a.t) - Number(b.t));
			} else if (col === "posts" && cur && typeof cur === "object") {
				// イベントの参加表明は、書き込んだ本人の分だけ反映する
				const rs: Record<string, unknown> = { ...((cur as Doc).rsvps as Doc | undefined) };
				const inc = (val as Doc).rsvps as Doc | undefined;
				if (by) {
					if (inc && inc[by]) rs[by] = inc[by];
					else delete rs[by];
				}
				next = { ...(val as Doc), rsvps: rs };
			}
			s[col][id] = next;
			puts["d:" + key] = next;
		}
		for (const key of p.del ?? []) {
			const parts = splitKey(key);
			if (!parts || parts[0] === "messages") continue;
			delete s[parts[0]][parts[1]];
			dels.push("d:" + key);
		}

		this.rev += 1;
		puts.rev = this.rev;
		// storage.put は一度に128件まで
		const entries = Object.entries(puts);
		for (let i = 0; i < entries.length; i += 128) await this.ctx.storage.put(Object.fromEntries(entries.slice(i, i + 128)));
		for (let i = 0; i < dels.length; i += 128) await this.ctx.storage.delete(dels.slice(i, i + 128));
		this.broadcast();
		return this.rev;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		if (path === "/api/ws") {
			if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
			await this.load();
			const pair = new WebSocketPair();
			this.ctx.acceptWebSocket(pair[1]);
			pair[1].send(JSON.stringify({ rev: this.rev }));
			return new Response(null, { status: 101, webSocket: pair[0] });
		}
		if (path === "/api/ping") {
			await this.load();
			return json({ ok: true, rev: this.rev });
		}
		if (path === "/api/state" && request.method === "GET") {
			const s = await this.load();
			return json({ ...s, rev: this.rev });
		}
		if (path === "/api/patch" && request.method === "POST") {
			let body: Patch;
			try { body = (await request.json()) as Patch; } catch { return json({ error: "bad json" }, 400); }
			return json({ rev: await this.applyPatch(body) });
		}
		const m = path.match(/^\/api\/photo\/([^/]+)$/);
		if (m && PHOTO_ID.test(m[1])) {
			const key = "p:" + m[1];
			if (request.method === "GET") {
				const v = await this.ctx.storage.get<string>(key);
				return v ? new Response(v, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, max-age=86400" } }) : new Response("", { status: 404 });
			}
			if (request.method === "PUT") {
				const body = await request.text();
				if (body.length > MAX_PHOTO || !/^data:image\/(jpeg|png|webp);base64,/.test(body)) return json({ error: "bad image" }, 400);
				await this.ctx.storage.put(key, body);
				return json({ ok: true });
			}
			if (request.method === "DELETE") {
				await this.ctx.storage.delete(key);
				return json({ ok: true });
			}
		}
		return json({ error: "not found" }, 404);
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		if (message === "ping") ws.send(JSON.stringify({ rev: this.rev, pong: true }));
	}

	async webSocketClose(ws: WebSocket, code: number) {
		try { ws.close(code, "bye"); } catch { /* 既に閉じている */ }
	}
}
