import { useState } from "react";
import { ConfirmButton, Modal } from "../components/ui";
import { useApp } from "../lib/app";
import { useData } from "../lib/store";
import type { Job, JobType } from "../lib/types";
import { isWhole, uid } from "../lib/util";

/**
 * 仕事の登録・編集
 * - できること（引き受けます）：自分ができる手伝いを出す。相談してきた人が頼む側
 * - お願い（依頼）：手伝ってほしいことを出す。相談してきた人が引き受ける側
 * 種類は作ったあとで変えられない（相談の立場と石の流れが逆になるため）
 */
export function JobForm({ existing, defaultType = "offer" }: { existing?: Job; defaultType?: JobType }) {
	const { mutate, me } = useData();
	const { closeModal, toast, goTab, setJobMode } = useApp();
	const [type, setType] = useState<JobType>(existing?.type ?? defaultType);
	const [title, setTitle] = useState(existing?.title ?? "");
	const [desc, setDesc] = useState(existing?.desc ?? "");
	const [price, setPrice] = useState(existing ? String(existing.price) : "");
	const [wantDate, setWantDate] = useState(existing?.wantDate ?? "");
	const [negotiable, setNegotiable] = useState(existing?.negotiable ?? true);
	const [active, setActive] = useState(existing?.active ?? true);
	const [err, setErr] = useState("");
	const req = type === "request";

	const save = () => {
		if (!me) return;
		if (!title.trim()) return setErr("タイトルを入力してください。");
		if (!isWhole(price)) return setErr("石の額を0以上の整数で入力してください。");
		const id = existing?.id ?? uid("j_");
		mutate((d) => {
			d.jobs[id] = {
				id, owner: me, type, wantDate: req ? wantDate : "", title: title.trim(), desc: desc.trim(), price: +price, negotiable, active,
				createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now(),
			};
		});
		closeModal();
		setJobMode("mine");
		goTab("jobs");
		toast(existing ? "保存しました" : req ? "お願いを出しました" : "仕事を登録しました");
	};

	const noun = req ? "お願い" : "仕事";
	return (
		<Modal
			title={existing ? `${noun}を編集` : req ? "お願いを出す" : "できることを登録"}
			onClose={closeModal}
			footer={<>
				{existing && <ConfirmButton onConfirm={() => { mutate((d) => { delete d.jobs[existing.id]; }); closeModal(); toast(`${noun}を削除しました`); }}>削除</ConfirmButton>}
				<button className="btn ghost" onClick={closeModal}>キャンセル</button>
				<button className="btn primary" id="jf-save" onClick={save}>{existing ? "保存する" : req ? "お願いを出す" : "登録する"}</button>
			</>}
		>
			<form style={{ display: "contents" }} onSubmit={(e) => { e.preventDefault(); save(); }}>
				<div className="field">
					<span className="lbl">種類</span>
					<div className="radio-row">
						<label><input type="radio" name="jf-type" id="jf-type-offer" checked={!req} disabled={!!existing} onChange={() => setType("offer")} />できること（引き受けます）</label>
						<label><input type="radio" name="jf-type" id="jf-type-request" checked={req} disabled={!!existing} onChange={() => setType("request")} />お願いしたいこと（依頼）</label>
					</div>
					{existing && <span className="hint">種類はあとから変えられません。</span>}
				</div>
				<div className="field"><label htmlFor="jf-title">タイトル</label><input type="text" id="jf-title" autoFocus maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={req ? "例：小松空港まで送迎してほしい" : "例：庭の草刈りをします"} /></div>
				<div className="field"><label htmlFor="jf-desc">{req ? "お願いの内容" : "仕事内容"}</label><textarea id="jf-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={req ? "行き先・時間・人数や荷物など、引き受ける人が判断できるように" : "作業の範囲、所要時間の目安、対応できる曜日や時間帯など"} /></div>
				<div className={req ? "two" : undefined}>
					<div className="field"><label htmlFor="jf-price">{req ? "お礼の石" : "石の価格"}</label><div className="price-in"><input type="number" id="jf-price" min={0} step={1} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" /><span>石</span></div></div>
					{req && <div className="field"><label htmlFor="jf-date">希望日（任意）</label><input type="date" id="jf-date" value={wantDate} onChange={(e) => setWantDate(e.target.value)} /></div>}
				</div>
				<div className="field">
					<span className="lbl">石の額の交渉</span>
					<div className="radio-row">
						<label><input type="radio" name="jf-neg" checked={negotiable} onChange={() => setNegotiable(true)} />交渉あり</label>
						<label><input type="radio" name="jf-neg" checked={!negotiable} onChange={() => setNegotiable(false)} />交渉なし</label>
					</div>
					<span className="hint">「交渉あり」にすると、相談の中で石の額を話し合えることが相手に伝わります。</span>
				</div>
				<div className="field"><span className="lbl">受付</span><div className="radio-row"><label><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />{req ? "募集中にする（一覧に表示）" : "受付中にする（一覧に表示）"}</label></div></div>
				{err && <p className="err">{err}</p>}
			</form>
		</Modal>
	);
}
