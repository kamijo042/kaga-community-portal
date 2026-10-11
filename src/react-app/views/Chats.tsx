import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CatPill, Dot, Empty, NegPill, Prices, StatusPill, Stone } from "../components/ui";
import { useActions } from "../lib/actions";
import { useApp } from "../lib/app";
import { counterpart, homeOf, isUnread, nameOf, itemStone, KIND_LABEL, myThreads, roleOf } from "../lib/domain";
import { useData } from "../lib/store";
import { ago, clock, fmt, todayStr } from "../lib/util";
import { PostDetail } from "./Info";

export function ChatsView() {
	const { d, me } = useData();
	const { openChat } = useApp();
	if (!me) return null;
	const list = myThreads(d, me);
	return (
		<>
			<div className="view-head"><div><h2>相談</h2><p>仕事・フリマ・情報の個別チャットです。条件がまとまったら、会って受け渡しと石のやり取りをしてください。</p></div></div>
			{list.length === 0 ? (
				<Empty title="まだ相談はありません">仕事の「相談する」やフリマの「購入を相談する」、情報の「投稿者に質問する」から始めると、ここに並びます。自分の登録に相談が届いたときもここに表示されます。</Empty>
			) : (
				<div className="threads">
					{list.map((t) => {
						const other = counterpart(t, me);
						const it = t.kind === "item" ? d.items[t.refId] : null;
						return (
							<button key={t.id} className="thread" onClick={() => openChat(t.id)}>
								<Dot id={other} />
								<div className="t-main">
									<div className="t-line1">
										<span className="t-title">{nameOf(d, other)}</span><span className="t-home">{homeOf(d, other)}</span>
										<span className="kind">{KIND_LABEL[t.kind]}</span>
										{it && <StatusPill s={it.status} />}
										<span className="t-time" style={{ marginLeft: "auto" }}>{ago(t.lastAt || t.createdAt)}</span>
									</div>
									<div style={{ fontSize: 13 }}>{t.title} <span style={{ color: "var(--faint)" }}>・ {roleOf(t, me)}</span></div>
									<div className="t-last">{t.lastText || "（まだメッセージはありません）"}</div>
								</div>
								{isUnread(d, me, t) && <span className="unread" aria-label="未読" />}
							</button>
						);
					})}
				</div>
			)}
		</>
	);
}

