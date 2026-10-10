import { Dot } from "../components/ui";
import { HouseholdForm } from "../forms/HouseholdForm";
import { useApp } from "../lib/app";
import { familySize, hhLabel } from "../lib/domain";
import { useData } from "../lib/store";

export function HomeView() {
	const { d, me } = useData();
	const { openModal } = useApp();
	if (!me) return null;
	const h = d.households[me];
	if (!h) return null;
	const all = Object.values(d.households).sort((a, b) => (a.district || "").localeCompare(b.district || "", "ja") || a.createdAt - b.createdAt);
	const myJobs = Object.values(d.jobs).filter((j) => j.owner === me).length;
	const myItems = Object.values(d.items).filter((i) => i.owner === me && i.status !== "done").length;
	const myPosts = Object.values(d.posts).filter((p) => p.owner === me).length;
	return (
		<>
			<div className="view-head"><div><h2>世帯</h2><p>会員登録は世帯ごとです。世帯主と家族構成を管理します。</p></div></div>
			<div className="hh-grid">
				<section className="card">
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12 }}>
						<h3 style={{ margin: 0 }}>{hhLabel(d, me)}</h3>
						<button className="btn small" onClick={() => openModal(<HouseholdForm existing={h} />)}>編集</button>
					</div>
					<dl className="kv">
						<dt>世帯主</dt><dd>{h.headName}</dd>
						<dt>地区・班</dt><dd>{h.district || "—"}</dd>
						<dt>連絡メモ</dt><dd style={{ whiteSpace: "pre-wrap" }}>{h.note || "—"}</dd>
						<dt>登録状況</dt><dd>投稿 {myPosts}件 ・ 仕事 {myJobs}件 ・ 出品中 {myItems}件</dd>
					</dl>
					<h3 style={{ marginTop: 18 }}>家族構成（{familySize(d, me)}人）</h3>
					<div style={{ overflowX: "auto" }}>
						<table className="fam">
							<thead><tr><th>氏名</th><th>続柄</th><th>生まれ年</th></tr></thead>
							<tbody>
								<tr><td>{h.headName}</td><td>世帯主</td><td>{h.headBirth || "—"}</td></tr>
								{(h.members ?? []).map((m, i) => <tr key={i}><td>{m.name}</td><td>{m.relation}</td><td>{m.birthYear || "—"}</td></tr>)}
							</tbody>
						</table>
					</div>
				</section>
				<section className="card">
					<h3>会員の世帯（{all.length}）</h3>
					<div className="dir">
						{all.map((x) => (
							<div className="dir-row" key={x.id}>
								<Dot id={x.id} />
								<span className="n"><b>{hhLabel(d, x.id)}</b>{x.id === me ? "（自分）" : ""}<br /><span style={{ fontSize: 12, color: "var(--muted)" }}>{x.district || "地区未設定"}</span></span>
								<span className="c">{familySize(d, x.id)}人</span>
							</div>
						))}
					</div>
					<p style={{ fontSize: 12, color: "var(--faint)", marginTop: 10 }}>他の世帯には世帯名・地区・人数だけが表示されます。</p>
				</section>
			</div>
		</>
	);
}
