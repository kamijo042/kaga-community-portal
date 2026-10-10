import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { applySync, diffOps, type SyncResult } from "./sync";
import { emptyState, type State } from "./types";
import { uid } from "./util";

/**
 * データの読み書きとリアルタイム同期
 * - データ本体は D1。/api/sync?since=… で「前回より後に変わった行」だけを受け取る
 * - 変更は操作（ops）にして /api/ops へ送る
 * - Durable Object の WebSocket（/api/ws）から「変わったよ」が届いたら差分を取りに行く
 * - 写真は R2（/api/photo/:id）
 */

export type SyncStatus = "loading" | "ready" | "passcode" | "offline";

type DataCtx = {
	d: State;
	me: string | null;
	setMe: (id: string | null) => void;
	mutate: (fn: (d: State) => void) => void;
	status: SyncStatus;
	connected: boolean;
	saveError: boolean;
	submitPasscode: (pass: string) => Promise<boolean>;
	photos: {
		url: (pid: string) => string;
		put: (dataUrl: string) => Promise<string>;
		del: (pid: string) => void;
	};
};

const Ctx = createContext<DataCtx | null>(null);

const PASS_KEY = "kaga-pass";
const ME_KEY = "kaga-me";
/** 同時刻の書き込みを取りこぼさないよう、少し前から取り直す（ミリ秒） */
const OVERLAP = 5000;
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* 保存できない環境 */ } };

function api(path: string, init: RequestInit = {}) {
	const headers = new Headers(init.headers);
	const pass = read(PASS_KEY);
	if (pass) headers.set("X-Portal-Pass", pass);
	return fetch(path, { ...init, headers, cache: "no-store" });
}

async function dataUrlToBlob(dataUrl: string) {
	return (await fetch(dataUrl)).blob();
}

export function DataProvider({ children }: { children: ReactNode }) {
	const [d, setD] = useState<State>(emptyState);
	const [status, setStatus] = useState<SyncStatus>("loading");
	const [connected, setConnected] = useState(false);
	const [saveError, setSaveError] = useState(false);
	const [me, setMeState] = useState<string | null>(() => read(ME_KEY));

	const dRef = useRef(d);
	/** サーバーが知っている（はずの）状態。ここと画面の差分を送る */
	const syncedRef = useRef<State>(emptyState());
	const cursorRef = useRef(0);
	const meRef = useRef(me);
	const queueRef = useRef<Promise<unknown>>(Promise.resolve());
	const pullingRef = useRef<Promise<boolean> | null>(null);
	const againRef = useRef(false);

	/** 差分を取りに行く（同時に呼ばれたら1回にまとめる） */
	const pull = useCallback((): Promise<boolean> => {
		if (pullingRef.current) { againRef.current = true; return pullingRef.current; }
		const run = async (): Promise<boolean> => {
			do {
				againRef.current = false;
				await queueRef.current; // 送信中の変更を先に届ける
				const since = cursorRef.current ? Math.max(0, cursorRef.current - OVERLAP) : 0;
				const who = meRef.current ? `&me=${encodeURIComponent(meRef.current)}` : "";
				const r = await api(`/api/sync?since=${since}${who}`);
				if (r.status === 401) { setStatus("passcode"); return false; }
				if (!r.ok) throw new Error("sync " + r.status);
				const res = (await r.json()) as SyncResult;
				const full = since === 0;
				const next = full ? emptyState() : structuredClone(dRef.current);
				const synced = full ? emptyState() : syncedRef.current;
				applySync(next, res);
				applySync(synced, res);
				syncedRef.current = synced;
				cursorRef.current = res.now;
				dRef.current = next;
				setD(next);
				setStatus("ready");
			} while (againRef.current);
			return true;
		};
		const p = run().catch(() => { setStatus((s) => (s === "loading" ? "offline" : s)); return false; }).finally(() => { pullingRef.current = null; });
		pullingRef.current = p;
		return p;
	}, []);

	const setMe = useCallback((id: string | null) => {
		meRef.current = id;
		write(ME_KEY, id);
		setMeState(id);
		// 世帯が変わったら、その世帯の相談・既読を含めて取り直す
		cursorRef.current = 0;
		void pull();
	}, [pull]);

	// 起動時の読み込みと、リアルタイム接続
	useEffect(() => {
		let ws: WebSocket | null = null;
		let stopped = false;
		let retry: ReturnType<typeof setTimeout> | undefined;

		const connect = () => {
			if (stopped) return;
			const pass = read(PASS_KEY);
			const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws${pass ? "?pass=" + encodeURIComponent(pass) : ""}`;
			try { ws = new WebSocket(url); } catch { retry = setTimeout(connect, 5000); return; }
			ws.onopen = () => { setConnected(true); void pull(); };
			ws.onmessage = (e) => { if (e.data !== "pong") void pull(); };
			ws.onclose = () => { setConnected(false); if (!stopped) retry = setTimeout(connect, 3000); };
		};

		// 接続維持の ping と、WebSocket が使えないときの保険（30秒ごとに差分確認）
		const timer = setInterval(() => {
			if (ws && ws.readyState === WebSocket.OPEN) ws.send("ping");
			else void pull();
		}, 30000);
		const onVisible = () => { if (document.visibilityState === "visible") void pull(); };
		document.addEventListener("visibilitychange", onVisible);

		pull().then((ok) => { if (ok) connect(); });

		return () => { stopped = true; clearTimeout(retry); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); ws?.close(); };
	}, [pull]);

	const mutate = useCallback((fn: (d: State) => void) => {
		const next = structuredClone(dRef.current);
		fn(next);
		dRef.current = next;
		setD(next);
		const ops = diffOps(syncedRef.current, next);
		syncedRef.current = structuredClone(next);
		if (!ops.length) return;
		queueRef.current = queueRef.current
			.then(() => api("/api/ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ops }) }))
			.then((r) => { if (!r.ok) throw new Error("ops " + r.status); setSaveError(false); })
			.catch(() => setSaveError(true));
	}, []);

	const submitPasscode = useCallback(async (pass: string) => {
		write(PASS_KEY, pass);
		cursorRef.current = 0;
		const ok = await pull();
		if (ok) location.reload();
		return ok;
	}, [pull]);

	const photos = useMemo(() => ({
		url: (pid: string) => `/api/photo/${encodeURIComponent(pid)}`,
		async put(dataUrl: string) {
			const pid = uid("p_");
			const blob = await dataUrlToBlob(dataUrl);
			const r = await api("/api/photo/" + pid, { method: "PUT", headers: { "Content-Type": blob.type || "image/jpeg" }, body: blob });
			if (!r.ok) throw new Error("画像を保存できませんでした");
			return pid;
		},
		del(pid: string) {
			void api("/api/photo/" + pid, { method: "DELETE" }).catch(() => undefined);
		},
	}), []);

	// 存在しない世帯でログインしていたら外す
	const effectiveMe = me && d.households[me] ? me : status === "ready" ? null : me;

	const value = useMemo<DataCtx>(() => ({ d, me: effectiveMe, setMe, mutate, status, connected, saveError, submitPasscode, photos }),
		[d, effectiveMe, setMe, mutate, status, connected, saveError, submitPasscode, photos]);
	return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useData() {
	const v = useContext(Ctx);
	if (!v) throw new Error("DataProvider がありません");
	return v;
}
