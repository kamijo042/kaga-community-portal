import { useState } from "react";
import { Empty, Modal, NegPill, Owner, Pill, Stone } from "../components/ui";
import { JobForm } from "../forms/JobForm";
import { useActions } from "../lib/actions";
import { useApp } from "../lib/app";
import { hhLabel, isUnread, threadsFor } from "../lib/domain";
import { useData } from "../lib/store";
import type { Job } from "../lib/types";

export function JobsView() {
	const { jobMode, setJobMode } = useApp();
	return (
		<>
			<div className="view-head">
				<div><h2>仕事</h2><p>できることを登録し、頼みたい人は相談チャットで条件を話し合います。</p></div>
				<div className="seg" role="group">
					<button aria-pressed={jobMode === "browse"} onClick={() => setJobMode("browse")}>仕事をさがす・頼む</button>
					<button aria-pressed={jobMode === "mine"} onClick={() => setJobMode("mine")}>自分の仕事を出す</button>
				</div>
			</div>
			{jobMode === "browse" ? <Browse /> : <Mine />}
		</>
	);
}

function Browse() {
	const { d } = useData();
	const { openModal } = useApp();
	const [q, setQ] = useState("");
	const [neg, setNeg] = useState<"all" | "yes" | "no">("all");
	const active = Object.values(d.jobs).filter((j) => j.active);
	const qq = q.trim().toLowerCase();
	const list = active
		.filter((j) => neg === "all" || (neg === "yes" ? j.negotiable : !j.negotiable))
		.filter((j) => !qq || `${j.title} ${j.desc} ${hhLabel(d, j.owner)}`.toLowerCase().includes(qq))
		.sort((a, b) => b.updatedAt - a.updatedAt);
	return (
		<>
			<div className="toolbar">
				<input className="search" type="search" placeholder="仕事を検索（例：草刈り、送迎、パソコン）" value={q} onChange={(e) => setQ(e.target.value)} />
				<div className="chips">
					{([["all", "すべて"], ["yes", "交渉あり"], ["no", "交渉なし"]] as const).map(([v, l]) => (
						<button key={v} className="chip-btn" aria-pressed={neg === v} onClick={() => setNeg(v)}>{l}</button>
					))}
				</div>
			</div>
			{list.length === 0 ? (
				<Empty
					title={active.length ? "条件に合う仕事がありません" : "まだ仕事が登録されていません"}
					steps={active.length ? undefined : ["仕事を登録", "相談チャット", "会って作業・石を手渡し"]}
					action={active.length ? undefined : <button className="btn primary" onClick={() => openModal(<JobForm />)}>仕事を登録する</button>}
				>
					{active.length ? "検索語や絞り込みを変えてみてください。" : "できることを最初に登録してみましょう。草刈り、子どもの送り迎え、パソコンの設定など、身近な手伝いで大丈夫です。"}
				</Empty>
			) : (
				<div className="jobs">{list.map((j) => <JobCard key={j.id} j={j} />)}</div>
			)}
		</>
	);
}

function JobCard({ j }: { j: Job }) {
	const { me } = useData();
	const { openModal } = useApp();
	const actions = useActions();
	const mine = j.owner === me;
	return (
		<article className="job">
			<div className="job-top"><h3>{j.title}</h3><Stone n={j.price} /></div>
			<div className="meta-row"><NegPill yes={j.negotiable} />{mine && <Pill cls="mine">自分の仕事</Pill>}</div>
			<p className="desc">{j.desc}</p>
			<div className="job-foot">
				<Owner id={j.owner} />
				{mine ? (
					<button className="btn small" onClick={() => openModal(<JobForm existing={j} />)}>編集</button>
				) : (
					<span style={{ display: "flex", gap: 6 }}>
						<button className="btn small ghost" onClick={() => openModal(<JobDetail id={j.id} />)}>詳しく</button>
						<button className="btn small primary" data-testid="consult-job" onClick={() => actions.startThread("job", j.id)}>相談する</button>
					</span>
				)}
			</div>
		</article>
	);
}

function JobDetail({ id }: { id: string }) {
	const { d, me } = useData();
	const { closeModal } = useApp();
	const actions = useActions();
	const j = d.jobs[id];
	if (!j) return <Modal title="仕事の詳細" onClose={closeModal}><p>この仕事は削除されました。</p></Modal>;
	const district = d.households[j.owner]?.district;
	return (
		<Modal title="仕事の詳細" onClose={closeModal} footer={<>
			<button className="btn ghost" onClick={closeModal}>閉じる</button>
			{j.owner !== me && <button className="btn primary" onClick={() => actions.startThread("job", j.id)}>相談する</button>}
		</>}>
			<div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}><h3 style={{ fontSize: 19 }}>{j.title}</h3><Stone n={j.price} /></div>
			<div className="meta-row"><NegPill yes={j.negotiable} /></div>
			<p className="detail-desc">{j.desc || "（説明はありません）"}</p>
			<Owner id={j.owner} extra={district ? <> ・ {district}</> : null} />
			<p className="facepay">このサイトに支払い機能はありません。内容と石の額を相談で決めて、会って作業・受け渡しをしてください。</p>
		</Modal>
	);
}

function Mine() {
	const { d, me, mutate } = useData();
	const { openModal, goTab, toast } = useApp();
	if (!me) return null;
	const list = Object.values(d.jobs).filter((j) => j.owner === me).sort((a, b) => b.updatedAt - a.updatedAt);
	const add = <button className="btn primary" id="job-new" onClick={() => openModal(<JobForm />)}>＋ 仕事を登録</button>;
	return (
		<>
			<div className="toolbar" style={{ justifyContent: "space-between" }}>
				<p style={{ color: "var(--muted)", fontSize: 14 }}>登録した仕事は「仕事をさがす」に並びます。受付を止めると一覧から外れます。</p>
				{add}
			</div>
			{list.length === 0 ? (
				<Empty title="まだ仕事を登録していません" steps={["仕事を登録", "相談が届く", "会って作業・石を受け取る"]}>
					タイトル、仕事内容、石の価格、交渉できるかどうかを登録します。
				</Empty>
			) : (
				<div className="rows">
					{list.map((j) => {
						const ts = threadsFor(d, "job", j.id);
						const un = ts.filter((t) => isUnread(d, me, t)).length;
						return (
							<div className="row" key={j.id}>
								<div className="main">
									<h3>{j.title}</h3>
									<div className="sub">
										<Stone n={j.price} /><NegPill yes={j.negotiable} />
										{j.active ? <Pill cls="open">受付中</Pill> : <Pill cls="off">受付停止</Pill>}
										<span>相談 {ts.length}件{un ? `（未読 ${un}）` : ""}</span>
									</div>
								</div>
								<div className="acts">
									{ts.length > 0 && <button className="btn small" onClick={() => goTab("chat")}>相談を見る</button>}
									<button className="btn small" onClick={() => { mutate((s) => { s.jobs[j.id].active = !j.active; s.jobs[j.id].updatedAt = Date.now(); }); toast(j.active ? "受付を止めました" : "受付を再開しました"); }}>{j.active ? "受付を止める" : "受付を再開"}</button>
									<button className="btn small" onClick={() => openModal(<JobForm existing={j} />)}>編集</button>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</>
	);
}
