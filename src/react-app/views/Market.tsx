import { useState } from "react";
import { Empty, Modal, Owner, Photo, Prices, StatusPill } from "../components/ui";
import { ItemForm } from "../forms/ItemForm";
import { useActions } from "../lib/actions";
import { useApp } from "../lib/app";
import { hhLabel, threadId, threadsFor } from "../lib/domain";
import { useData } from "../lib/store";

export function MarketView() {
	const { mktMode, setMktMode } = useApp();
	return (
		<>
			<div className="view-head">
				<div><h2>フリマ</h2><p>欲しい品があれば相談チャットで声をかけ、会って受け渡します。成立したら出品は終了です。</p></div>
				<div className="seg" role="group">
					<button aria-pressed={mktMode === "browse"} onClick={() => setMktMode("browse")}>さがす</button>
					<button aria-pressed={mktMode === "mine"} onClick={() => setMktMode("mine")}>自分の出品</button>
				</div>
			</div>
			{mktMode === "browse" ? <Browse /> : <Mine />}
		</>
	);
}

function Browse() {
	const { d, me } = useData();
	const { openModal } = useApp();
	const [q, setQ] = useState("");
	const [showDone, setShowDone] = useState(false);
	const qq = q.trim().toLowerCase();
	const anyOpen = Object.values(d.items).some((i) => i.status !== "done");
	const list = Object.values(d.items)
		.filter((i) => showDone || i.status !== "done")
		.filter((i) => !qq || `${i.name} ${i.desc}`.toLowerCase().includes(qq))
		.sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || b.createdAt - a.createdAt);
	return (
		<>
			<div className="toolbar">
				<input className="search" type="search" placeholder="商品を検索" value={q} onChange={(e) => setQ(e.target.value)} />
				<div className="chips"><button className="chip-btn" aria-pressed={showDone} onClick={() => setShowDone(!showDone)}>成立済みも表示</button></div>
			</div>
			{list.length === 0 ? (
				<Empty
					title={anyOpen ? "条件に合う品がありません" : "出品中の品はまだありません"}
					steps={anyOpen ? undefined : ["出品", "相談チャット", "会って受け渡し・交渉成立"]}
					action={anyOpen ? undefined : <button className="btn primary" onClick={() => openModal(<ItemForm />)}>出品する</button>}
				>
					{anyOpen ? "検索語を変えてみてください。" : "使わなくなった物を出品してみましょう。写真と説明、値段を登録するだけです。"}
				</Empty>
			) : (
				<div className="items">
					{list.map((i) => (
						<button key={i.id} className={`item ${i.status === "done" ? "is-done" : ""}`} onClick={() => openModal(<ItemDetail id={i.id} />)}>
							<div className="ph">
								{i.photos?.[0] ? <Photo pid={i.photos[0]} /> : <div className="noimg">画像なし</div>}
								{i.status !== "open" && <StatusPill s={i.status} />}
							</div>
							<div className="body">
								<span className="name">{i.name}</span>
								<span className="owner">{hhLabel(d, i.owner)}{i.owner === me ? "（自分）" : ""}{d.households[i.owner]?.district ? ` ・ ${d.households[i.owner].district}` : ""}</span>
								<Prices item={i} />
							</div>
						</button>
					))}
				</div>
			)}
		</>
	);
}

export function ItemDetail({ id }: { id: string }) {
	const { d, me } = useData();
	const { closeModal, openModal } = useApp();
	const actions = useActions();
	const i = d.items[id];
	const [cur, setCur] = useState(0);
	if (!i || !me) return <Modal title="商品の詳細" onClose={closeModal}><p>この出品は削除されました。</p></Modal>;
	const mine = i.owner === me;
	const ph = i.photos ?? [];
	const myThread = !mine && d.threads[threadId("item", i.id, me)];
	const district = d.households[i.owner]?.district;
	let action = null;
	if (mine) action = i.status !== "done" ? <button className="btn primary" onClick={() => openModal(<ItemForm existing={i} />)}>編集</button> : null;
	else if (i.status === "done") action = i.buyer === me ? <button className="btn" onClick={() => actions.startThread("item", i.id)}>チャットを開く</button> : <button className="btn" disabled>交渉成立済み</button>;
	else action = <button className="btn primary" id="consult-item" onClick={() => actions.startThread("item", i.id)}>{myThread ? "相談の続き" : "購入を相談する"}</button>;
	return (
		<Modal title="商品の詳細" onClose={closeModal} footer={<><button className="btn ghost" onClick={closeModal}>閉じる</button>{action}</>}>
			<div className="gallery">
				<div className="main-ph">{ph.length ? <Photo pid={ph[Math.min(cur, ph.length - 1)]} alt={i.name} /> : <div className="noimg">画像なし</div>}</div>
				{ph.length > 1 && (
					<div className="thumbs">
						{ph.map((p, k) => <button key={p} aria-pressed={k === cur} onClick={() => setCur(k)}><Photo pid={p} /></button>)}
					</div>
				)}
			</div>
			<div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}><h3 style={{ fontSize: 19 }}>{i.name}</h3><Prices item={i} /></div>
			<div className="meta-row"><StatusPill s={i.status} /></div>
			<p className="detail-desc">{i.desc || "（説明はありません）"}</p>
			<Owner id={i.owner} extra={district ? <> ・ {district}</> : null} />
			<p className="facepay">支払い機能はありません。相談で受け渡しの日時と場所を決め、会って石・円と品物を交換してください。</p>
		</Modal>
	);
}

function Mine() {
	const { d, me } = useData();
	const { openModal, goTab } = useApp();
	if (!me) return null;
	const list = Object.values(d.items).filter((i) => i.owner === me)
		.sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || b.createdAt - a.createdAt);
	return (
		<>
			<div className="toolbar" style={{ justifyContent: "space-between" }}>
				<p style={{ color: "var(--muted)", fontSize: 14 }}>相談チャットの中で「交渉中」「交渉成立」に切り替えられます。</p>
				<button className="btn primary" id="item-new" onClick={() => openModal(<ItemForm />)}>＋ 出品する</button>
			</div>
			{list.length === 0 ? (
				<Empty title="まだ出品していません">商品名、写真、説明、値段（石・円）を登録します。</Empty>
			) : (
				<div className="rows">
					{list.map((i) => {
						const ts = threadsFor(d, "item", i.id);
						return (
							<div className="row" key={i.id}>
								<div className="thumb">{i.photos?.[0] && <Photo pid={i.photos[0]} />}</div>
								<div className="main">
									<h3>{i.name}</h3>
									<div className="sub">
										<Prices item={i} /><StatusPill s={i.status} /><span>相談 {ts.length}件</span>
										{i.status === "done" && i.buyer && <span>成立相手：{hhLabel(d, i.buyer)}</span>}
									</div>
								</div>
								<div className="acts">
									{ts.length > 0 && <button className="btn small" onClick={() => goTab("chat")}>相談を見る</button>}
									{i.status !== "done" && <button className="btn small" onClick={() => openModal(<ItemForm existing={i} />)}>編集</button>}
									<button className="btn small" onClick={() => openModal(<ItemDetail id={i.id} />)}>表示</button>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</>
	);
}
