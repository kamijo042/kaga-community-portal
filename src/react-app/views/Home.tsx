import { useCallback, useEffect, useState } from "react";
import { Dot, Pill } from "../components/ui";
import { HouseholdForm, PersonForm } from "../forms/HouseholdForm";
import { familyApi, type AccountRow } from "../lib/api";
import { useApp } from "../lib/app";
import { ageBucket, familyOf, familySize, hhLabel, householdOf } from "../lib/domain";
import { useData } from "../lib/store";
import { ago } from "../lib/util";
import { AccountsAdmin, InviteCodeModal } from "./Admin";

export function HomeView() {
	const { d, me } = useData();
	const { openModal, toast } = useApp();
	const hid = householdOf(d, me);
	const [accs, setAccs] = useState<Record<string, AccountRow>>({});
	const loadAccs = useCallback(() => {
		familyApi.list().then((r) => setAccs(Object.fromEntries(r.accounts.map((a) => [a.userId, a])))).catch(() => undefined);
	}, []);
	const fam = familyOf(d, hid);
	const famKey = fam.map((p) => p.id).join(",");
	useEffect(loadAccs, [loadAccs, famKey]);
	if (!me || !hid) return null;
	const h = d.households[hid];
	if (!h) return null;
	const all = Object.values(d.households).sort((a, b) => (a.district || "").localeCompare(b.district || "", "ja") || a.createdAt - b.createdAt);
	const famIds = new Set(fam.map((p) => p.id));
	const myPosts = Object.values(d.posts).filter((p) => famIds.has(p.owner)).length;
	const myJobs = Object.values(d.jobs).filter((j) => famIds.has(j.owner)).length;
	const myItems = Object.values(d.items).filter((i) => famIds.has(i.owner) && i.status !== "done").length;

	const issue = async (userId: string, name: string) => {
		try {
			const r = await familyApi.invite(userId);
			openModal(<InviteCodeModal title="ログインの招待コード" name={name} code={r.code} expiresAt={r.expiresAt} />);
			loadAccs();
		} catch (e) { toast((e as Error).message); }
	};

	return (
		<>
			<div className="view-head"><div><h2>世帯</h2><p>1つの世帯に家族みんなが入ります。ログインは家族ひとりずつ。ログインしない家族（赤ちゃんなど）も登録できます。</p></div></div>
			<div className="hh-grid">
				<section className="card">
					<div className="card-head">
						<h3 style={{ margin: 0 }}>{hhLabel(d, hid)}</h3>
						<button className="btn small" onClick={() => openModal(<HouseholdForm existing={h} />)}>編集</button>
					</div>
					<dl className="kv">
						<dt>地区・班</dt><dd>{h.district || "—"}</dd>
						<dt>連絡メモ</dt><dd style={{ whiteSpace: "pre-wrap" }}>{h.note || "—"}</dd>
						<dt>家族の登録</dt><dd>投稿 {myPosts}件 ・ 仕事 {myJobs}件 ・ 出品中 {myItems}件</dd>
					</dl>
					<div className="card-head" style={{ marginTop: 22 }}>
						<h3 style={{ margin: 0 }}>家族（{fam.length}人）</h3>
						<button className="btn small primary" id="family-add" onClick={() => openModal(<PersonForm householdId={hid} />)}>＋ 家族を追加</button>
					</div>
					<div className="family">
						{fam.map((p) => {
							const a = accs[p.id];
							const age = ageBucket(p.birthYear);
							return (
								<div className="fam-row" key={p.id} data-person={p.name}>
									<Dot id={p.id} />
									<div className="fam-main">
										<b>{p.name}{p.id === me && <span className="you">（あなた）</span>}</b>
										<span className="fam-sub">{p.relation}{p.birthYear ? ` ・ ${p.birthYear}年生まれ` : ""}{age && age !== "大人" ? `（${age}）` : ""}</span>
										<span className="fam-sub">
											{a?.loginId ? <>ログインID：{a.loginId}{a.disabled ? " ・ 停止中" : a.lastLoginAt ? ` ・ ${ago(a.lastLoginAt)}にログイン` : ""}</>
												: a?.inviteExpiresAt ? <Pill cls="nego">招待中</Pill> : <span className="muted">ログインなし（登録のみ）</span>}
										</span>
									</div>
									<div className="fam-acts">
										{p.id !== me && !a?.loginId && (
											<button className="btn small" onClick={() => issue(p.id, p.name)}>{a?.inviteExpiresAt ? "招待コードを再発行" : "ログインを発行"}</button>
										)}
										<button className="btn small ghost" onClick={() => openModal(<PersonForm householdId={hid} existing={p} hasLogin={!!a?.loginId} />)}>編集</button>
									</div>
								</div>
							);
						})}
					</div>
					<p className="hint-p" style={{ marginTop: 12 }}>「ログインを発行」で招待コードが出ます。その家族が自分のスマホなどで登録すると、ひとりずつログインできます。ログインのある家族がパスワードを忘れたときは、運営に「再設定コード」を依頼してください。ログインのない家族の名前と写真は、ほかの世帯には表示されません。</p>
				</section>
				<section className="card">
					<h3>会員の世帯（{all.length}）</h3>
					<div className="dir">
						{all.map((x) => (
							<div className="dir-row" key={x.id}>
								<Dot id={x.id} />
								<span className="n"><b>{hhLabel(d, x.id)}</b>{x.id === hid ? "（わが家）" : ""}<br /><span style={{ fontSize: 12, color: "var(--muted)" }}>{x.district || "地区未設定"}</span></span>
								<span className="c">{familySize(d, x.id)}人</span>
							</div>
						))}
					</div>
					<p style={{ fontSize: 12, color: "var(--faint)", marginTop: 10 }}>他の世帯には世帯名・地区・人数だけが表示されます。</p>
				</section>
			</div>
			<AccountsAdmin />
		</>
	);
}

