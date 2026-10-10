import { useEffect, useState, type FormEvent } from "react";
import { CONFIG } from "../config";
import { authApi } from "../lib/api";
import { useData } from "../lib/store";

/** URL の ?invite=XXXXX-XXXXX を読む */
const inviteFromUrl = () => { try { return new URLSearchParams(location.search).get("invite") ?? ""; } catch { return ""; } };
const clearInviteFromUrl = () => { try { history.replaceState(null, "", location.pathname); } catch { /* 無視 */ } };

function Hero() {
	return (
		<div className="hero">
			<span className="brand-mark" aria-hidden="true" />
			<h2>{CONFIG.siteName}</h2>
			<p className="tag">{CONFIG.tagline}</p>
		</div>
	);
}

function useSubmit() {
	const [busy, setBusy] = useState(false);
	const [err, setErr] = useState("");
	const run = async (fn: () => Promise<void>) => {
		setBusy(true); setErr("");
		try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
	};
	return { busy, err, setErr, run };
}

const LoginIdField = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
	<div className="field">
		<label htmlFor="acc-id">ログインID</label>
		<input type="text" id="acc-id" autoComplete="username" autoCapitalize="none" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} placeholder="例：yamada-family" />
		<span className="hint">半角英小文字・数字・記号（_ . -）で3〜32文字。ログインのときに使います。</span>
	</div>
);

function NewPasswordFields({ pw, setPw, pw2, setPw2 }: { pw: string; setPw: (v: string) => void; pw2: string; setPw2: (v: string) => void }) {
	return (
		<div className="two">
			<div className="field"><label htmlFor="acc-pw">パスワード</label><input type="password" id="acc-pw" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /><span className="hint">8文字以上</span></div>
			<div className="field"><label htmlFor="acc-pw2">パスワード（確認）</label><input type="password" id="acc-pw2" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
		</div>
	);
}

// ---------------------------------------------------------------
export function LoginGate() {
	const [mode, setMode] = useState<"login" | "invite">(() => (inviteFromUrl() ? "invite" : "login"));
	return (
		<div className="wrap">
			<div className="gate">
				<Hero />
				<div className="card auth-card">
					<div className="seg" role="group" style={{ marginBottom: 20 }}>
						<button aria-pressed={mode === "login"} onClick={() => setMode("login")}>ログイン</button>
						<button aria-pressed={mode === "invite"} onClick={() => setMode("invite")}>招待コードで登録</button>
					</div>
					{mode === "login" ? <LoginForm /> : <InviteForm />}
				</div>
				<p className="gate-note">ログインは家族ひとりずつです。運営や家族から届いた招待コードで登録してください。パスワードを忘れたときは、家族か運営に「再設定コード」を発行してもらってください。</p>
			</div>
		</div>
	);
}

function LoginForm() {
	const { refreshAuth } = useData();
	const [id, setId] = useState("");
	const [pw, setPw] = useState("");
	const { busy, err, run } = useSubmit();
	const submit = (e: FormEvent) => { e.preventDefault(); void run(async () => { await authApi.login(id.trim(), pw); await refreshAuth(); }); };
	return (
		<form className="auth-form" onSubmit={submit}>
			<div className="field"><label htmlFor="login-id">ログインID</label><input type="text" id="login-id" autoComplete="username" autoCapitalize="none" spellCheck={false} value={id} onChange={(e) => setId(e.target.value)} autoFocus /></div>
			<div className="field"><label htmlFor="login-pw">パスワード</label><input type="password" id="login-pw" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
			{err && <p className="err">{err}</p>}
			<button className="btn primary block" id="login-submit" disabled={busy || !id || !pw}>{busy ? "確認中…" : "ログイン"}</button>
		</form>
	);
}

