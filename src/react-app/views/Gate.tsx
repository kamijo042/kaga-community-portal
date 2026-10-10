import { useState } from "react";
import { Dot } from "../components/ui";
import { CONFIG } from "../config";
import { useApp } from "../lib/app";
import { familySize, hhLabel } from "../lib/domain";
import { useData } from "../lib/store";
import { HouseholdForm } from "../forms/HouseholdForm";

export function Gate({ onLogin }: { onLogin: (id: string) => void }) {
	const { d } = useData();
	const { openModal } = useApp();
	const list = Object.values(d.households).sort((a, b) => a.createdAt - b.createdAt);
	return (
		<div className="wrap">
			<div className="gate">
				<div className="hero">
					<span className="brand-mark" aria-hidden="true" />
					<h2>{CONFIG.siteName}</h2>
					<p className="tag">{CONFIG.tagline}</p>
					<p>世帯ごとに登録して、地域の情報、仕事の相談、フリマのやり取りをするポータルです。石のやり取りと受け渡しは、会って直接行います。</p>
				</div>
				{list.length > 0 && (
					<div className="card">
						<h3>登録済みの世帯でログイン</h3>
						<div className="gate-list">
							{list.map((h) => (
								<button key={h.id} onClick={() => onLogin(h.id)}>
									<Dot id={h.id} />
									<span className="n"><b>{hhLabel(d, h.id)}</b><br /><small>世帯主 {h.headName}{h.district ? ` ・ ${h.district}` : ""} ・ {familySize(d, h.id)}人</small></span>
								</button>
							))}
						</div>
					</div>
				)}
				<div className="card" style={{ display: "grid", gap: 10, justifyItems: "start" }}>
					<h3>{list.length ? "新しい世帯を登録" : "まず世帯を登録しましょう"}</h3>
					<p style={{ color: "var(--muted)", fontSize: 14 }}>世帯主と家族構成を登録します。登録後、情報の投稿、仕事の登録、フリマへの出品ができるようになります。</p>
					<button className="btn primary" id="hh-new" onClick={() => openModal(<HouseholdForm onRegistered={onLogin} />)}>世帯を登録する</button>
				</div>
			</div>
		</div>
	);
}

export function PasscodeGate() {
	const { submitPasscode } = useData();
	const [v, setV] = useState("");
	const [err, setErr] = useState(false);
	return (
		<div className="wrap">
			<form className="gate" onSubmit={async (e) => { e.preventDefault(); setErr(!(await submitPasscode(v.trim()))); }}>
				<div className="hero"><span className="brand-mark" aria-hidden="true" /><h2>{CONFIG.siteName}</h2><p className="tag">{CONFIG.tagline}</p></div>
				<div className="card" style={{ display: "grid", gap: 10 }}>
					<h3>合言葉を入力してください</h3>
					<p style={{ color: "var(--muted)", fontSize: 14 }}>コミュニティの会員だけが使えるように、合言葉を設定しています。わからない場合は運営の方に聞いてください。</p>
					<div className="field"><label htmlFor="pass">合言葉</label><input type="password" id="pass" value={v} onChange={(e) => setV(e.target.value)} autoFocus /></div>
					{err && <p className="err">合言葉が違います。</p>}
					<button className="btn primary" style={{ justifySelf: "start" }}>入る</button>
				</div>
			</form>
		</div>
	);
}
