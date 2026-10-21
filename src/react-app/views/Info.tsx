import { useState } from "react";
import { CatPill, Empty, Modal, Owner, Photo, Pill, ZoomPhoto } from "../components/ui";
import { PostForm } from "../forms/PostForm";
import { useActions } from "../lib/actions";
import { useApp } from "../lib/app";
import { acceptsRsvp, CATS, evDateStr, evOrder, evPast, evStart, isFunding, familySize, forMyKids, goCount, hhLabel, householdOf, matchesFamily, myBuckets, nameOf } from "../lib/domain";
import { useData } from "../lib/store";
import type { Post, PostCat } from "../lib/types";
import { ago, WD, safeHttpUrl } from "../lib/util";
import { postPublicApi } from "../lib/api";

/** 一覧では場所の1行目だけを出す（全文は詳細で） */
const firstLine = (s?: string) => (s ?? "").split(/\r?\n/).map((x) => x.trim()).find(Boolean) ?? "";

function DateBox({ p }: { p: Post }) {
	const d = evStart(p);
	if (!d) return null;
	return (
		<span className={`datebox ${evPast(p) ? "past" : ""}`}>
			<span className="m">{d.getMonth() + 1}月</span>
			<span className="d">{d.getDate()}</span>
			<span className="w">{WD[d.getDay()]}曜</span>
		</span>
	);
}

