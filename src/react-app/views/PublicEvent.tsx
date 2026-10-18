import { useEffect, useState, type FormEvent } from "react";
import { CONFIG } from "../config";
import { authApi, publicApi, type GuestEntry, type PublicEvent } from "../lib/api";
import { evDay } from "../lib/util";

/**
 * 会員以外も参加登録できるイベントの公開ページ（/e/<token>）
 * - 見せるのはタイトル・日時・場所の先頭6文字だけ（説明・参加者・人数・主催者は出さない）
 * - 会員はログインへ、会員でない人は名前・人数・ひとことで登録
 * - 登録した端末に編集用の鍵を保存し、あとから変更・取り消しできる
 */
type Saved = { id: string; editToken: string };
const keyOf = (token: string) => "kaga-guest:" + token;
function loadSaved(token: string): Saved | null {
	try { const v = JSON.parse(localStorage.getItem(keyOf(token)) ?? "null"); return v && typeof v.id === "string" && typeof v.editToken === "string" ? v : null; } catch { return null; }
}
function save(token: string, v: Saved | null) {
	try { if (v) localStorage.setItem(keyOf(token), JSON.stringify(v)); else localStorage.removeItem(keyOf(token)); } catch { /* 保存できない端末でも登録はできる */ }
}

export function PublicEventPage({ token }: { token: string }) {
	const [ev, setEv] = useState<PublicEvent | null>(null);
	const [loadErr, setLoadErr] = useState("");
	const [saved, setSaved] = useState<Saved | null>(() => loadSaved(token));
	const [mine, setMine] = useState<GuestEntry | null>(null);
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState("");
	const [people, setPeople] = useState("1");
	const [note, setNote] = useState("");
	const [err, setErr] = useState("");
	const [msg, setMsg] = useState("");
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		publicApi.event(token).then(async (e) => {
			// ログイン中の会員なら、いつもの画面でこのイベントを開く（通常はサーバーで振り分け済み。念のための予備）
			const me = await authApi.me().catch(() => null);
			if (me?.user) { location.replace(`/?post=${encodeURIComponent(e.postId)}`); return; }
			setEv(e); document.title = `${e.title}｜参加登録`;
		}).catch((e) => setLoadErr((e as Error).message));
	}, [token]);
	useEffect(() => {
		if (!saved) { setMine(null); return; }
		publicApi.me(token, saved.id, saved.editToken)
			.then((g) => { setMine(g); setName(g.name); setPeople(String(g.people)); setNote(g.note); })
			.catch(() => { save(token, null); setSaved(null); });
	}, [token, saved]);

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (!name.trim()) return setErr("お名前を入力してください。");
		setBusy(true); setErr(""); setMsg("");
		const g = { name: name.trim(), people: Math.max(1, Math.min(20, parseInt(people, 10) || 1)), note: note.trim() };
		try {
			if (saved && mine) {
				await publicApi.update(token, saved.id, saved.editToken, g);
				setMine(g); setEditing(false); setMsg("登録内容を変更しました。");
			} else {
				const r = await publicApi.register(token, g);
				const s = { id: r.id, editToken: r.editToken };
				save(token, s); setSaved(s); setMine(g); setMsg("参加を登録しました。当日お待ちしています。");
			}
		} catch (x) { setErr((x as Error).message); }
		setBusy(false);
	};
	const cancel = async () => {
		if (!saved) return;
		setBusy(true); setErr("");
		try { await publicApi.cancel(token, saved.id, saved.editToken); save(token, null); setSaved(null); setMine(null); setName(""); setPeople("1"); setNote(""); setMsg("参加を取り消しました。"); }
		catch (x) { setErr((x as Error).message); }
		setBusy(false);
	};

	const form = (
		<form className="auth-form" onSubmit={submit}>
			<div className="field"><label htmlFor="g-name">お名前</label><input type="text" id="g-name" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="例：山田 花子" autoComplete="name" /></div>
			<div className="field"><label htmlFor="g-people">人数</label><input type="number" id="g-people" min={1} max={20} value={people} onChange={(e) => setPeople(e.target.value)} /></div>
			<div className="field"><label htmlFor="g-note">ひとこと（任意）</label><input type="text" id="g-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例：子ども1人を含みます" /></div>
			<p className="hint-p">お名前と人数は、主催者とコミュニティの会員にだけ表示されます。このページには表示されません。電話番号や住所は入力しないでください。</p>
			{err && <p className="err">{err}</p>}
			<button className="btn primary block" id="g-submit" disabled={busy}>{busy ? "送信中…" : mine ? "変更する" : "参加を登録する"}</button>
		</form>
	);

	return (
		<div className="wrap">
			<div className="gate public-event">
				<a className="pe-brand" href="/"><span className="brand-mark" aria-hidden="true" />{CONFIG.siteName}</a>
				{loadErr ? (
					<div className="card auth-card"><p className="err" style={{ margin: 0 }}>{loadErr}</p></div>
				) : !ev ? (
					<div className="card auth-card"><p className="hint-p">読み込み中…</p></div>
				) : (
					<>
						<div className="card auth-card">
							<h1 className="pe-title" id="pe-title">{ev.title}</h1>
							{(ev.date || ev.place) && (
								<dl className="evbox pe-when">
									{ev.date && <><dt>{ev.kind === "クラウドファンディング" ? "締切日" : "日時"}</dt><dd id="pe-date">{evDay(ev.date)}{ev.start ? ` ${ev.start}` : ""}{ev.end ? `〜${ev.end}` : ""}</dd></>}
									{ev.place && <><dt>場所</dt><dd className="multiline" id="pe-place">{ev.place}</dd></>}
								</dl>
							)}
						</div>
						{msg && <p className="pe-msg" role="status">{msg}</p>}
						{!ev.open && !mine ? (
							<div className="card auth-card"><p style={{ margin: 0 }}>{ev.reason}</p></div>
						) : (
							<>
								<div className="card auth-card">
									<h2 className="pe-h">コミュニティの会員の方</h2>
									<p className="hint-p">ログインすると、いつもの画面から参加できます。</p>
									<a className="btn block" id="pe-login" href={`/?post=${encodeURIComponent(ev.postId)}`}>ログインして参加する</a>
								</div>
								<div className="card auth-card">
									<h2 className="pe-h">会員でない方</h2>
									{mine && !editing ? (
										<div className="pe-mine" id="pe-mine">
											<p><b>{mine.name}</b> さん・{mine.people}人で登録しています。{mine.note && <><br /><small>{mine.note}</small></>}</p>
											<div className="rs-row">
												{ev.open && <button className="btn small" onClick={() => setEditing(true)}>変更する</button>}
												<button className="btn small ghost" id="g-cancel" disabled={busy} onClick={cancel}>参加を取り消す</button>
											</div>
											<p className="hint-p">変更・取り消しは、この端末（このブラウザ）からできます。</p>
										</div>
									) : form}
								</div>
							</>
						)}
					</>
				)}
				<p className="gate-note"><a href="/privacy.html">個人情報の取り扱いとセキュリティ</a></p>
			</div>
		</div>
	);
}
