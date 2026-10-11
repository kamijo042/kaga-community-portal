import { useState } from "react";
import { CatPill, Empty, Modal, Owner, Photo, Pill } from "../components/ui";
import { PostForm } from "../forms/PostForm";
import { useActions } from "../lib/actions";
import { useApp } from "../lib/app";
import { CATS, evDateStr, evOrder, evPast, evStart, isFunding, familySize, forMyKids, goCount, hhLabel, householdOf, matchesFamily, myBuckets, nameOf } from "../lib/domain";
import { useData } from "../lib/store";
import type { Post, PostCat } from "../lib/types";
import { ago, WD, safeHttpUrl } from "../lib/util";

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
	if (!me) return null;

	const all = Object.values(d.posts);
	const upcoming = all.filter((p) => p.cat === "event" && evStart(p) && !evPast(p)).sort((a, b) => +evStart(a)! - +evStart(b)!).slice(0, 4);
	let list = all.filter((p) => cat === "all" || p.cat === cat);
	if (fam) list = list.filter((p) => matchesFamily(d, me, p));
	const qq = q.trim().toLowerCase();
	if (qq) list = list.filter((p) => `${p.title} ${p.body} ${p.kind} ${p.event?.place ?? ""}`.toLowerCase().includes(qq));
	if (cat === "event") list.sort(evOrder);
	else list.sort((a, b) => b.createdAt - a.createdAt);
	const hasKids = [...myBuckets(d, me)].some((x) => x !== "大人");
	const newPost = () => openModal(<PostForm defaultCat={cat === "all" ? "event" : cat} />);

	return (
		<>
			<div className="view-head">
				<div><h2>情報</h2><p>農業・教育・防災・地域イベントの情報を、世帯どうしで持ち寄る掲示板です。</p></div>
				<button className="btn primary" id="post-new" onClick={newPost}>＋ 投稿する</button>
			</div>
			{upcoming.length > 0 && (
				<>
					<p className="sec-title">近日のイベント</p>
					<div className="upcoming">
						{upcoming.map((p) => {
							const g = goCount(p);
							return (
								<button key={p.id} className="ev" onClick={() => openModal(<PostDetail id={p.id} />)}>
									<DateBox p={p} />
									<span className="ev-main">
										<span className="ev-title">{p.title}</span>
										<span className="ev-sub">{isFunding(p) ? "クラウドファンディング締切" : [p.event?.start, p.event?.place].filter(Boolean).join(" ・ ") || "時間・場所は詳細へ"}</span>
										<span className="ev-sub">参加 {g.hh}世帯{g.people ? `（${g.people}人）` : ""}{p.rsvps?.[householdOf(d, me) ?? ""]?.s === "go" && <b style={{ color: "var(--accent)" }}> ・ 参加予定</b>}</span>
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
			{list.length === 0 ? (
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
				<div className="posts">
					{list.map((p) => {
						const g = p.cat === "event" ? goCount(p) : null;
						return (
							<button key={p.id} className={`post ${evPast(p) ? "is-past" : ""}`} onClick={() => openModal(<PostDetail id={p.id} />)}>
								{p.cat === "event" && evStart(p) ? <DateBox p={p} /> : p.photo ? <span className="pthumb"><Photo pid={p.photo} /></span> : null}
								<span className="pmain">
									<span className="meta-row">
										<CatPill cat={p.cat} />
										{p.kind && <Pill cls="tgt">{p.kind}</Pill>}
										{forMyKids(d, me, p) && <Pill cls="fam">わが家向け</Pill>}
										{p.owner !== me && p.createdAt > infoPrev && <Pill cls="new">新着</Pill>}
										{evPast(p) && <Pill cls="done">{isFunding(p) ? "締切済み" : "終了"}</Pill>}
									</span>
									<h3>{p.title}</h3>
									{p.cat === "event" && (evDateStr(p) || p.event?.place) && <span style={{ fontSize: 13 }}>{[evDateStr(p), p.event?.place].filter(Boolean).join(" ・ ")}</span>}
									<span className="excerpt">{p.body}</span>
									<span className="pfoot">
										<span>{nameOf(d, p.owner)}（{hhLabel(d, householdOf(d, p.owner))}）</span>
										<span>{ago(p.createdAt)}</span>
										{p.targets?.length > 0 && <span>対象：{p.targets.join("・")}</span>}
										{g && <span>参加 {g.hh}世帯{p.event?.capacity ? ` / 定員 ${p.event.capacity}人` : ""}</span>}
									</span>
								</span>
							</button>
						);
					})}
				</div>
			)}
		</>
	);
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
	const full = !!p.event?.capacity && g.people >= p.event.capacity && my?.s !== "go";
	const goers = Object.entries(p.rsvps ?? {}).filter(([, x]) => x.s === "go");

	const rsvp = (s: "go" | "maybe" | "none") => {
		const num = Math.max(1, Math.min(20, parseInt(n, 10) || 1));
		mutate((st) => {
			const post = st.posts[id];
			post.rsvps ??= {};
			// 参加表明は世帯単位（家族の誰が押しても同じ）
			if (s === "none") delete post.rsvps[hid];
			else post.rsvps[hid] = { s, n: s === "go" ? num : 0, at: Date.now() };
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
			{p.photo && <div className="gallery"><div className="main-ph"><Photo pid={p.photo} /></div></div>}
			<div className="meta-row">
				<CatPill cat={p.cat} />
				{p.kind && <Pill cls="tgt">{p.kind}</Pill>}
				{forMyKids(d, me, p) && <Pill cls="fam">わが家向け</Pill>}
				{past && <Pill cls="done">{isFunding(p) ? "締切済み" : "終了"}</Pill>}
			</div>
			<h3 style={{ fontSize: 19 }}>{p.title}</h3>
			{p.cat === "event" && p.event && (
				<dl className="evbox">
					{evStart(p) && <><dt>{isFunding(p) ? "締切日" : "日時"}</dt><dd>{evDateStr(p, false)}</dd></>}
					{p.event.place && <><dt>場所</dt><dd>{p.event.place}</dd></>}
					{p.targets?.length > 0 && <><dt>対象</dt><dd>{p.targets.join("・")}</dd></>}
					{p.event.capacity && <><dt>定員</dt><dd>{p.event.capacity}人</dd></>}
					{p.event.bring && <><dt>持ち物</dt><dd>{p.event.bring}</dd></>}
				</dl>
			)}
			{p.cat !== "event" && p.targets?.length > 0 && <p style={{ fontSize: 13, color: "var(--muted)" }}>対象：{p.targets.join("・")}</p>}
			{p.body && <p className="detail-desc">{p.body}</p>}
			{href && <p style={{ fontSize: 14, wordBreak: "break-all" }}>参考リンク：<a href={href} target="_blank" rel="noopener noreferrer">{p.link}</a></p>}
			{p.cat === "event" && (
				<div className="rsvp">
					<div className="rs-row">
						<b style={{ marginRight: "auto" }}>参加 {g.hh}世帯・{g.people}人{g.maybe ? ` ／ 興味あり ${g.maybe}世帯` : ""}</b>
						{my && <Pill cls={my.s === "go" ? "open" : "nego"}>{my.s === "go" ? `参加予定（${my.n}人）` : "興味あり"}</Pill>}
					</div>
					{past ? <p className="who-list">このイベントは終了しました。</p> : (
						<div className="rs-row">
							<label htmlFor="rs-n" style={{ fontSize: 13 }}>人数</label>
							<input type="number" id="rs-n" min={1} max={20} value={n} onChange={(e) => setN(e.target.value)} />
							<button className="btn small primary" id="rsvp-go" disabled={full} onClick={() => rsvp("go")}>{full ? "定員に達しました" : my?.s === "go" ? "人数を更新" : "参加する"}</button>
							<button className="btn small" onClick={() => rsvp("maybe")}>興味あり</button>
							{my && <button className="btn small ghost" onClick={() => rsvp("none")}>取り消す</button>}
						</div>
					)}
					{goers.length > 0 && <p className="who-list">参加予定：{goers.map(([hid, x]) => `${hhLabel(d, hid)}（${x.n}人）`).join("、")}</p>}
				</div>
			)}
			<Owner id={p.owner} extra={<> ・ {ago(p.createdAt)}</>} />
		</Modal>
	);
}
