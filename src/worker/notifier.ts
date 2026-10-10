import { DurableObject } from "cloudflare:workers";

/**
 * Notifier — リアルタイム通知だけを担当する Durable Object（1つだけ使う）
 *
 * データは持たない。開いている画面の WebSocket をまとめて持ち、
 * D1 に変更があったら全員に {"type":"changed","at":...} を送る。
 * Hibernation API を使うので、誰も操作していない間は課金されない。
 */
export class Notifier extends DurableObject {
	constructor(ctx: DurableObjectState, env: unknown) {
		super(ctx, env as Cloudflare.Env);
		// 画面からの "ping" には自動で "pong" を返す（Durable Object を起こさない）
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/ws") {
			if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
			const pair = new WebSocketPair();
			this.ctx.acceptWebSocket(pair[1]);
			return new Response(null, { status: 101, webSocket: pair[0] });
		}
		if (url.pathname === "/notify" && request.method === "POST") {
			const msg = await request.text();
			for (const ws of this.ctx.getWebSockets()) {
				try { ws.send(msg); } catch { /* 切断済み */ }
			}
			return new Response("ok");
		}
		return new Response("not found", { status: 404 });
	}

	async webSocketClose(ws: WebSocket, code: number) {
		try { ws.close(code, "bye"); } catch { /* 既に閉じている */ }
	}
}
