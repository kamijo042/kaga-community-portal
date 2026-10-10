import { useState } from "react";
import { ConfirmButton, Modal } from "../components/ui";
import { useApp } from "../lib/app";
import { useData } from "../lib/store";
import type { Household, Person } from "../lib/types";
import { uid } from "../lib/util";

export const RELATIONS = ["世帯主", "配偶者", "子", "父", "母", "祖父", "祖母", "孫", "兄弟姉妹", "その他"];

/** 世帯の情報（世帯名・地区・メモ）の編集。家族なら誰でも */
export function HouseholdForm({ existing }: { existing: Household }) {
	const { mutate } = useData();
	const { closeModal, toast } = useApp();
	const [name, setName] = useState(existing.name);
	const [district, setDistrict] = useState(existing.district);
	const [note, setNote] = useState(existing.note);
	const [err, setErr] = useState("");
	const save = () => {
		if (!name.trim()) return setErr("世帯名を入力してください。");
		mutate((d) => { d.households[existing.id] = { ...existing, name: name.trim(), district: district.trim(), note: note.trim(), updatedAt: Date.now() }; });
		closeModal();
		toast("世帯の情報を保存しました");
	};
	return (
		<Modal title="世帯の情報" onClose={closeModal} footer={<>
			<button className="btn ghost" onClick={closeModal}>キャンセル</button>
			<button className="btn primary" onClick={save}>保存する</button>
		</>}>
			<form style={{ display: "contents" }} onSubmit={(e) => { e.preventDefault(); save(); }}>
				<div className="two">
					<div className="field"><label htmlFor="hh-name">世帯名</label><input type="text" id="hh-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
					<div className="field"><label htmlFor="hh-district">地区・班</label><input type="text" id="hh-district" value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="例：東町 3班" /></div>
				</div>
				<div className="field"><label htmlFor="hh-note">連絡メモ</label><textarea id="hh-note" style={{ minHeight: 80 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="受け渡しに都合のよい時間帯など（任意）" /></div>
				{err && <p className="err">{err}</p>}
			</form>
		</Modal>
	);
}

/** 家族ひとりの登録・編集（ログインのない家族＝赤ちゃんなど も登録できる） */
export function PersonForm({ householdId, existing, hasLogin }: { householdId: string; existing?: Person; hasLogin?: boolean }) {
	const { mutate, me } = useData();
	const { closeModal, toast } = useApp();
	const [name, setName] = useState(existing?.name ?? "");
	const [relation, setRelation] = useState(existing?.relation ?? "子");
	const [birthYear, setBirthYear] = useState(existing?.birthYear ?? "");
	const [err, setErr] = useState("");
	const save = () => {
		if (!name.trim()) return setErr("氏名を入力してください。");
		if (birthYear && !/^(19|20)\d{2}$/.test(birthYear)) return setErr("生まれ年は西暦4桁で入力してください（例：2020）。");
		const id = existing?.id ?? uid("u_");
		mutate((d) => {
			d.people[id] = { id, householdId, name: name.trim(), relation, birthYear: birthYear.trim(), createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now() };
		});
		closeModal();
		toast(existing ? "保存しました" : "家族を登録しました");
	};
	const canDelete = existing && !hasLogin && existing.id !== me;
	return (
		<Modal title={existing ? "家族の情報" : "家族を追加"} onClose={closeModal} footer={<>
			{canDelete && <ConfirmButton onConfirm={() => { mutate((d) => { delete d.people[existing.id]; }); closeModal(); toast("家族の登録を外しました"); }}>登録を外す</ConfirmButton>}
			<button className="btn ghost" onClick={closeModal}>キャンセル</button>
			<button className="btn primary" id="person-save" onClick={save}>{existing ? "保存する" : "登録する"}</button>
		</>}>
			<form style={{ display: "contents" }} onSubmit={(e) => { e.preventDefault(); save(); }}>
				{!existing && <p className="hint-p">登録するだけなら、ログインは不要です（赤ちゃんや小さな子どもなど）。ログインを使う家族には、登録したあとで「ログインを発行」から招待コードを渡してください。</p>}
				<div className="field"><label htmlFor="ps-name">氏名</label><input type="text" id="ps-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="例：山田 花子" /></div>
				<div className="two">
					<div className="field"><label htmlFor="ps-rel">続柄</label>
						<select id="ps-rel" value={relation} onChange={(e) => setRelation(e.target.value)}>{RELATIONS.map((r) => <option key={r}>{r}</option>)}</select>
					</div>
					<div className="field"><label htmlFor="ps-birth">生まれ年（任意）</label><input type="number" id="ps-birth" min={1900} max={2100} value={birthYear} onChange={(e) => setBirthYear(e.target.value)} placeholder="例：2020" /><span className="hint">情報タブの「わが家向け」の判定に使います</span></div>
				</div>
				{existing && hasLogin && <p className="hint-p">この家族はログインを持っているため、登録を外すことはできません（必要なら運営に連絡してください）。</p>}
				{err && <p className="err">{err}</p>}
			</form>
		</Modal>
	);
}
