import { useEffect, useState } from "react";
import { Modal, Pill } from "../components/ui";
import { ApiError, invitesApi, type MyHouseholdInvite } from "../lib/api";
import { useApp } from "../lib/app";
import { ago } from "../lib/util";
import { InviteCodeModal } from "./Admin";

/**
 * 会員なら誰でも使える「新しい世帯を招待」（クラブハウス方式）
 * 1人あたりの招待数には上限がある（管理者は上限なし）。自分が招待した世帯の登録状況も見られる
 */
export function InviteHouseholdModal() {
	const { closeModal, openModal, toast } = useApp();
	const [data, setData] = useState<{ list: MyHouseholdInvite[]; limit: number | null; remaining: number | null } | null>(null);
	const [headName, setHeadName] = useState("");
	const [name, setName] = useState("");
	const [district, setDistrict] = useState("");
	const [err, setErr] = useState("");
	const [dup, setDup] = useState(false);
	const [busy, setBusy] = useState(false);
	useEffect(() => { invitesApi.list().then(setData).catch((e) => setErr((e as Error).message)); }, []);

	const showCode = (title: string, who: string, code: string, expiresAt: number) => openModal(<InviteCodeModal title={title} name={who} code={code} expiresAt={expiresAt} />);
	const save = async (force = false) => {
		if (!headName.trim()) return setErr("世帯主の氏名を入力してください。");
		setBusy(true); setErr("");
		try {
			const r = await invitesApi.create({ headName: headName.trim(), name: name.trim(), district: district.trim(), force });
			showCode("世帯主の招待コード", `${r.name}（世帯主 ${headName.trim()}）`, r.code, r.expiresAt);
		} catch (e) {
			setErr((e as Error).message);
			setDup(e instanceof ApiError && e.status === 409);
			setBusy(false);
		}
	};
	const reissue = async (x: MyHouseholdInvite) => {
		try { const r = await invitesApi.reissue(x.householdId); showCode("世帯主の招待コード", `${x.name}（世帯主 ${x.headName}）`, r.code, r.expiresAt); }
		catch (e) { toast((e as Error).message); }
	};
	const full = data?.remaining === 0;

	return (
		<Modal title="新しい世帯を招待" onClose={closeModal} footer={<>
			<button className="btn ghost" onClick={closeModal}>閉じる</button>
			{dup && <button className="btn" disabled={busy} onClick={() => save(true)}>別の世帯なので招待する</button>}
			<button className="btn primary" id="hhinv-save" disabled={busy || !data || full} onClick={() => save(false)}>{busy ? "発行中…" : "招待コードを発行"}</button>
		</>}>
			<form style={{ display: "contents" }} onSubmit={(e) => { e.preventDefault(); if (!full) void save(false); }}>
				<p className="hint-p">
					知り合いの移住者の世帯を招待できます。世帯主あての招待コードが出るので、本人に渡してください。
					{data && data.limit !== null && <> あなたが招待できるのは <b id="hhinv-remaining">あと{data.remaining}世帯</b>（1人{data.limit}世帯まで）です。</>}
				</p>
				{full ? (
					<p className="err">招待できる世帯の上限に達しました。さらに招待したいときは運営に相談してください。</p>
				) : (
					<>
						<div className="two">
							<div className="field"><label htmlFor="hhinv-head">世帯主の氏名</label><input type="text" id="hhinv-head" value={headName} onChange={(e) => { setHeadName(e.target.value); setDup(false); }} autoFocus placeholder="例：佐藤 一郎" /></div>
							<div className="field"><label htmlFor="hhinv-name">世帯名</label><input type="text" id="hhinv-name" value={name} onChange={(e) => { setName(e.target.value); setDup(false); }} placeholder="空欄なら「佐藤家」" /></div>
						</div>
						<div className="field"><label htmlFor="hhinv-district">地区・班</label><input type="text" id="hhinv-district" value={district} onChange={(e) => { setDistrict(e.target.value); setDup(false); }} /></div>
						<p className="hint-p">1つの世帯は1回だけ登録します。すでに登録済みの世帯の家族は、その世帯の「家族を追加」から登録してもらってください。</p>
					</>
				)}
				{err && !full && <p className="err">{err}</p>}
			</form>
			{data && data.list.length > 0 && (
				<div className="hhinv-list">
					<p className="hhinv-title">あなたが招待した世帯</p>
					{data.list.map((x) => (
						<div key={x.householdId} className="hhinv-row">
							<span className="hhinv-main"><b>{x.name}</b><small>世帯主 {x.headName}{x.district ? ` ・ ${x.district}` : ""} ・ {ago(x.createdAt)}</small></span>
							{x.registered ? <Pill cls="open">登録済み</Pill> : x.inviteExpiresAt ? <Pill cls="nego">招待中</Pill> : <Pill cls="off">期限切れ</Pill>}
							{!x.registered && <button className="btn small" onClick={() => reissue(x)}>コードを再発行</button>}
						</div>
					))}
				</div>
			)}
		</Modal>
	);
}
