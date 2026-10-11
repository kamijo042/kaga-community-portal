import { useRef, useState } from "react";
import { ConfirmButton, Modal, Photo } from "../components/ui";
import { useApp } from "../lib/app";
import { itemStone, PAY_LABEL, payModeOf } from "../lib/domain";
import { useData } from "../lib/store";
import type { Item, PayMode } from "../lib/types";
import { compressImage, uid } from "../lib/util";

type Ph = { pid?: string; data?: string };

const PAY_HINT: Record<PayMode, string> = {
	stone: "石だけで受け渡します。",
	yen: "円（現金）だけで受け渡します。",
	either: "買う人が、石か円のどちらかを選んで払います。",
	both: "石と円を合わせて払ってもらいます（例：500円＋5石）。",
};

export function ItemForm({ existing }: { existing?: Item }) {
	const { mutate, me, photos } = useData();
	const { closeModal, toast, goTab, setMktMode } = useApp();
	const st0 = existing ? itemStone(existing) : null;
	const [name, setName] = useState(existing?.name ?? "");
	const [desc, setDesc] = useState(existing?.desc ?? "");
	const [stone, setStone] = useState(st0 === null || st0 === undefined ? "" : String(st0));
	const [yen, setYen] = useState(existing?.priceYen === null || existing?.priceYen === undefined ? "" : String(existing.priceYen));
	const [mode, setMode] = useState<PayMode>(existing ? payModeOf(existing) : "stone");
	const useStone = mode !== "yen", useYen = mode !== "stone";
	const [phs, setPhs] = useState<Ph[]>(() => (existing?.photos ?? []).map((pid) => ({ pid })));
	const [err, setErr] = useState("");
	const [busy, setBusy] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);

	const addFiles = async (files: FileList | null) => {
		setErr("");
		for (const f of Array.from(files ?? []).slice(0, 4 - phs.length)) {
			try {
				const data = await compressImage(f);
				setPhs((p) => (p.length < 4 ? [...p, { data }] : p));
			} catch (e) { setErr((e as Error).message); }
		}
	};

	const bad = (v: string) => v.trim() !== "" && !(Number.isInteger(+v) && +v >= 0);

	const save = async () => {
		if (!me) return;
		if (!name.trim()) return setErr("商品名を入力してください。");
		if (useStone && stone.trim() === "") return setErr("石の値段を入力してください。");
		if (useYen && yen.trim() === "") return setErr("円の値段を入力してください。");
		if ((useStone && bad(stone)) || (useYen && bad(yen))) return setErr("値段は0以上の整数で入力してください。");
		setBusy(true);
		try {
			const pids: string[] = [];
			for (const p of phs) pids.push(p.pid ?? (await photos.put(p.data as string)));
			for (const old of existing?.photos ?? []) if (!pids.includes(old)) photos.del(old);
			const id = existing?.id ?? uid("i_");
			mutate((d) => {
				const base: Item = existing ? { ...existing } : ({ status: "open" } as Item);
				delete base.price;
				d.items[id] = {
					...base, id, owner: me, name: name.trim(), desc: desc.trim(),
					priceStone: useStone ? +stone : null, priceYen: useYen ? +yen : null, payMode: mode,
					photos: pids, status: existing?.status ?? "open",
					createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now(),
				};
			});
			closeModal();
			setMktMode("mine");
			goTab("market");
			toast(existing ? "保存しました" : "出品しました");
		} catch {
			setErr("保存できませんでした。画像の枚数を減らして試してください。");
			setBusy(false);
		}
	};

	const remove = () => {
		if (!existing) return;
		for (const p of existing.photos ?? []) photos.del(p);
		mutate((d) => { delete d.items[existing.id]; });
		closeModal();
		toast("出品を削除しました");
	};

	return (
		<Modal
			title={existing ? "出品を編集" : "出品する"}
			onClose={closeModal}
			footer={<>
				{existing && <ConfirmButton onConfirm={remove}>削除</ConfirmButton>}
				<button className="btn ghost" onClick={closeModal}>キャンセル</button>
				<button className="btn primary" id="it-save" disabled={busy} onClick={save}>{busy ? "保存中…" : existing ? "保存する" : "出品する"}</button>
			</>}
		>
			<form style={{ display: "contents" }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
				<div className="field">
					<span className="lbl">画像（4枚まで）</span>
					<div className="photos-edit">
						{phs.map((p, i) => (
							<div className="pe" key={p.pid ?? i}>
								{p.data ? <img src={p.data} alt="" /> : <Photo pid={p.pid as string} />}
								<button type="button" aria-label="画像を外す" onClick={() => setPhs((x) => x.filter((_, j) => j !== i))}>×</button>
							</div>
						))}
						{phs.length < 4 && <button type="button" className="pe add" onClick={() => fileRef.current?.click()}>＋<br />画像を追加</button>}
					</div>
					<input ref={fileRef} type="file" id="it-file" accept="image/*" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ""; }} />
					<span className="hint">1枚目が一覧に表示されます。</span>
				</div>
				<div className="field"><label htmlFor="it-name">商品名</label><input type="text" id="it-name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="例：子ども用自転車 16インチ" /></div>
				<div className="field"><label htmlFor="it-desc">説明</label><textarea id="it-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="状態、サイズ、使用期間、受け渡しの場所や時間など" /></div>
				<div className="field">
					<span className="lbl">払い方</span>
					<div className="radio-row pay-modes">
						{(["stone", "yen", "either", "both"] as const).map((m) => (
							<label key={m}><input type="radio" name="it-pay" id={`it-pay-${m}`} checked={mode === m} onChange={() => setMode(m)} />{PAY_LABEL[m]}</label>
						))}
					</div>
					<span className="hint">{PAY_HINT[mode]}</span>
				</div>
				<div className="field">
					<span className="lbl">値段</span>
					<div className="price-row">
						{useStone && <div className="price-in"><input type="number" id="it-stone" min={0} step={1} inputMode="numeric" aria-label="値段（石）" value={stone} onChange={(e) => setStone(e.target.value)} placeholder="0" /><span>石</span></div>}
						{mode === "either" && <span className="price-join">または</span>}
						{mode === "both" && <span className="price-join">＋</span>}
						{useYen && <div className="price-in"><input type="number" id="it-yen" min={0} step={1} inputMode="numeric" aria-label="値段（円）" value={yen} onChange={(e) => setYen(e.target.value)} placeholder="0" /><span>円</span></div>}
					</div>
				</div>
				{err && <p className="err">{err}</p>}
			</form>
		</Modal>
	);
}
