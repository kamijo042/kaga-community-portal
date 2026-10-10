import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { COLS, emptyState, type State } from "./types";
import { uid } from "./util";

/**
 * データの読み書きとリアルタイム同期
 * - 起動時に /api/state を読み込み
 * - 変更は差分（パッチ）だけを /api/patch に送る
 * - /api/ws（WebSocket）で他の人の変更を受け取り、読み直す
 */

type Patch = { set: Record<string, unknown>; del: string[]; by?: string | null };
export type SyncStatus = "loading" | "ready" | "passcode";

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
		get: (pid: string) => Promise<string | undefined>;
		put: (dataUrl: string) => Promise<string>;
		del: (pid: string) => void;
	};
};

const Ctx = createContext<DataCtx | null>(null);

const PASS_KEY = "kaga-pass";
const ME_KEY = "kaga-me";
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* 保存できない環境 */ } };

function api(path: string, init: RequestInit = {}) {
	const headers = new Headers(init.headers);
	const pass = read(PASS_KEY);
	if (pass) headers.set("X-Portal-Pass", pass);
	return fetch(path, { ...init, headers, cache: "no-store" });
}

function diffState(a: State, b: State): Patch | null {
	const set: Record<string, unknown> = {};
	const del: string[] = [];
	for (const c of COLS) {
		const A = a[c] as Record<string, unknown>, B = b[c] as Record<string, unknown>;
		for (const k in B) if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) set[`${c}/${k}`] = B[k];
		for (const k in A) if (!(k in B)) del.push(`${c}/${k}`);
	}
	return Object.keys(set).length || del.length ? { set, del } : null;
}

function normalize(raw: Partial<State> & { rev?: number }): State {
	const s = emptyState();
	for (const c of COLS) if (raw[c] && typeof raw[c] === "object") (s as Record<string, unknown>)[c] = raw[c];
	return s;
}

export function DataProvider({ children }: { children: ReactNode }) {
	const [d, setD] = useState<State>(emptyState);
	const [status, setStatus] = useState<SyncStatus>("loading");
	const [connected, setConnected] = useState(false);
	const [saveError, setSaveError] = useState(false);
	const [me, setMeState] = useState<string | null>(() => read(ME_KEY));

	const dRef = useRef(d);
	const syncedRef = useRef<State>(d);
	const revRef = useRef(0);
	const queueRef = useRef<Promise<unknown>>(Promise.resolve());
	const meRef = useRef(me);
	const photoCache = useRef(new Map<string, string>());

	const setMe = useCallback((id: string | null) => { meRef.current = id; write(ME_KEY, id); setMeState(id); }, []);

	const refresh = useCallback(async () => {
		await queueRef.current;
		const r = await api("/api/state");
		if (r.status === 401) { setStatus("passcode"); return false; }
		if (!r.ok) throw new Error("state " + r.status);
		const raw = (await r.json()) as Partial<State> & { rev?: number };
		const next = normalize(raw);
		revRef.current = Math.max(revRef.current, raw.rev ?? 0);
		dRef.current = next;
		syncedRef.current = structuredClone(next);
		setD(next);
		setStatus("ready");
		return true;
	}, []);

	// 起動時の読み込みと、リアルタイム接続
	useEffect(() => {
		let ws: WebSocket | null = null;
		let stopped = false;
		let retry: ReturnType<typeof setTimeout> | undefined;
		let refreshing = false;
		let wanted = 0;

		const pull = async () => {
			if (refreshing) return;
			refreshing = true;
			try {
				while (wanted > revRef.current) {
					const before = revRef.current;
					if (!(await refresh())) break;
					if (revRef.current === before) break;
				}
			} catch { /* 次の通知で再試行 */ } finally { refreshing = false; }
		};

		const connect = () => {
			if (stopped) return;
			const pass = read(PASS_KEY);
			const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws${pass ? "?pass=" + encodeURIComponent(pass) : ""}`;
			try { ws = new WebSocket(url); } catch { retry = setTimeout(connect, 5000); return; }
			ws.onopen = () => setConnected(true);
			ws.onmessage = (e) => {
				try {
					const { rev } = JSON.parse(String(e.data)) as { rev: number };
					wanted = Math.max(wanted, rev);
					void pull();
				} catch { /* 不明なメッセージ */ }
			};
			ws.onclose = () => { setConnected(false); if (!stopped) retry = setTimeout(connect, 3000); };
		};

		// WebSocket が使えないときの保険（20秒ごとに版番号を確認）
		const poll = setInterval(async () => {
			if (ws && ws.readyState === WebSocket.OPEN) { ws.send("ping"); return; }
			try {
				const r = await api("/api/ping");
				if (r.ok) { const { rev } = (await r.json()) as { rev: number }; wanted = Math.max(wanted, rev); void pull(); }
			} catch { /* オフライン */ }
		}, 20000);

		refresh().then((ok) => { if (ok) connect(); }).catch(() => setStatus("ready"));

		return () => { stopped = true; clearTimeout(retry); clearInterval(poll); ws?.close(); };
	}, [refresh]);

	const mutate = useCallback((fn: (d: State) => void) => {
		const next = structuredClone(dRef.current);
		fn(next);
		dRef.current = next;
		setD(next);
		const patch = diffState(syncedRef.current, next);
		syncedRef.current = structuredClone(next);
		if (!patch) return;
		patch.by = meRef.current;
		queueRef.current = queueRef.current
			.then(() => api("/api/patch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) }))
			.then(async (r) => {
				if (!r.ok) throw new Error("patch " + r.status);
				const { rev } = (await r.json()) as { rev: number };
				revRef.current = Math.max(revRef.current, rev);
				setSaveError(false);
			})
			.catch(() => setSaveError(true));
	}, []);

	const submitPasscode = useCallback(async (pass: string) => {
		write(PASS_KEY, pass);
		const ok = await refresh().catch(() => false);
		if (ok) location.reload();
		return ok;
	}, [refresh]);

	const photos = useMemo(() => ({
		async get(pid: string) {
			const c = photoCache.current.get(pid);
			if (c) return c;
			try {
				const r = await api("/api/photo/" + pid);
				if (!r.ok) return undefined;
				const t = await r.text();
				photoCache.current.set(pid, t);
				return t;
			} catch { return undefined; }
		},
		async put(dataUrl: string) {
			const pid = uid("p_");
			const r = await api("/api/photo/" + pid, { method: "PUT", body: dataUrl });
			if (!r.ok) throw new Error("画像を保存できませんでした");
			photoCache.current.set(pid, dataUrl);
			return pid;
		},
		del(pid: string) {
			photoCache.current.delete(pid);
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