export function ChatDrawer({ tid }: { tid: string }) {
	const { d, me } = useData();
	const { closeChat, openModal, toast } = useApp();
	const actions = useActions();
	const [text, setText] = useState("");
	const [dealOpen, setDealOpen] = useState(false);
	const [amt, setAmt] = useState("");
	const [date, setDate] = useState(todayStr());
	const boxRef = useRef<HTMLDivElement>(null);
	const t = d.threads[tid];
	const msgs = d.messages[tid] ?? [];

	// 開いている間は既読にする
	const lastAt = t?.lastAt ?? 0;
	useEffect(() => { actions.markRead(tid); }, [tid, lastAt]); // eslint-disable-line react-hooks/exhaustive-deps
	useLayoutEffect(() => { const b = boxRef.current; if (b) b.scrollTop = b.scrollHeight; }, [msgs.length, tid]);
	useEffect(() => {
		const k = (e: KeyboardEvent) => { if (e.key === "Escape") closeChat(); };
		addEventListener("keydown", k);
		return () => removeEventListener("keydown", k);
	}, [closeChat]);

	if (!t || !me) return null;
	const other = counterpart(t, me);
	const it = t.kind === "item" ? d.items[t.refId] : null;
	const job = t.kind === "job" ? d.jobs[t.refId] : null;
	const post = t.kind === "info" ? d.posts[t.refId] : null;
	const recs = Object.values(d.ledger).filter((e) => e.tid === tid).sort((a, b) => a.at - b.at);

	const send = () => { const x = text.trim(); if (!x) return; actions.send(tid, x); setText(""); };
	const openDeal = () => {
		setAmt(String(job ? job.price : it ? itemStone(it) ?? 0 : 0));
		setDate(todayStr());
		setDealOpen(true);
	};
	const okDeal = () => {
		const n = parseInt(amt, 10);
		if (!(n >= 0) || String(n) !== amt.trim()) return toast("石の額を0以上の整数で入力してください");
		if (date > todayStr()) return toast("未来の日付は記録できません");
		actions.recordDeal(tid, n, date);
		setDealOpen(false);
	};

	let deal = null;
	if (t.kind === "job") {
		if (!job) deal = <div className="deal closed"><span className="lbl">この仕事は削除されました</span></div>;
		else {
			const sum = recs.reduce((a, e) => a + e.amount, 0);
			const last = recs[recs.length - 1];
			deal = (
				<div className="deal">
					<span className="lbl">{job.title}</span><Stone n={job.price} /><NegPill yes={job.negotiable} />
					{!dealOpen && <button className="btn small primary" id="deal-open" onClick={openDeal}>依頼成立を記録</button>}
					{last && (
						<span className="deal-recs">この相談の成立記録：{recs.length}回・計 {fmt(sum)}石（最新 {last.date}）
							<button className="btn small ghost" id="deal-undo" onClick={() => actions.undoDeal(tid, last.id)}>最新の記録を取り消す</button>
						</span>
					)}
				</div>
			);
		}
	} else if (t.kind === "item") {
		if (!it) deal = <div className="deal closed"><span className="lbl">この出品は削除されました</span></div>;
		else {
			const done = it.status === "done";
			const who = done ? (it.buyer === other || it.buyer === me ? "この相談で交渉成立 — 出品は終了しました" : "他の方と交渉成立済みです") : "";
			const seller = it.owner === me;
			deal = (
				<div className={`deal ${done ? "closed" : ""}`}>
					<span className="lbl">{it.name}{who && <><br /><b style={{ color: "var(--ink)" }}>{who}</b></>}</span>
					<Prices item={it} /><StatusPill s={it.status} />
					{seller && done && it.buyer === other && <button className="btn small" onClick={() => actions.setItemStatus(tid, "open")}>成立を取り消す</button>}
					{seller && !done && (it.status === "open"
						? <button className="btn small" onClick={() => actions.setItemStatus(tid, "nego")}>交渉中にする</button>
						: <button className="btn small" onClick={() => actions.setItemStatus(tid, "open")}>出品中に戻す</button>)}
					{seller && !done && !dealOpen && <button className="btn small primary" id="deal-open" onClick={openDeal}>この相手と交渉成立</button>}
				</div>
			);
		}
	} else {
		deal = post
			? <div className="deal"><span className="lbl">{post.title}</span><CatPill cat={post.cat} /><button className="btn small" onClick={() => { closeChat(); openModal(<PostDetail id={post.id} />); }}>投稿を見る</button></div>
			: <div className="deal closed"><span className="lbl">この投稿は削除されました</span></div>;
	}
	const canDeal = dealOpen && (job || (it && it.owner === me && it.status !== "done"));

	return (
		<div className="drawer" onMouseDown={(e) => { if (e.target === e.currentTarget) closeChat(); }}>
			<section className="chat" role="dialog" aria-label="相談チャット">
				<div className="chat-head">
					<div className="l1">
						<Dot id={other} />
						<div className="t"><h2>{nameOf(d, other)}</h2><div className="with">{homeOf(d, other)} ・ {KIND_LABEL[t.kind]}の相談 ・ {roleOf(t, me)}</div></div>
						<button className="x" onClick={closeChat} aria-label="閉じる">×</button>
					</div>
					{deal}
					{canDeal && (
						<div className="deal-form">
							<label htmlFor="deal-amt">流通した石<input type="number" id="deal-amt" min={0} step={1} value={amt} onChange={(e) => setAmt(e.target.value)} autoFocus /></label>
							<label htmlFor="deal-date">日付<input type="date" id="deal-date" value={date} max={todayStr()} onChange={(e) => setDate(e.target.value)} /></label>
							<button className="btn small primary" id="deal-ok" onClick={okDeal}>{job ? "成立を記録する" : "交渉成立にする"}</button>
							<button className="btn small ghost" onClick={() => setDealOpen(false)}>やめる</button>
							<p>{job ? "話し合って決まった石の額を記録します。" : "受け渡す石の額を記録すると、出品は終了します。"}記録は石の流通量に反映され、運営が確認します。</p>
						</div>
					)}
				</div>
				<div className="msgs" ref={boxRef}>
					{msgs.length === 0 && (
						<div className="msg sys"><div className="bub">{t.kind === "info" ? "投稿について聞きたいことを送ってみましょう。" : t.kind === "job" ? "希望の日時や作業の範囲、石の額について相談してみましょう。" : "受け渡しの日時・場所や、品物の状態について聞いてみましょう。"}</div></div>
					)}
					{msgs.map((m) => m.sys ? (
						<div className="msg sys" key={m.id}><div className="bub">{m.text}</div><span className="tm">{clock(m.t)}</span></div>
					) : (
						<div className={`msg ${m.from === me ? "me" : ""}`} key={m.id}>
							<div className="bub">{m.text}</div>
							<span className="tm">{m.from === me ? "" : nameOf(d, m.from) + " ・ "}{clock(m.t)}</span>
						</div>
					))}
				</div>
				<div className="compose">
					<textarea id="chat-in" rows={1} placeholder="メッセージを入力" value={text} onChange={(e) => setText(e.target.value)}
						onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
					<button className="btn primary" id="send" onClick={send}>送信</button>
				</div>
				<div className="compose-hint">Ctrl（⌘）+ Enter で送信</div>
			</section>
		</div>
	);
}
