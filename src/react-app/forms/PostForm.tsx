import { useRef, useState } from "react";
import { ConfirmButton, Modal, Photo } from "../components/ui";
import { useApp } from "../lib/app";
import { AGES, CATS, SUBKINDS } from "../lib/domain";
import { useData } from "../lib/store";
import type { Post, PostCat } from "../lib/types";
import { compressImage, uid } from "../lib/util";

export function PostForm({ existing, defaultCat = "event" }: { existing?: Post; defaultCat?: PostCat }) {
	const { mutate, me, photos } = useData();
	const { closeModal, toast, goTab } = useApp();
	const ev = existing?.event;
	const [cat, setCat] = useState<PostCat>(existing?.cat ?? defaultCat);
	const [kind, setKind] = useState(existing?.kind ?? SUBKINDS[existing?.cat ?? defaultCat][0]);
	const [title, setTitle] = useState(existing?.title ?? "");
	const [body, setBody] = useState(existing?.body ?? "");
	const [link, setLink] = useState(existing?.link ?? "");
	const [targets, setTargets] = useState<string[]>(existing?.targets ?? []);
	const [date, setDate] = useState(ev?.date ?? "");
	const [start, setStart] = useState(ev?.start ?? "");
	const [end, setEnd] = useState(ev?.end ?? "");
	const [place, setPlace] = useState(ev?.place ?? "");
	const [cap, setCap] = useState(ev?.capacity ? String(ev.capacity) : "");
	const [bring, setBring] = useState(ev?.bring ?? "");
	const [photo, setPhoto] = useState<{ pid?: string; data?: string } | null>(existing?.photo ? { pid: existing.photo } : null);
	const [err, setErr] = useState("");
	const [busy, setBusy] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);

	const changeCat = (c: PostCat) => { setCat(c); if (!SUBKINDS[c].includes(kind)) setKind(SUBKINDS[c][0]); };
	const toggleTarget = (a: string) => setTargets((t) => (t.includes(a) ? t.filter((x) => x !== a) : [...t, a]));

	const save = async () => {
		if (!me) return;
		if (!title.trim()) return setErr("タイトルを入力してください。");
		if (cat === "event" && !date) return setErr("イベントの日付を入力してください。");
		if (link.trim() && !/^https?:\/\//.test(link.trim())) return setErr("参考リンクは http:// か https:// で始まるURLを入力してください。");
		setBusy(true);
		try {
			let pid = photo?.pid ?? null;
			if (photo?.data) pid = await photos.put(photo.data);
			if (existing?.photo && existing.photo !== pid) photos.del(existing.photo);
			const id = existing?.id ?? uid("n_");
			mutate((d) => {
				d.posts[id] = {
					id, owner: me, cat, kind, title: title.trim(), body: body.trim(), link: link.trim(),
					targets: cat === "farm" ? [] : AGES.filter((a) => targets.includes(a)),
					event: cat === "event" ? { date, start, end, place: place.trim(), capacity: +cap || null, bring: bring.trim() } : null,
					photo: pid, rsvps: existing?.rsvps ?? {},
					createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now(),
				};
			});
			closeModal();
			goTab("info");
			toast(existing ? "保存しました" : "投稿しました");
		} catch {
			setErr("保存できませんでした。もう一度お試しください。");
			setBusy(false);
		}
	};

	const remove = () => {
		if (!existing) return;
		if (existing.photo) photos.del(existing.photo);
		mutate((d) => { delete d.posts[existing.id]; });
		closeModal();
		toast("投稿を削除しました");
	};

	return (
		<Modal
			title={existing ? "投稿を編集" : "情報を投稿"}
			onClose={closeModal}
			footer={<>
				{existing && <ConfirmButton onConfirm={remove}>削除</ConfirmButton>}
				<button className="btn ghost" onClick={closeModal}>キャンセル</button>
				<button className="btn primary" id="po-save" disabled={busy} onClick={save}>{busy ? "保存中…" : existing ? "保存する" : "投稿する"}</button>
			</>}
		>
			<form style={{ display: "contents" }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
				<div className="field">
					<span className="lbl">分類</span>
					<div className="radio-row">
						{(Object.keys(CATS) as PostCat[]).map((c) => (
							<label key={c}><input type="radio" name="po-cat" id={`po-cat-${c}`} checked={cat === c} onChange={() => changeCat(c)} />{CATS[c].label}</label>
						))}
					</div>
				</div>
				<div className="field"><label htmlFor="po-kind">種類</label><select id="po-kind" value={kind} onChange={(e) => setKind(e.target.value)}>{SUBKINDS[cat].map((k) => <option key={k}>{k}</option>)}</select></div>
				<div className="field"><label htmlFor="po-title">タイトル</label><input type="text" id="po-title" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：秋の稲刈り体験 参加者募集" /></div>
				{cat === "event" && (
					<div className="field" style={{ gap: 10 }}>
						<div className="two">
							<div className="field"><label htmlFor="po-date">日付</label><input type="date" id="po-date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
							<div className="field"><label htmlFor="po-place">場所</label><input type="text" id="po-place" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="例：山代温泉 公民館" /></div>
						</div>
						<div className="two">
							<div className="field"><label htmlFor="po-start">開始</label><input type="time" id="po-start" value={start} onChange={(e) => setStart(e.target.value)} /></div>
							<div className="field"><label htmlFor="po-end">終了</label><input type="time" id="po-end" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
						</div>
						<div className="two">
							<div className="field"><label htmlFor="po-cap">定員（人・任意）</label><input type="number" id="po-cap" min={1} value={cap} onChange={(e) => setCap(e.target.value)} /></div>
							<div className="field"><label htmlFor="po-bring">持ち物（任意）</label><input type="text" id="po-bring" value={bring} onChange={(e) => setBring(e.target.value)} placeholder="例：軍手、長靴" /></div>
						</div>
					</div>
				)}
				{cat !== "farm" && (
					<div className="field" id="po-tg">
						<span className="lbl">対象</span>
						<div className="check-row">
							{AGES.map((a) => <label key={a}><input type="checkbox" value={a} checked={targets.includes(a)} onChange={() => toggleTarget(a)} />{a}</label>)}
						</div>
						<span className="hint">子どもの年代を選ぶと、該当する子どもがいる世帯に「わが家向け」と表示されます。</span>
					</div>
				)}
				<div className="field"><label htmlFor="po-body">内容</label><textarea id="po-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="詳しい内容、申し込み方法、問い合わせ先など" /></div>
				<div className="field"><label htmlFor="po-link">参考リンク（任意）</label><input type="text" id="po-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" /></div>
				<div className="field">
					<span className="lbl">画像（任意・1枚）</span>
					<div className="photos-edit">
						{photo ? (
							<div className="pe">
								{photo.data ? <img src={photo.data} alt="" /> : <Photo pid={photo.pid as string} />}
								<button type="button" aria-label="画像を外す" onClick={() => setPhoto(null)}>×</button>
							</div>
						) : (
							<button type="button" className="pe add" onClick={() => fileRef.current?.click()}>＋<br />画像を追加</button>
						)}
					</div>
					<input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => {
						const f = e.target.files?.[0];
						e.target.value = "";
						if (!f) return;
						try { setPhoto({ data: await compressImage(f) }); setErr(""); } catch (x) { setErr((x as Error).message); }
					}} />
				</div>
				{err && <p className="err">{err}</p>}
			</form>
		</Modal>
	);
}
