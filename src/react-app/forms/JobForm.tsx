import { useState } from "react";
import { ConfirmButton, Modal } from "../components/ui";
import { useApp } from "../lib/app";
import { useData } from "../lib/store";
import type { Job } from "../lib/types";
import { isWhole, uid } from "../lib/util";

export function JobForm({ existing }: { existing?: Job }) {
	const { mutate, me } = useData();
	const { closeModal, toast, goTab, setJobMode } = useApp();
	const [title, setTitle] = useState(existing?.title ?? "");
	const [desc, setDesc] = useState(existing?.desc ?? "");
	const [price, setPrice] = useState(existing ? String(existing.price) : "");
	const [negotiable, setNegotiable] = useState(existing?.negotiable ?? true);
	const [active, setActive] = useState(existing?.active ?? true);
	const [err, setErr] = useState("");

	const save = () => {
		if (!me) return;
		if (!title.trim()) return setErr("タイトルを入力してください。");
		if (!isWhole(price)) return setErr("石の価格を0以上の整数で入力してください。");
		const id = existing?.id ?? uid("j_");
		mutate((d) => {
			d.jobs[id] = {
				id, owner: me, title: title.trim(), desc: desc.trim(), price: +price, negotiable, active,
				createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now(),
			};
		});
		closeModal();
		setJobMode("mine");
		goTab("jobs");
		toast(existing ? "保存しました" : "仕事を登録しました");
	};

	return (
		<Modal
			title={existing ? "仕事を編集" : "仕事を登録"}
			onClose={closeModal}
			footer={<>
				{existing && <ConfirmButton onConfirm={() => { mutate((d) => { delete d.jobs[existing.id]; }); closeModal(); toast("仕事を削除しました"); }}>削除</ConfirmButton>}
				<button className="btn ghost" onClick={closeModal}>キャンセル</button>
				<button className="btn primary" id="jf-save" onClick={save}>{existing ? "保存する" : "登録する"}</button>
			</>}
		>
			<form style={{ display: "contents" }} onSubmit={(e) => { e.preventDefault(); save(); }}>
				<div className="field"><label htmlFor="jf-title">タイトル</label><input type="text" id="jf-title" autoFocus maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：庭の草刈りをします" /></div>
				<div className="field"><label htmlFor="jf-desc">仕事内容</label><textarea id="jf-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="作業の範囲、所要時間の目安、対応できる曜日や時間帯など" /></div>
				<div className="field"><label htmlFor="jf-price">石の価格</label><div className="price-in"><input type="number" id="jf-price" min={0} step={1} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" /><span>石</span></div></div>
				<div className="field">
					<span className="lbl">価格の交渉</span>
					<div className="radio-row">
						<label><input type="radio" name="jf-neg" checked={negotiable} onChange={() => setNegotiable(true)} />交渉あり</label>
						<label><input type="radio" name="jf-neg" checked={!negotiable} onChange={() => setNegotiable(false)} />交渉なし</label>
					</div>
					<span className="hint">「交渉あり」にすると、相談の中で石の価格を話し合えることが相手に伝わります。</span>
				</div>
				<div className="field"><span className="lbl">受付</span><div className="radio-row"><label><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />受付中にする（一覧に表示）</label></div></div>
				{err && <p className="err">{err}</p>}
			</form>
		</Modal>
	);
}