export function InfoView() {
	const { d, me } = useData();
	const { openModal, infoPrev } = useApp();
	const [cat, setCat] = useState<"all" | PostCat>("all");
	const [fam, setFam] = useState(false);
	const [q, setQ] = useState("");
	/** 終了したイベントは普段は隠し、押したときだけ表示する */
	const [showEnded, setShowEnded] = useState(false);
	if (!me) return null;

	const all = Object.values(d.posts);
	const upcoming = all.filter((p) => evStart(p) && !evPast(p)).sort((a, b) => +evStart(a)! - +evStart(b)!).slice(0, 4);
	let list = all.filter((p) => cat === "all" || p.cat === cat);
	if (fam) list = list.filter((p) => matchesFamily(d, me, p));
	const qq = q.trim().toLowerCase();
	if (qq) list = list.filter((p) => `${p.title} ${p.body} ${p.kind} ${p.event?.place ?? ""}`.toLowerCase().includes(qq));
	// どの分類でも：日付のあるものは開催日が近い順 → 日付のないものは新しい投稿順（終了したものは下の別枠）
	list.sort(evOrder);
	// 日付が過ぎた投稿（終了したイベント）は別にまとめる。新しく終わった順
	const ended = list.filter((p) => evPast(p)).sort((a, b) => +evStart(b)! - +evStart(a)!);
	const active = list.filter((p) => !evPast(p));
	const hasKids = [...myBuckets(d, me)].some((x) => x !== "大人");
	const renderPost = (p: Post) => {
						const g = acceptsRsvp(p) ? goCount(p) : null;
						return (
							<button key={p.id} className={`post ${evPast(p) ? "is-past" : ""}`} onClick={() => openModal(<PostDetail id={p.id} />)}>
								{evStart(p) ? <DateBox p={p} /> : p.photo ? <span className="pthumb"><Photo pid={p.photo} /></span> : null}
								<span className="pmain">
									<span className="meta-row">
										<CatPill cat={p.cat} />
										{p.kind && <Pill cls="tgt">{p.kind}</Pill>}
										{forMyKids(d, me, p) && <Pill cls="fam">わが家向け</Pill>}
										{p.owner !== me && p.createdAt > infoPrev && <Pill cls="new">新着</Pill>}
										{evPast(p) && <Pill cls="done">{isFunding(p) ? "締切済み" : "終了"}</Pill>}
									</span>
									<h3>{p.title}</h3>
									{(evDateStr(p) || p.event?.place) && <span style={{ fontSize: 13 }}>{[evDateStr(p), firstLine(p.event?.place)].filter(Boolean).join(" ・ ")}</span>}
									<span className="excerpt">{p.body}</span>
									<span className="pfoot">
										<span>{nameOf(d, p.owner)}</span>
										<span>{ago(p.createdAt)}</span>
										{p.targets?.length > 0 && <span>対象：{p.targets.join("・")}</span>}
										{g && <span>参加 {g.hh}世帯{p.event?.capacity ? ` / 定員 ${p.event.capacity}人` : ""}</span>}
									</span>
								</span>
							</button>
						);
					};
	const newPost = () => openModal(<PostForm defaultCat={cat === "all" ? "event" : cat} />);

	return (
		<>
			<div className="view-head">
				<div><h2>情報</h2><p>農業・教育・防災・地域イベントの情報を、世帯どうしで持ち寄る掲示板です。日付を入れると「近日の予定」に出ます。</p></div>
				<button className="btn primary" id="post-new" onClick={newPost}>＋ 投稿する</button>
			</div>
			{upcoming.length > 0 && (
				<>
					<p className="sec-title">近日の予定</p>
					<div className="upcoming">
						{upcoming.map((p) => {
							const g = goCount(p);
							return (
								<button key={p.id} className="ev" onClick={() => openModal(<PostDetail id={p.id} />)}>
									<DateBox p={p} />
									<span className="ev-main">
										<span className="ev-title">{p.title}</span>
										<span className="ev-sub">{isFunding(p) ? "クラウドファンディング締切" : [p.cat !== "event" ? CATS[p.cat]?.label : "", p.event?.start, firstLine(p.event?.place)].filter(Boolean).join(" ・ ") || "時間・場所は詳細へ"}</span>
										{acceptsRsvp(p) && <span className="ev-sub">参加 {g.hh}世帯{g.people ? `（${g.people}人）` : ""}{p.rsvps?.[householdOf(d, me) ?? ""]?.s === "go" && <b style={{ color: "var(--accent)" }}> ・ 参加予定</b>}</span>}
									</span>
								</button>
							);
						})}
					</div>
				</>
			)}
			<div className="toolbar">
				<input className="search" type="search" placeholder="情報を検索（例：田植え、学童、避難所、清掃）" value={q} onChange={(e) => setQ(e.target.value)} />
				<div className="chips">
					{([["all", "すべて"], ["farm", "農業"], ["edu", "教育"], ["bousai", "防災"], ["event", "地域イベント"]] as const).map(([v, l]) => (
						<button key={v} className="chip-btn" aria-pressed={cat === v} onClick={() => setCat(v)}>{l}</button>
					))}
					<button className="chip-btn" aria-pressed={fam} onClick={() => setFam(!fam)} title="家族構成の年齢に合う情報だけを表示">わが家向け</button>
				</div>
			</div>
			{active.length === 0 && ended.length === 0 ? (
				all.length === 0 ? (
					<Empty title="まだ情報がありません" action={<button className="btn primary" onClick={newPost}>最初の情報を投稿する</button>}>
						学校や習い事の情報、農作業の手伝い募集、地域の行事など、移住者どうしで役立つことを共有しましょう。イベントには参加表明ができ、対象年齢を付けると子どものいる世帯に「わが家向け」と表示されます。
					</Empty>
				) : (
					<Empty title="条件に合う情報がありません">
						{fam && !hasKids ? "「わが家向け」は家族構成の生まれ年から判定します。右上のメニュー →「世帯と家族」で家族の生まれ年を登録してください。" : "検索語や絞り込みを変えてみてください。"}
					</Empty>
				)
			) : (
				<>
					{active.length > 0 ? (
						<div className="posts">{active.map(renderPost)}</div>
					) : (
						<Empty title="これからの情報はありません">終了したイベントは下から見られます。</Empty>
					)}
					{ended.length > 0 && (
						<div className="ended">
							<button className="ended-toggle" id="ended-toggle" aria-expanded={showEnded} onClick={() => setShowEnded(!showEnded)}>
								{showEnded ? "終了したイベントを閉じる" : "終了したイベントを表示"}
							</button>
							{showEnded && <div className="posts ended-list">{ended.map(renderPost)}</div>}
						</div>
					)}
				</>
			)}
		</>
	);
}