function InviteForm() {
	const { refreshAuth } = useData();
	const [code, setCode] = useState(inviteFromUrl);
	const [info, setInfo] = useState<Awaited<ReturnType<typeof authApi.invite>> | null>(null);
	const [loginId, setLoginId] = useState("");
	const [pw, setPw] = useState("");
	const [pw2, setPw2] = useState("");
	const { busy, err, setErr, run } = useSubmit();

	const check = () => run(async () => { setInfo(await authApi.invite(code.trim())); });
	// URL にコードが付いていたら自動で確認
	useEffect(() => { if (code && !info) void check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

	const accept = (e: FormEvent) => {
		e.preventDefault();
		if (pw !== pw2) return setErr("確認用のパスワードが一致しません。");
		void run(async () => {
			await authApi.accept(code.trim(), pw, info?.purpose === "new" ? loginId.trim() : undefined);
			clearInviteFromUrl();
			await refreshAuth();
		});
	};

	if (!info) {
		return (
			<form className="auth-form" onSubmit={(e) => { e.preventDefault(); void check(); }}>
				<div className="field"><label htmlFor="inv-code">招待コード</label><input type="text" id="inv-code" autoCapitalize="characters" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} placeholder="例：K7QF3-MXP2A" autoFocus /></div>
				{err && <p className="err">{err}</p>}
				<button className="btn primary block" disabled={busy || code.trim().length < 10}>{busy ? "確認中…" : "次へ"}</button>
			</form>
		);
	}
	return (
		<form className="auth-form" onSubmit={accept}>
			<div className="invite-for">
				<span>{info.purpose === "new" ? "ログインを作ります" : "パスワードを設定し直します"}</span>
				<b>{info.person?.name ?? "—"} さん</b>
				<span>{info.household?.name}{info.household?.district ? ` ・ ${info.household.district}` : ""}{info.person?.relation ? ` ・ ${info.person.relation}` : ""}</span>
				{info.purpose === "reset" && info.loginId && <span>ログインID：{info.loginId}</span>}
			</div>
			{info.purpose === "new" && <LoginIdField value={loginId} onChange={setLoginId} />}
			<NewPasswordFields pw={pw} setPw={setPw} pw2={pw2} setPw2={setPw2} />
			{info.purpose === "new" && <p className="hint-p">家族構成や連絡メモは、ログインしたあと「世帯」タブで登録・変更できます。</p>}
			{err && <p className="err">{err}</p>}
			<button className="btn primary block" id="accept-submit" disabled={busy}>{busy ? "登録中…" : info.purpose === "new" ? "登録してはじめる" : "パスワードを設定する"}</button>
		</form>
	);
}

// ---------------------------------------------------------------
/** 最初の管理者を作る（アカウントが1つもないときだけ表示） */
export function SetupGate() {
	const { refreshAuth } = useData();
	const [setupCode, setSetupCode] = useState("");
	const [loginId, setLoginId] = useState("");
	const [pw, setPw] = useState("");
	const [pw2, setPw2] = useState("");
	const [name, setName] = useState("");
	const [hhName, setHhName] = useState("");
	const [district, setDistrict] = useState("");
	const { busy, err, setErr, run } = useSubmit();
	const submit = (e: FormEvent) => {
		e.preventDefault();
		if (pw !== pw2) return setErr("確認用のパスワードが一致しません。");
		if (!name.trim()) return setErr("お名前を入力してください。");
		void run(async () => {
			await authApi.setup(setupCode.trim(), loginId.trim(), pw, { name: name.trim() }, { name: hhName.trim(), district: district.trim() });
			await refreshAuth();
		});
	};
	return (
		<div className="wrap">
			<div className="gate">
				<Hero />
				<form className="card auth-form" onSubmit={submit}>
					<h3>はじめの設定（管理者の登録）</h3>
					<p className="hint-p">まだアカウントがありません。運営をする方を管理者として登録します。初期設定コードは、サーバーに設定した <code>ADMIN_SETUP_CODE</code> の値です。</p>
					<div className="field"><label htmlFor="setup-code">初期設定コード</label><input type="password" id="setup-code" value={setupCode} onChange={(e) => setSetupCode(e.target.value)} autoFocus /></div>
					<div className="field"><label htmlFor="setup-name">お名前（世帯主）</label><input type="text" id="setup-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：上條 哲也" /></div>
					<div className="two">
						<div className="field"><label htmlFor="setup-hh">世帯名</label><input type="text" id="setup-hh" value={hhName} onChange={(e) => setHhName(e.target.value)} placeholder="空欄なら自動" /></div>
						<div className="field"><label htmlFor="setup-district">地区・班</label><input type="text" id="setup-district" value={district} onChange={(e) => setDistrict(e.target.value)} /></div>
					</div>
					<LoginIdField value={loginId} onChange={setLoginId} />
					<NewPasswordFields pw={pw} setPw={setPw} pw2={pw2} setPw2={setPw2} />
					{err && <p className="err">{err}</p>}
					<button className="btn primary block" id="setup-submit" disabled={busy}>{busy ? "登録中…" : "管理者として登録"}</button>
				</form>
			</div>
		</div>
	);
}
