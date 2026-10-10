import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, authApi, setUnauthorizedHandler, type User } from "./api";
import { applySync, diffOps, type SyncResult } from "./sync";
import { emptyState, type State } from "./types";

/**
 * ログイン状態・データの読み書き・リアルタイム同期
 * - ログインは HttpOnly Cookie（サーバー側で KV のセッションと照合）
 * - データ本体は D1。/api/sync?since=… で「前回より後に変わった行」だけを受け取る
 * - 変更は操作（ops）にして /api/ops へ送る（サーバーで権限を確認）
 * - Durable Object の WebSocket（/api/ws）から「変わったよ」が届いたら差分を取りに行く
 * - 写真は R2（POST /api/photo でIDを決め、GET /api/photo/:id で表示）
 */

export type SyncStatus = "loading" | "login" | "setup" | "ready" | "offline";

type DataCtx = {
	d: State;
	me: string | null;
	user: User | null;
	status: SyncStatus;
	connected: boolean;
	saveError: boolean;
	mutate: (fn: (d: State) => void) => void;
	/** ログイン後・登録後に呼ぶ（ログイン状態を確認して読み込み直す） */
	refreshAuth: () => Promise<void>;
	logout: () => Promise<void>;
	photos: {
		url: (pid: string) => string;
		put: (dataUrl: string) => Promise<string>;
		del: (pid: string) => void;
	};
};

const Ctx = createContext<DataCtx | null>(null);

/** 同時刻の書き込みを取りこぼさないよう、少し前から取り直す（ミリ秒） */
const OVERLAP = 5000;

export function DataProvider({ children }: { children: ReactNode }) {
	const [d, setD] = useState<State>(emptyState);
	const [status, setStatus] = useState<SyncStatus>("loading");
	const [user, setUser] = useState<User | null>(null);
	const [connected, setConnected] = useState(false);
	const [saveError, setSaveError] = useState(false);

	const dRef = useRef(d);
	/** サーバーが知っている（はずの）状態。ここと画面の差分を送る */
	const syncedRef = useRef<State>(emptyState());
	const cursorRef = useRef(0);
	const queueRef = useRef<Promise<unknown>>(Promise.resolve());
	const pullingRef = useRef<Promise<boolean> | null>(null);
	const againRef = useRef(false);

	const reset = useCallback(() => {
		const e = emptyState();
		dRef.current = e;
		syncedRef.current = emptyState();
		cursorRef.current = 0;
		setD(e);
	}, []);

	const refreshAuth = useCallback(async () => {
		try {
			const r = await authApi.me();
			if (r.user) { reset(); setUser(r.user); setStatus("loading"); }
			else { reset(); setUser(null); setStatus(r.needsSetup ? "setup" : "login"); }
		} catch {
			setStatus("offline");
		}
	}, [reset]);

	// どの API でも「ログインが切れた」と返ってきたらログイン画面へ
	useEffect(() => {
		setUnauthorizedHandler(() => { setUser(null); reset(); setStatus("login"); });
		void refreshAuth();
		return () => setUnauthorizedHandler(null);
	}, [refreshAuth, reset]);

	/** 差分を取りに行く（同時に呼ばれたら1回にまとめる） */
	const pull = useCallback((): Promise<boolean> => {
		if (pullingRef.current) { againRef.current = true; return pullingRef.current; }
		const run = async (): Promise<boolean> => {
			do {
				againRef.current = false;
				await queueRef.current; // 送信中の変更を先に届ける
				const since = cursorRef.current ? Math.max(0, cursorRef.current - OVERLAP) : 0;
				const r = await api(`/api/sync?since=${since}`);
				if (r.status === 401) return false;
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

	// ログイン中だけ：読み込みとリアルタイム接続
	const uid_ = user?.userId;
	useEffect(() => {
		if (!uid_) return;
		let ws: WebSocket | null = null;
		let stopped = false;
		let retry: ReturnType<typeof setTimeout> | undefined;

		const connect = () => {
			if (stopped) return;
			try { ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`); } catch { retry = setTimeout(connect, 5000); return; }
			ws.onopen = () => { setConnected(true); void pull(); };
			ws.onmessage = (e) => { if (e.data !== "pong") void pull(); };
			ws.onclose = () => { setConnected(false); if (!stopped) retry = setTimeout(connect, 3000); };
		};
		const timer = setInterval(() => {
			if (ws && ws.readyState === WebSocket.OPEN) ws.send("ping");
			else void pull();
		}, 30000);
		const onVisible = () => { if (document.visibilityState === "visible") void pull(); };
		document.addEventListener("visibilitychange", onVisible);

		pull().then((ok) => { if (ok) connect(); });

		return () => { stopped = true; clearTimeout(retry); clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); ws?.close(); setConnected(false); };
	}, [uid_, pull]);

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
			.then(async (r) => {
				if (!r.ok) throw new Error("ops " + r.status);
				const { rejected } = (await r.json()) as { rejected?: number };
				setSaveError(false);
				// 権限がなく保存されなかった変更があれば、サーバーの状態に戻す
				if (rejected) { cursorRef.current = 0; void pull(); }
			})
			.catch(() => setSaveError(true));
	}, [pull]);

	const logout = useCallback(async () => {
		await authApi.logout().catch(() => undefined);
		setUser(null);
		reset();
		setStatus("login");
	}, [reset]);

	const photos = useMemo(() => ({
		url: (pid: string) => `/api/photo/${encodeURIComponent(pid)}`,
		async put(dataUrl: string) {
			const blob = await (await fetch(dataUrl)).blob();
			const r = await api("/api/photo", { method: "POST", headers: { "Content-Type": blob.type || "image/jpeg" }, body: blob });
			if (!r.ok) throw new Error("画像を保存できませんでした");
			const data = (await r.json().catch(() => null)) as { id?: string } | null;
			if (!data?.id) throw new Error("画像を保存できませんでした");
			return data.id;
		},
		del(pid: string) {
			void api("/api/photo/" + pid, { method: "DELETE" }).catch(() => undefined);
		},
	}), []);

	const me = user?.userId ?? null;
	const value = useMemo<DataCtx>(() => ({ d, me, user, status, connected, saveError, mutate, refreshAuth, logout, photos }),
		[d, me, user, status, connected, saveError, mutate, refreshAuth, logout, photos]);
	return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useData() {
	const v = useContext(Ctx);
	if (!v) throw new Error("DataProvider がありません");
	return v;
}
