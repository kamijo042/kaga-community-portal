import { useCallback, useEffect, useState } from "react";
import { Dot, Modal, Pill } from "../components/ui";
import { adminApi, ApiError, type AccountRow, type HouseholdFootprint } from "../lib/api";
import { useApp } from "../lib/app";
import { useData } from "../lib/store";
import { ago } from "../lib/util";

/** 管理者だけ：新しい世帯の招待・再設定コード・利用停止・世帯の削除 */
export function AccountsAdmin() {
	const { user, d } = useData();
	const { openModal, toast } = useApp();
	const [rows, setRows] = useState<AccountRow[] | null>(null);
	const [err, setErr] = useState("");
	const load = useCallback(() => { adminApi.list().then((r) => setRows(r.accounts)).catch((e) => setErr((e as Error).message)); }, []);
	const key = Object.keys(d.households).length + ":" + Object.keys(d.people).length;
	useEffect(() => { if (user?.role === "admin") load(); }, [load, key, user?.role]);
	if (user?.role !== "admin") return null;

	const showCode = (title: string, name: string, code: string, expiresAt: number) => openModal(<InviteCodeModal title={title} name={name} code={code} expiresAt={expiresAt} />);
	const reissue = async (r: AccountRow) => {
		try { const x = await adminApi.invite(r.userId); showCode(x.purpose === "reset" ? "パスワード再設定コード" : "ログインの招待コード", r.name, x.code, x.expiresAt); load(); }
		catch (e) { toast((e as Error).message); }
	};
	const update = async (r: AccountRow, patch: { disabled?: boolean; role?: "member" | "admin" }) => {
		try { await adminApi.update(r.userId, patch); load(); toast("変更しました"); } catch (e) { toast((e as Error).message); }
	};

	const askDelete = async (g: { id: string; name: string }) => {
		try {
			const f = await adminApi.deleteHousehold(g.id);
			openModal(<DeleteHouseholdModal id={g.id} name={f.name} f={f} onDone={() => { load(); toast(`${f.name}を削除しました`); }} />);
		} catch (e) { toast((e as Error).message); }
	};

	// 世帯ごとにまとめる
	const groups: { id: string; name: string; district: string; rows: AccountRow[] }[] = [];
	for (const r of rows ?? []) {
		let g = groups.find((x) => x.id === r.householdId);
		if (!g) groups.push((g = { id: r.householdId, name: r.householdName, district: r.district, rows: [] }));
		g.rows.push(r);
	}

	return (
		<section className="card admin-card">
			<div className="admin-head">
				<div><h3 style={{ margin: 0 }}>アカウント管理（運営）</h3><p className="hint-p">管理者だけに表示されます。新しく移住してきた世帯を招待すると、世帯主あての招待コードが出ます。家族の追加は、その世帯の人が「世帯」タブから行います。</p></div>
				<button className="btn primary small" id="admin-new" onClick={() => openModal(<NewHouseholdModal onDone={(name, code, exp) => { load(); showCode("世帯主の招待コード", name, code, exp); }} />)}>＋ 新しい世帯を招待</button>
			</div>
			{err && <p className="err">{err}</p>}
			{!rows ? <p className="hint-p">読み込み中…</p> : (
				<div className="tbl-wrap">
					<table className="ledger accounts">
						<thead><tr><th>世帯・家族</th><th>ログインID</th><th>状態</th><th>最終ログイン</th><th /></tr></thead>
						{groups.map((g) => (
							<tbody key={g.id}>
								<tr className="grp"><td colSpan={5}><div className="grp-cell"><span className="acc-name"><Dot id={g.id} /><b>{g.name}</b><small>{g.district || "地区未設定"} ・ {g.rows.length}人</small></span>
									{g.id !== user.householdId && <button className="btn small ghost danger grp-del" onClick={() => askDelete(g)}>世帯を削除</button>}</div></td></tr>
								{g.rows.map((r) => (
									<tr key={r.userId}>
										<td className="l"><span className="acc-person">{r.name}<small>{r.relation}</small></span></td>
										<td className="l">{r.loginId ?? "—"}</td>
										<td className="l">
											{!r.loginId ? (r.inviteExpiresAt ? <Pill cls="nego">招待中</Pill> : <Pill cls="off">登録のみ</Pill>)
												: r.disabled ? <Pill cls="done">停止中</Pill> : <Pill cls="open">利用中</Pill>}
											{r.role === "admin" && <> <Pill cls="mine">管理者</Pill></>}
										</td>
										<td>{r.lastLoginAt ? ago(r.lastLoginAt) : "—"}</td>
										<td><div className="acts-cell">
											{r.userId !== user.userId && (
												<>
													<button className="btn small" onClick={() => reissue(r)}>{r.loginId ? "再設定コード" : "招待コード"}</button>
													{r.loginId && <button className="btn small ghost" onClick={() => update(r, { disabled: !r.disabled })}>{r.disabled ? "再開" : "停止"}</button>}
													{r.loginId && !r.disabled && <button className="btn small ghost" onClick={() => update(r, { role: r.role === "admin" ? "member" : "admin" })}>{r.role === "admin" ? "管理者を外す" : "管理者にする"}</button>}
												</>
											)}
										</div></td>
									</tr>
								))}
							</tbody>
						))}
					</table>
				</div>
			)}
		</section>
	);
}

