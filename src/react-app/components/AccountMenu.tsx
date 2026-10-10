import { useEffect, useRef, useState } from "react";
import { authApi } from "../lib/api";
import { useApp } from "../lib/app";
import { homeOf, nameOf } from "../lib/domain";
import { useData } from "../lib/store";
import { IconMenu } from "./icons";
import { Dot, Modal } from "./ui";

/** 右上の丸いボタンと、そのメニュー */
export function AccountMenu() {
	const { d, me, user, logout } = useData();
	const { goTab, openModal } = useApp();
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
		const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
		addEventListener("mousedown", close);
		addEventListener("keydown", esc);
		return () => { removeEventListener("mousedown", close); removeEventListener("keydown", esc); };
	}, [open]);
	if (!me || !user) return null;
	const pick = (fn: () => void) => () => { setOpen(false); fn(); };
	return (
		<div className="who-wrap" ref={ref}>
			<button className="who" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
				<IconMenu />
				<span className="who-name">{nameOf(d, me)}</span>
				<Dot id={me} />
			</button>
			{open && (
				<div className="menu" role="menu">
					<div className="menu-head"><b>{nameOf(d, me)}</b><span>{homeOf(d, me)}</span><span>ログインID：{user.loginId}{user.role === "admin" ? " ・ 管理者" : ""}</span></div>
					<button role="menuitem" onClick={pick(() => goTab("home"))}>世帯と家族{user.role === "admin" ? "・アカウント管理" : ""}</button>
					<button role="menuitem" onClick={pick(() => openModal(<PasswordForm />))}>パスワードを変更</button>
					<hr />
					<button role="menuitem" id="logout" onClick={pick(() => void logout())}>ログアウト</button>
				</div>
			)}
		</div>
	);
}

function PasswordForm() {
	const { closeModal, toast } = useApp();
	const [cur, setCur] = useState("");
	const [pw, setPw] = useState("");
	const [pw2, setPw2] = useState("");
	const [err, setErr] = useState("");
	const [busy, setBusy] = useState(false);
	const save = async () => {
		if (pw !== pw2) return setErr("確認用のパスワードが一致しません。");
		setBusy(true); setErr("");
		try { await authApi.changePassword(cur, pw); closeModal(); toast("パスワードを変更しました。ほかの端末はログアウトされます"); }
		catch (e) { setErr((e as Error).message); setBusy(false); }
	};
	return (
		<Modal title="パスワードを変更" onClose={closeModal} footer={<>
			<button className="btn ghost" onClick={closeModal}>キャンセル</button>
			<button className="btn primary" disabled={busy || !cur || !pw} onClick={save}>{busy ? "変更中…" : "変更する"}</button>
		</>}>
			<form style={{ display: "contents" }} onSubmit={(e) => { e.preventDefault(); void save(); }}>
				<div className="field"><label htmlFor="pw-cur">今のパスワード</label><input type="password" id="pw-cur" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} autoFocus /></div>
				<div className="two">
					<div className="field"><label htmlFor="pw-new">新しいパスワード</label><input type="password" id="pw-new" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /><span className="hint">8文字以上</span></div>
					<div className="field"><label htmlFor="pw-new2">新しいパスワード（確認）</label><input type="password" id="pw-new2" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
				</div>
				{err && <p className="err">{err}</p>}
			</form>
		</Modal>
	);
}
