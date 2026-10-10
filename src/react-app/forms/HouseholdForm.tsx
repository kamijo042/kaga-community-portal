import { useState } from "react";
import { Modal } from "../components/ui";
import { useApp } from "../lib/app";
import { useData } from "../lib/store";
import type { Household, Member } from "../lib/types";
import { uid } from "../lib/util";

const RELS = ["配偶者", "子", "父", "母", "祖父", "祖母", "孫", "兄弟姉妹", "その他"];

export function HouseholdForm({ existing, onRegistered }: { existing?: Household; onRegistered?: (id: string) => void }) {
	const { mutate } = useData();
	const { closeModal, toast } = useApp();
	const [headName, setHeadName] = useState(existing?.headName ?? "");
	const [name, setName] = useState(existing?.name ?? "");
	const [district, setDistrict] = useState(existing?.district ?? "");
	const [headBirth, setHeadBirth] = useState(existing?.headBirth ?? "");
	const [note, setNote] = useState(existing?.note ?? "");
	const [members, setMembers] = useState<Member[]>(() => (existing?.members ?? []).map((m) => ({ ...m })));
	const [err, setErr] = useState("");

	const setM = (i: number, k: keyof Member, v: string) => setMembers((ms) => ms.map((m, j) => (j === i ? { ...m, [k]: v } : m)));

	const save = () => {
		const head = headName.trim();
		if (!head) return setErr("世帯主の氏名を入力してください。");
		const id = existing?.id ?? uid("h_");
		const surname = head.split(/[\s　]/)[0];
		const h: Household = {
			id,
			headName: head,
			name: name.trim() || surname + "家",
			district: district.trim(),
			headBirth: headBirth.trim(),
			note: note.trim(),
			members: members.map((m) => ({ name: m.name.trim(), relation: m.relation || "その他", birthYear: String(m.birthYear || "").trim() })).filter((m) => m.name),
			createdAt: existing?.createdAt ?? Date.now(),
			updatedAt: Date.now(),
		};
		mutate((d) => { d.households[id] = h; });
		closeModal();
		toast(existing ? "世帯情報を保存しました" : "世帯を登録しました");
		if (!existing) onRegistered?.(id);
	};

	return (
		<Modal
			title={existing ? "世帯情報を編集" : "世帯を登録"}
			onClose={closeModal}
			footer={<>
				<button className="btn ghost" onClick={closeModal}>キャンセル</button>
				<button className="btn primary" onClick={save}>{existing ? "保存する" : "登録してはじめる"}</button>
			</>}
		>
			<form style={{ display: "contents" }} onSubmit={(e) => { e.preventDefault(); save(); }}>
				<div className="two">
					<div className="field"><label htmlFor="hh-head">世帯主の氏名</label><input type="text" id="hh-head" autoFocus value={headName} onChange={(e) => setHeadName(e.target.value)} placeholder="例：山田 太郎" /></div>
					<div className="field"><label htmlFor="hh-name">世帯名</label><input type="text" id="hh-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：山田家（空欄なら自動）" /></div>
				</div>
				<div className="two">
					<div className="field"><label htmlFor="hh-district">地区・班</label><input type="text" id="hh-district" value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="例：東町 3班" /></div>
					<div className="field"><label htmlFor="hh-hb">世帯主の生まれ年</label><input type="number" id="hh-hb" min={1900} max={2100} value={headBirth} onChange={(e) => setHeadBirth(e.target.value)} placeholder="任意" /></div>
				</div>
				<div className="field">
					<span className="lbl">家族構成（世帯主以外）</span>
					<div className="fam-edit">
						{members.length === 0 && <p style={{ fontSize: 13, color: "var(--muted)" }}>一人暮らしの場合は追加不要です。</p>}
						{members.map((m, i) => (
							<div className="fam-line" key={i}>
								<input type="text" id={`fm-n-${i}`} placeholder="氏名" aria-label="家族の氏名" value={m.name} onChange={(e) => setM(i, "name", e.target.value)} />
								<select id={`fm-r-${i}`} aria-label="続柄" value={m.relation} onChange={(e) => setM(i, "relation", e.target.value)}>
									{RELS.map((r) => <option key={r}>{r}</option>)}
								</select>
								<input type="number" id={`fm-b-${i}`} placeholder="生まれ年" aria-label="生まれ年" min={1900} max={2100} value={m.birthYear} onChange={(e) => setM(i, "birthYear", e.target.value)} />
								<button type="button" className="btn small ghost rm" onClick={() => setMembers((ms) => ms.filter((_, j) => j !== i))}>削除</button>
							</div>
						))}
					</div>
					<button type="button" id="fam-add" className="btn small" style={{ alignSelf: "flex-start" }} onClick={() => setMembers((ms) => [...ms, { name: "", relation: "配偶者", birthYear: "" }])}>＋ 家族を追加</button>
				</div>
				<div className="field"><label htmlFor="hh-note">連絡メモ</label><textarea id="hh-note" style={{ minHeight: 70 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="受け渡しに都合のよい時間帯など（任意）" /></div>
				{err && <p className="err">{err}</p>}
			</form>
		</Modal>
	);
}
