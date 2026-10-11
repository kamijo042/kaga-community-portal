import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AccountMenu } from "./components/AccountMenu";
import { IconBag, IconInfo, IconJob, IconStone } from "./components/icons";
import { CONFIG } from "./config";
import { AppContext, type AppCtx, type Tab } from "./lib/app";
import { newPostCount, unreadCount } from "./lib/domain";
import { DataProvider, useData } from "./lib/store";
import { ChatDrawer, ChatsView } from "./views/Chats";
import { FlowView } from "./views/Flow";
import { LoginGate, SetupGate } from "./views/Gate";
import { HomeView } from "./views/Home";
import { InfoView } from "./views/Info";
import { JobsView } from "./views/Jobs";
import { MarketView } from "./views/Market";

export default function App() {
	return (
		<DataProvider>
			<Shell />
		</DataProvider>
	);
}

/** メニューは 情報・仕事・フリマ・石（石は管理者だけ）。相談と世帯は右上のメニューから開く */
const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
	{ id: "info", label: "情報", icon: <IconInfo /> },
	{ id: "jobs", label: "仕事", icon: <IconJob /> },
	{ id: "market", label: "フリマ", icon: <IconBag /> },
	{ id: "flow", label: "石", icon: <IconStone /> },
];

function Shell() {
	const { d, me, user, mutate, status, saveError, connected } = useData();
	const [tab, setTab] = useState<Tab>("info");
	const [chatId, setChatId] = useState<string | null>(null);
	const [modal, setModal] = useState<ReactNode>(null);
	const [toastMsg, setToastMsg] = useState<string | null>(null);
	const [infoPrev, setInfoPrev] = useState(0);
	const [jobMode, setJobMode] = useState<"browse" | "mine">("browse");
	const [mktMode, setMktMode] = useState<"browse" | "mine">("browse");
	const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	const toast = useCallback((msg: string) => {
		setToastMsg(msg);
		clearTimeout(toastTimer.current);
		toastTimer.current = setTimeout(() => setToastMsg(null), 2600);
	}, []);

	/** 情報タブを開いたときに「新着」の基準時刻を更新 */
	const markInfoSeen = useCallback((who: string) => {
		setInfoPrev(d.seen[who] ?? 0);
		if (!d.seen[who] || newPostCount(d, who) > 0) mutate((s) => { s.seen[who] = Date.now(); });
	}, [d, mutate]);

	const goTab = useCallback((t: Tab) => {
		setTab(t);
		if (t === "info" && me) markInfoSeen(me);
		window.scrollTo(0, 0);
	}, [me, markInfoSeen]);

	// 起動時（ログイン済み）に一度だけ、情報タブの既読基準を記録
	const landed = useRef<string | null>(null);
	useEffect(() => {
		if (status === "ready" && me && landed.current !== me) { landed.current = me; markInfoSeen(me); }
	}, [status, me, markInfoSeen]);

	// ログアウト・ログインし直したら画面の状態をリセット
	useEffect(() => {
		if (!me) { setChatId(null); setModal(null); setTab("info"); landed.current = null; }
	}, [me]);

	const ctx = useMemo<AppCtx>(() => ({
		tab, goTab, chatId,
		openChat: (tid) => { setModal(null); setChatId(tid); },
		closeChat: () => setChatId(null),
		openModal: (node) => setModal(node),
		closeModal: () => setModal(null),
		toast, infoPrev, jobMode, setJobMode, mktMode, setMktMode,
	}), [tab, goTab, chatId, toast, infoPrev, jobMode, mktMode]);

	let body: ReactNode;
	if (status === "loading") body = <div className="wrap loading">読み込み中…</div>;
	else if (status === "offline") body = <div className="wrap loading">サーバーに接続できません。通信状態を確認して、再読み込みしてください。</div>;
	else if (status === "setup") body = <SetupGate />;
	else if (status === "login" || !me) body = <LoginGate />;
	else {
		const unread = unreadCount(d, me);
		const newPosts = newPostCount(d, me);
		body = (
			<>
				<header className="top">
					<div className="wrap top-row">
						<div className="brand">
							<span className="brand-mark" aria-hidden="true" />
							<div><h1>{CONFIG.siteName}</h1><small>{CONFIG.tagline}</small></div>
						</div>
						<nav className="tabs" role="tablist" aria-label="メニュー">
							{TABS.filter((t) => t.id !== "flow" || user?.role === "admin").map((t) => {
								const badge = t.id === "info" && tab !== "info" ? newPosts : 0;
								return (
									<button key={t.id} className="tab" role="tab" data-tab={t.id} aria-selected={tab === t.id} onClick={() => goTab(t.id)}>
										<span className="tab-ic">{t.icon}{badge > 0 && <span className="badge">{badge}</span>}</span>
										<span className="tab-lbl">{t.label}</span>
									</button>
								);
							})}
						</nav>
						<AccountMenu unread={unread} />
					</div>
				</header>
				{saveError && <div className="wrap"><p className="save-error">サーバーに保存できませんでした。通信状態を確認してください。次の操作のときに再送します。</p></div>}
				<main className="wrap">
					{tab === "info" && <InfoView />}
					{tab === "jobs" && <JobsView />}
					{tab === "market" && <MarketView />}
					{tab === "chat" && <ChatsView />}
					{tab === "flow" && user?.role === "admin" && <FlowView />}
					{tab === "home" && <HomeView />}
				</main>
				<p className="local-note wrap">
					<span className={`live ${connected ? "on" : ""}`} />{connected ? "リアルタイムで同期しています" : "再接続しています…"}。石のやり取りと受け渡しは対面で行います。
				</p>
			</>
		);
	}

	return (
		<AppContext.Provider value={ctx}>
			{body}
			{modal}
			{chatId && me && <ChatDrawer tid={chatId} />}
			{toastMsg && <div className="toast" role="status">{toastMsg}</div>}
		</AppContext.Provider>
	);
}