/** 押すと「もう一度押すと外す」に変わる、2段階の確認ボタン */
function RemoveButton({ onConfirm }: { onConfirm: () => void }) {
	const [armed, setArmed] = useState(false);
	return <button type="button" className={`btn small ghost ${armed ? "danger" : ""}`} onClick={() => (armed ? onConfirm() : setArmed(true))}>{armed ? "もう一度押すと外す" : "外す"}</button>;
}

export function PostDetail({ id }: { id: string }) {
	const { d, me, mutate } = useData();
	const { closeModal, openModal, toast } = useApp();
	const actions = useActions();
	const p = d.posts[id];
	const hid = householdOf(d, me);
	const [n, setN] = useState(() => String((hid && p?.rsvps?.[hid]?.n) || (hid ? familySize(d, hid) : 1)));
	if (!p || !me || !hid) return <Modal title="情報" onClose={closeModal}><p>この投稿は削除されました。</p></Modal>;
	const mine = p.owner === me;
	const g = goCount(p);
	const my = p.rsvps?.[hid];
	const past = evPast(p);
	const href = p.link ? safeHttpUrl(p.link) : null;
	const hasSchedule = p.cat === "event" || !!(p.event?.date || p.event?.start || p.event?.place);
	const goers = Object.entries(p.rsvps ?? {}).filter(([, x]) => x.s === "go").sort((a, b) => a[1].at - b[1].at);
	const maybes = Object.entries(p.rsvps ?? {}).filter(([, x]) => x.s === "maybe").sort((a, b) => a[1].at - b[1].at);
	const accepting = acceptsRsvp(p);
	const guests = Object.values(d.guests ?? {}).filter((x) => x.postId === id).sort((a, b) => a.at - b.at);
	const guestPeople = guests.reduce((a, x) => a + (Number(x.n) || 1), 0);
	const full = !!p.event?.capacity && g.people + guestPeople >= p.event.capacity && my?.s !== "go";
	const publicUrl = p.publicToken ? `${location.origin}/e/${p.publicToken}` : "";
	const removeGuest = (gid: string, name: string) => {
		mutate((st) => { delete st.guests[gid]; });
		toast(`${name}さんを参加者から外しました`);
	};
	const setPublic = async (action: "issue" | "stop") => {
		try {
			const r = action === "issue" ? await postPublicApi.issue(id) : await postPublicApi.stop(id);
			mutate((st) => { st.posts[id] = { ...st.posts[id], publicToken: r.token }; });
			toast(action === "stop" ? "公開URLを止めました" : "公開URLを発行しました");
		} catch (e) { toast((e as Error).message); }
	};
	const copyText = async (text: string, done: string) => { try { await navigator.clipboard.writeText(text); toast(done); } catch { toast("コピーできませんでした"); } };
	const closed = !!p.rsvpClosed;
	/** 参加者を外す（投稿者だけ） */
	const removeRsvp = (h: string) => {
		mutate((st) => { delete st.posts[id].rsvps?.[h]; });
		toast(`${hhLabel(d, h)}を参加者から外しました`);
	};
	/** 受付の締め切り・再開（投稿者だけ） */
	const toggleClosed = () => {
		mutate((st) => { st.posts[id] = { ...st.posts[id], rsvpClosed: !closed, updatedAt: Date.now() }; });
		toast(closed ? "受付を再開しました" : "受付を締め切りました");
	};
	/** 参加者の一覧をテキストでコピー（投稿者だけ） */
	const copyList = async () => {
		const lines = [`${p.title}　参加 ${g.hh}世帯・${g.people}人`, ...goers.map(([h, x], i) => `${i + 1}. ${hhLabel(d, h)}　${x.n}人${x.by ? `（申込：${nameOf(d, x.by)}）` : ""}`)];
		if (guests.length) lines.push("", `会員以外（${guests.length}組・${guestPeople}人）`, ...guests.map((x, i) => `${i + 1}. ${x.name}　${x.n}人${x.note ? `（${x.note}）` : ""}`));
		if (maybes.length) lines.push("", "興味あり：" + maybes.map(([h]) => hhLabel(d, h)).join("、"));
		try { await navigator.clipboard.writeText(lines.join("\n")); toast("参加者の一覧をコピーしました"); } catch { toast("コピーできませんでした"); }
	};

	const rsvp = (s: "go" | "maybe" | "none") => {
		const num = Math.max(1, Math.min(20, parseInt(n, 10) || 1));
		mutate((st) => {
			const post = st.posts[id];
			post.rsvps ??= {};
			// 参加表明は世帯単位（家族の誰が押しても同じ）
			if (s === "none") delete post.rsvps[hid];
			else post.rsvps[hid] = { s, n: s === "go" ? num : 0, at: Date.now(), by: me };
		});
		toast(s === "go" ? "参加を登録しました" : s === "maybe" ? "興味ありにしました" : "取り消しました");
	};

	return (
		<Modal
			title={CATS[p.cat]?.label ?? "情報"}
			onClose={closeModal}
			footer={<>
				{mine && <button className="btn" onClick={() => openModal(<PostForm existing={p} />)}>編集</button>}
				<button className="btn ghost" onClick={closeModal}>閉じる</button>
				{!mine && <button className="btn primary" id="consult-info" onClick={() => actions.startThread("info", p.id)}>投稿者に質問する</button>}
			</>}
		>
			{p.photo && <div className="gallery"><div className="main-ph"><ZoomPhoto pid={p.photo} alt={p.title} /></div></div>}
			<div className="meta-row">
				<CatPill cat={p.cat} />
				{p.kind && <Pill cls="tgt">{p.kind}</Pill>}
				{forMyKids(d, me, p) && <Pill cls="fam">わが家向け</Pill>}
				{past && <Pill cls="done">{isFunding(p) ? "締切済み" : "終了"}</Pill>}
			</div>
			<h3 style={{ fontSize: 19 }}>{p.title}</h3>
			{hasSchedule && p.event && (
				<dl className="evbox">
					{evStart(p) && <><dt>{isFunding(p) ? "締切日" : "日時"}</dt><dd>{evDateStr(p, false)}</dd></>}
					{p.event.place && <><dt>場所</dt><dd className="multiline">{p.event.place}</dd></>}
					{p.targets?.length > 0 && <><dt>対象</dt><dd>{p.targets.join("・")}</dd></>}
					{p.event.capacity && <><dt>定員</dt><dd>{p.event.capacity}人</dd></>}
					{p.event.bring && <><dt>持ち物</dt><dd>{p.event.bring}</dd></>}
				</dl>
			)}
			{!hasSchedule && p.targets?.length > 0 && <p style={{ fontSize: 13, color: "var(--muted)" }}>対象：{p.targets.join("・")}</p>}
			{p.body && <p className="detail-desc">{p.body}</p>}
			{href && <p style={{ fontSize: 14, wordBreak: "break-all" }}>参考リンク：<a href={href} target="_blank" rel="noopener noreferrer">{p.link}</a></p>}
			{accepting && (
				<div className="rsvp">
					<div className="rs-row">
						<b style={{ marginRight: "auto" }}>参加 {g.hh}世帯・{g.people}人{guests.length ? ` ＋ 会員以外 ${guests.length}組・${guestPeople}人` : ""}{p.event?.capacity ? ` ／ 定員 ${p.event.capacity}人` : ""}{g.maybe ? ` ／ 興味あり ${g.maybe}世帯` : ""}</b>
						{closed && <Pill cls="off">受付終了</Pill>}
						{my && <Pill cls={my.s === "go" ? "open" : "nego"}>{my.s === "go" ? `参加予定（${my.n}人）` : "興味あり"}</Pill>}
					</div>
					{past ? <p className="who-list">終了しました。</p> : closed ? (
						<div className="rs-row">
							<p className="who-list" style={{ marginRight: "auto" }}>参加の受付は締め切られました。</p>
							{my && <button className="btn small ghost" onClick={() => rsvp("none")}>取り消す</button>}
						</div>
					) : (
						<div className="rs-row">
							<label htmlFor="rs-n" style={{ fontSize: 13 }}>人数</label>
							<input type="number" id="rs-n" min={1} max={20} value={n} onChange={(e) => setN(e.target.value)} />
							<button className="btn small primary" id="rsvp-go" disabled={full} onClick={() => rsvp("go")}>{full ? "定員に達しました" : my?.s === "go" ? "人数を更新" : "参加する"}</button>
							<button className="btn small" onClick={() => rsvp("maybe")}>興味あり</button>
							{my && <button className="btn small ghost" onClick={() => rsvp("none")}>取り消す</button>}
						</div>
					)}
					{(goers.length > 0 || maybes.length > 0 || guests.length > 0) && (
						<div className="rs-list" id="rs-list">
							{goers.length > 0 && <p className="rs-head">参加予定（{goers.length}世帯）</p>}
							{goers.map(([h, x]) => (
								<div className="rs-person" key={h}>
									<span className="rs-name"><b>{hhLabel(d, h)}</b>{x.by && <small>申込：{nameOf(d, x.by)}</small>}</span>
									<span className="rs-n">{x.n}人</span>
									{mine && <RemoveButton onConfirm={() => removeRsvp(h)} />}
								</div>
							))}
							{guests.length > 0 && <p className="rs-head">会員以外（公開URLから・{guests.length}組）</p>}
							{guests.map((x) => (
								<div className="rs-person" key={x.id}>
									<span className="rs-name"><b>{x.name}</b>{x.note && <small>{x.note}</small>}</span>
									<span className="rs-n">{x.n}人</span>
									{mine && <RemoveButton onConfirm={() => removeGuest(x.id, x.name)} />}
								</div>
							))}
							{maybes.length > 0 && <p className="rs-head">興味あり（{maybes.length}世帯）</p>}
							{maybes.map(([h, x]) => (
								<div className="rs-person" key={h}>
									<span className="rs-name"><b>{hhLabel(d, h)}</b>{x.by && <small>{nameOf(d, x.by)}</small>}</span>
									{mine && <RemoveButton onConfirm={() => removeRsvp(h)} />}
								</div>
							))}
						</div>
					)}
					{mine && (
						<div className="rs-row rs-admin">
							<span className="rs-admin-lbl">主催者メニュー</span>
							<button className="btn small" id="rs-close" onClick={toggleClosed}>{closed ? "受付を再開する" : "受付を締め切る"}</button>
							{(goers.length > 0 || guests.length > 0) && <button className="btn small ghost" id="rs-copy" onClick={copyList}>一覧をコピー</button>}
						</div>
					)}
					{mine && (
						<div className="rs-public">
							<p className="rs-head" style={{ margin: 0 }}>会員以外も参加できるURL</p>
							{publicUrl ? (
								<>
									<div className="copy-row">
										<input type="text" id="rs-public-url" readOnly value={publicUrl} onFocus={(e) => e.currentTarget.select()} aria-label="公開URL" />
										<button className="btn small" onClick={() => copyText(publicUrl, "URLをコピーしました")}>コピー</button>
									</div>
									<div className="rs-row">
										<button className="btn small ghost" onClick={() => setPublic("issue")}>URLを作り直す</button>
										<button className="btn small ghost danger" id="rs-public-stop" onClick={() => setPublic("stop")}>URLを止める</button>
									</div>
									<p className="hint-p">このURLを開いた人は、ログインなしでタイトル・日時・場所（先頭6文字まで）を見て、名前と人数で参加登録できます。説明・参加者の名前や人数・投稿者は表示されません。作り直すと前のURLは使えなくなります。</p>
								</>
							) : (
								<>
									<p className="hint-p">LINE などで会員以外の人も誘えるURLを発行します。URLを知っている人は誰でもタイトル・日時・場所の先頭6文字を見られます（例：「山代温泉 総湯前広場」→「山代温泉 総…」）。</p>
									<button className="btn small" id="rs-public-issue" onClick={() => setPublic("issue")}>URLを発行する</button>
								</>
							)}
						</div>
					)}
				</div>
			)}
			<Owner id={p.owner} extra={<> ・ {ago(p.createdAt)}</>} />
		</Modal>
	);
}