function DeleteHouseholdModal({ id, name, f, onDone }: { id: string; name: string; f: HouseholdFootprint; onDone: () => void }) {
	const { closeModal } = useApp();
	const [typed, setTyped] = useState("");
	const [err, setErr] = useState("");
	const [busy, setBusy] = useState(false);
	const parts = [
		`家族 ${f.people}人（ログイン ${f.logins}）`,
		f.jobs && `仕事 ${f.jobs}件`, f.items && `出品 ${f.items}件`, f.posts && `情報 ${f.posts}件`,
		f.threads && `相談 ${f.threads}件（相手側の履歴も消えます）`, f.ledger && `石の流通の記録 ${f.ledger}件`,
	].filter(Boolean) as string[];
	const run = async () => {
		setBusy(true); setErr("");
		try { await adminApi.deleteHousehold(id, true); closeModal(); onDone(); }
		catch (e) { setErr((e as Error).message); setBusy(false); }
	};
	return (
		<Modal title="世帯を削除" onClose={closeModal} footer={<>
			<button className="btn ghost" onClick={closeModal}>キャンセル</button>
			<button className="btn primary danger" id="hh-del-run" disabled={busy || typed.trim() !== name} onClick={run}>{busy ? "削除中…" : "完全に削除する"}</button>
		</>}>
			<p><b>{name}</b> と、次のものをすべて削除します。<b>元に戻せません。</b></p>
			<ul className="del-list">{parts.map((x) => <li key={x}>{x}</li>)}</ul>
			<p className="hint-p">一時的に使えなくするだけなら、削除ではなく各メンバーの「停止」を使ってください。</p>
			<div className="field"><label htmlFor="hh-del-name">確認のため世帯名「{name}」を入力</label><input type="text" id="hh-del-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus /></div>
			{err && <p className="err">{err}</p>}
		</Modal>
	);
}

function NewHouseholdModal({ onDone }: { onDone: (name: string, code: string, expiresAt: number) => void }) {
	const { closeModal } = useApp();
	const [headName, setHeadName] = useState("");
	const [name, setName] = useState("");
	const [district, setDistrict] = useState("");
	const [err, setErr] = useState("");
	const [dup, setDup] = useState(false);
	const [busy, setBusy] = useState(false);
	const save = async (force = false) => {
		if (!headName.trim()) return setErr("世帯主の氏名を入力してください。");
		setBusy(true); setErr("");
		try {
			const r = await adminApi.createHousehold({ headName: headName.trim(), name: name.trim(), district: district.trim(), force });
			onDone(`${r.name}（世帯主 ${headName.trim()}）`, r.code, r.expiresAt);
		} catch (e) {
			setErr((e as Error).message);
			setDup(e instanceof ApiError && e.status === 409);
			setBusy(false);
		}
	};
	return (
		<Modal title="新しい世帯を招待" onClose={closeModal} footer={<>
			<button className="btn ghost" onClick={closeModal}>キャンセル</button>
			{dup && <button className="btn" disabled={busy} onClick={() => save(true)}>別の世帯なので登録する</button>}
			<button className="btn primary" id="admin-new-save" disabled={busy} onClick={() => save(false)}>{busy ? "発行中…" : "招待コードを発行"}</button>
		</>}>
			<form style={{ display: "contents" }} onSubmit={(e) => { e.preventDefault(); void save(false); }}>
				<p className="hint-p">1つの世帯は1回だけ登録します。すでに登録済みの世帯の家族は、ここではなく、その世帯の「家族を追加」から登録してください。</p>
				<div className="two">
					<div className="field"><label htmlFor="nh-head">世帯主の氏名</label><input type="text" id="nh-head" value={headName} onChange={(e) => { setHeadName(e.target.value); setDup(false); }} autoFocus placeholder="例：佐藤 一郎" /></div>
					<div className="field"><label htmlFor="nh-name">世帯名</label><input type="text" id="nh-name" value={name} onChange={(e) => { setName(e.target.value); setDup(false); }} placeholder="空欄なら「佐藤家」" /></div>
				</div>
				<div className="field"><label htmlFor="nh-district">地区・班</label><input type="text" id="nh-district" value={district} onChange={(e) => { setDistrict(e.target.value); setDup(false); }} /></div>
				{err && <p className="err">{err}</p>}
			</form>
		</Modal>
	);
}

export function InviteCodeModal({ title, name, code, expiresAt }: { title: string; name: string; code: string; expiresAt: number }) {
	const { closeModal, toast } = useApp();
	const link = `${location.origin}/?invite=${encodeURIComponent(code)}`;
	const exp = new Date(expiresAt);
	const copy = async (text: string) => {
		try { await navigator.clipboard.writeText(text); toast("コピーしました"); } catch { toast("コピーできませんでした。手で選択してコピーしてください"); }
	};
	return (
		<Modal title={title} onClose={closeModal} footer={<button className="btn primary" onClick={closeModal}>閉じる</button>}>
			<p><b>{name}</b> さんに、次のコードかリンクを渡してください。</p>
			<div className="invite-code" id="invite-code">{code}</div>
			<div className="copy-row">
				<input type="text" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="招待リンク" />
				<button className="btn small" onClick={() => copy(link)}>リンクをコピー</button>
				<button className="btn small ghost" onClick={() => copy(code)}>コードをコピー</button>
			</div>
			<p className="hint-p">有効期限：{exp.getMonth() + 1}月{exp.getDate()}日まで（1回だけ使えます）。このコードは今しか表示されません。なくした場合は再発行してください。</p>
		</Modal>
	);
}
