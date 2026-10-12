import { useRef, useState } from "react";
import { ConfirmButton, Modal } from "../components/ui";
import { useApp } from "../lib/app";
import { useData } from "../lib/store";
import type { Household, Person } from "../lib/types";
import { colorOf, squareAvatar, uid } from "../lib/util";

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
export function PersonForm({ householdId, existing, hasLogin, title }: { householdId: string; existing?: Person; hasLogin?: boolean; title?: string }) {
	const { mutate, me, photos } = useData();
	const { closeModal, toast } = useApp();
	const [name, setName] = useState(existing?.name ?? "");
	const [relation, setRelation] = useState(existing?.relation ?? "子");
	const [birthYear, setBirthYear] = useState(existing?.birthYear ?? "");
	/** 写真：既存のID／新しく選んだ画像／外す(null) */
	const [avatar, setAvatar] = useState<{ pid?: string; data?: string } | null>(existing?.avatar ? { pid: existing.avatar } : null);
	const [err, setErr] = useState("");
	const [busy, setBusy] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);
	const pick = async (f: File | undefined) => {
		if (!f) return;
		try { setAvatar({ data: await squareAvatar(f) }); setErr(""); } catch (e) { setErr((e as Error).message); }
	};
	const save = async () => {
		if (!name.trim()) return setErr("氏名を入力してください。");
		if (birthYear && !/^(19|20)\d{2}$/.test(birthYear)) return setErr("生まれ年は西暦4桁で入力してください（例：2020）。");
		setBusy(true);
		try {
			let pid = avatar?.pid ?? null;
			if (avatar?.data) pid = await photos.put(avatar.data);
			if (existing?.avatar && existing.avatar !== pid) photos.del(existing.avatar);
			const id = existing?.id ?? uid("u_");
			let swapped = "";
			mutate((d) => {
				// 世帯主は1人だけ。別の人を世帯主にしたら、今までの世帯主とは続柄を入れ替える
				if (relation === "世帯主") {
					for (const p of Object.values(d.people)) {
						if (p.householdId === householdId && p.id !== id && p.relation === "世帯主") {
							d.people[p.id] = { ...p, relation: existing && existing.relation !== "世帯主" ? existing.relation : "その他", updatedAt: Date.now() };
							swapped = `${p.name}さんの続柄は「${d.people[p.id].relation}」に変えました`;
						}
					}
				}
				d.people[id] = { id, householdId, name: name.trim(), relation, birthYear: birthYear.trim(), avatar: pid, createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now() };
			});
			closeModal();
			toast((existing ? "保存しました" : "家族を登録しました") + (swapped ? `（${swapped}）` : ""));
		} catch {
			setErr("写真を保存できませんでした。もう一度お試しください。");
			setBusy(false);
		}
	};
	const initial = (name.trim().split(/[\s　]+/).pop() || "?").slice(0, 1);
	const canDelete = existing && !hasLogin && existing.id !== me;
	return (
		<Modal title={title ?? (existing ? "家族の情報" : "家族を追加")} onClose={closeModal} footer={<>
			{canDelete && <ConfirmButton onConfirm={() => { mutate((d) => { delete d.people[existing.id]; }); closeModal(); toast("家族の登録を外しました"); }}>登録を外す</ConfirmButton>}
			<button className="btn ghost" onClick={closeModal}>キャンセル</button>
			<button className="btn primary" id="person-save" disabled={busy} onClick={save}>{busy ? "保存中…" : existing ? "保存する" : "登録する"}</button>
		</>}>
			<form style={{ display: "contents" }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
				<div className="avatar-edit">
					<button type="button" className="avatar-big" onClick={() => fileRef.current?.click()} aria-label="プロフィール写真を選ぶ" style={{ background: colorOf(existing?.id ?? "new") }}>
						{avatar?.data ? <img src={avatar.data} alt="" /> : avatar?.pid ? <img src={photos.url(avatar.pid)} alt="" /> : <span>{initial}</span>}
						<span className="avatar-cam" aria-hidden="true">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
						</span>
					</button>
					<div className="avatar-side">
						<b>プロフィール写真</b>
						<span className="hint">顔写真や好きな画像を登録できます。中央が正方形に切り抜かれます。</span>
						<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
							<button type="button" className="btn small" id="avatar-pick" onClick={() => fileRef.current?.click()}>{avatar ? "写真を変える" : "写真を選ぶ"}</button>
							{avatar && <button type="button" className="btn small ghost" onClick={() => setAvatar(null)}>写真を外す</button>}
						</div>
					</div>
					<input ref={fileRef} type="file" id="avatar-file" accept="image/*" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
				</div>
				{!existing && <p className="hint-p">登録するだけなら、ログインは不要です（赤ちゃんや小さな子どもなど）。ログインを使う家族には、登録したあとで「ログインを発行」から招待コードを渡してください。</p>}
				<div className="field"><label htmlFor="ps-name">氏名</label><input type="text" id="ps-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="例：山田 花子" /></div>
				<div className="two">
					<div className="field"><label htmlFor="ps-rel">続柄</label>
						<select id="ps-rel" value={relation} onChange={(e) => setRelation(e.target.value)}>{RELATIONS.map((r) => <option key={r}>{r}</option>)}</select>
					</div>
					<div className="field"><label htmlFor="ps-birth">生まれ年（任意）</label><input type="number" id="ps-birth" min={1900} max={2100} value={birthYear} onChange={(e) => setBirthYear(e.target.value)} placeholder="例：2020" /><span className="hint">情報タブの「わが家向け」の判定に使います</span></div>
				</div>
				{existing && hasLogin && existing.id !== me && <p className="hint-p">この家族はログインを持っているため、登録を外すことはできません（必要なら運営に連絡してください）。</p>}
				{err && <p className="err">{err}</p>}
			</form>
		</Modal>
	);
}
