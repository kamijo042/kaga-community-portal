import { useState } from "react";
import { Empty, JobTypePill, Modal, NegPill, Owner, Pill, Stone } from "../components/ui";
import { JobForm } from "../forms/JobForm";
import { useActions } from "../lib/actions";
import { useApp } from "../lib/app";
import { homeOf, isUnread, nameOf, threadsFor } from "../lib/domain";
import { useData } from "../lib/store";
import type { Job } from "../lib/types";
import { evDay } from "../lib/util";

export function JobsView() {
	const { jobMode, setJobMode } = useApp();
	return (
		<>
			<div className="view-head">
				<div><h2>仕事</h2><p>「できます」は引き受けられる手伝い、「お願い」は手伝ってほしいこと。気になったら相談チャットで条件を話し合います。</p></div>
				<div className="seg" role="group">
					<button aria-pressed={jobMode === "browse"} onClick={() => setJobMode("browse")}>仕事をさがす</button>
					<button aria-pressed={jobMode === "mine"} onClick={() => setJobMode("mine")}>自分の登録</button>
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
	const [type, setType] = useState<"all" | "offer" | "request">("all");
	const active = Object.values(d.jobs).filter((j) => j.active);
	const qq = q.trim().toLowerCase();
	const list = active
		.filter((j) => type === "all" || (j.type ?? "offer") === type)
		.filter((j) => neg === "all" || (neg === "yes" ? j.negotiable : !j.negotiable))
		.filter((j) => !qq || `${j.title} ${j.desc} ${nameOf(d, j.owner)} ${homeOf(d, j.owner)}`.toLowerCase().includes(qq))
		.sort((a, b) => b.updatedAt - a.updatedAt);
	return (
		<>
			<div className="toolbar">
				<input className="search" type="search" placeholder="仕事を検索（例：草刈り、空港 送迎、パソコン）" value={q} onChange={(e) => setQ(e.target.value)} />
				<div className="chips">
					{([["all", "すべて"], ["offer", "できます"], ["request", "お願い"]] as const).map(([v, l]) => (
						<button key={v} className="chip-btn" data-type={v} aria-pressed={type === v} onClick={() => setType(v)}>{l}</button>
					))}
					<span className="chip-sep" aria-hidden="true" />
					{([["yes", "交渉あり"], ["no", "交渉なし"]] as const).map(([v, l]) => (
						<button key={v} className="chip-btn" aria-pressed={neg === v} onClick={() => setNeg(neg === v ? "all" : v)}>{l}</button>
					))}
				</div>
			</div>
			{list.length === 0 ? (
				<Empty
					title={active.length ? "条件に合う仕事がありません" : "まだ仕事が登録されていません"}
					steps={active.length ? undefined : ["できること・お願いを登録", "相談チャット", "会って作業・石を手渡し"]}
					action={active.length ? undefined : <span style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}><button className="btn primary" onClick={() => openModal(<JobForm />)}>できることを登録</button><button className="btn" onClick={() => openModal(<JobForm defaultType="request" />)}>お願いを出す</button></span>}
				>
					{active.length ? "検索語や絞り込みを変えてみてください。" : "できること（草刈り、子どもの送り迎え、パソコンの設定など）を登録するか、手伝ってほしいこと（空港までの送迎など）をお願いとして出してみましょう。"}
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
	const req = j.type === "request";
	return (
		<article className={`job ${req ? "is-req" : ""}`}>
			<div className="job-top"><h3>{j.title}</h3><Stone n={j.price} /></div>
			<div className="meta-row"><JobTypePill type={j.type} /><NegPill yes={j.negotiable} />{req && j.wantDate && <Pill cls="tgt">希望日 {evDay(j.wantDate)}</Pill>}{mine && <Pill cls="mine">{req ? "自分のお願い" : "自分の仕事"}</Pill>}</div>
			<p className="desc">{j.desc}</p>
			<div className="job-foot">
				<Owner id={j.owner} />
				{mine ? (
					<button className="btn small" onClick={() => openModal(<JobForm existing={j} />)}>編集</button>
				) : (
					<span style={{ display: "flex", gap: 6 }}>
						<button className="btn small ghost" onClick={() => openModal(<JobDetail id={j.id} />)}>詳しく</button>
						<button className="btn small primary" data-testid="consult-job" onClick={() => actions.startThread("job", j.id)}>{req ? "引き受けたい" : "相談する"}</button>
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
	const req = j.type === "request";
	const district = d.households[d.people[j.owner]?.householdId ?? ""]?.district;
	return (
		<Modal title={req ? "お願いの詳細" : "仕事の詳細"} onClose={closeModal} footer={<>
			<button className="btn ghost" onClick={closeModal}>閉じる</button>
			{j.owner !== me && <button className="btn primary" onClick={() => actions.startThread("job", j.id)}>{req ? "引き受けたい（相談する）" : "相談する"}</button>}
		</>}>
			<div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}><h3 style={{ fontSize: 19 }}>{j.title}</h3><Stone n={j.price} /></div>
			<div className="meta-row"><JobTypePill type={j.type} /><NegPill yes={j.negotiable} />{req && j.wantDate && <Pill cls="tgt">希望日 {evDay(j.wantDate)}</Pill>}</div>
			<p className="detail-desc">{j.desc || "（説明はありません）"}</p>
			<Owner id={j.owner} extra={district ? <> ・ {district}</> : null} />
			<p className="facepay">{req ? "お願いした人が、引き受けた人に石を渡します。" : "頼んだ人が、引き受けた人に石を渡します。"}このサイトに支払い機能はありません。内容と石の額を相談で決めて、会って作業・受け渡しをしてください。</p>
		</Modal>
	);
}

function Mine() {
	const { d, me, mutate } = useData();
	const { openModal, goTab, toast } = useApp();
	if (!me) return null;
	const list = Object.values(d.jobs).filter((j) => j.owner === me).sort((a, b) => b.updatedAt - a.updatedAt);
	const add = (
		<span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
			<button className="btn primary" id="job-new" onClick={() => openModal(<JobForm />)}>＋ できることを登録</button>
			<button className="btn" id="job-req-new" onClick={() => openModal(<JobForm defaultType="request" />)}>＋ お願いを出す</button>
		</span>
	);
	return (
		<>
			<div className="toolbar" style={{ justifyContent: "space-between" }}>
				<p style={{ color: "var(--muted)", fontSize: 14 }}>登録したものは「仕事をさがす」に並びます。受付を止めると一覧から外れます。</p>
				{add}
			</div>
			{list.length === 0 ? (
				<Empty title="まだ登録していません" steps={["できること・お願いを登録", "相談が届く", "会って作業・石を受け渡し"]}>
					できる手伝いは「できることを登録」、手伝ってほしいことは「お願いを出す」から。タイトル、内容、石の額、交渉できるかどうかを登録します。
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
										<JobTypePill type={j.type} /><Stone n={j.price} /><NegPill yes={j.negotiable} />
										{j.active ? <Pill cls="open">{j.type === "request" ? "募集中" : "受付中"}</Pill> : <Pill cls="off">受付停止</Pill>}
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
