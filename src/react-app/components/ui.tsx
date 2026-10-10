import { useEffect, useState, type ReactNode } from "react";
import { CATS, homeOf, itemStone, nameOf } from "../lib/domain";
import { useData } from "../lib/store";
import type { Item, ItemStatus, PostCat } from "../lib/types";
import { colorOf, fmt } from "../lib/util";

export function Stone({ n }: { n: number | null | undefined }) {
	return (
		<span className="stone">
			<span className="n">{fmt(n)}</span>
			<span className="u">石</span>
		</span>
	);
}

export function Yen({ n }: { n: number }) {
	return (
		<span className="yen">
			<span className="n">{fmt(n)}</span>
			<span className="u">円</span>
		</span>
	);
}

export function Prices({ item }: { item: Item }) {
	const st = itemStone(item);
	const yen = item.priceYen;
	return (
		<span className="prices">
			{st !== null && st !== undefined && <Stone n={st} />}
			{st !== null && st !== undefined && yen !== null && yen !== undefined && <span className="sep">／</span>}
			{yen !== null && yen !== undefined && <Yen n={yen} />}
		</span>
	);
}

export function Pill({ cls, children }: { cls: string; children: ReactNode }) {
	return <span className={`pill ${cls}`}>{children}</span>;
}

const STATUS: Record<ItemStatus, [string, string]> = { open: ["出品中", "open"], nego: ["交渉中", "nego"], done: ["交渉成立", "done"] };
export const StatusPill = ({ s }: { s: ItemStatus }) => <Pill cls={STATUS[s][1]}>{STATUS[s][0]}</Pill>;
export const NegPill = ({ yes }: { yes: boolean }) => (yes ? <Pill cls="neg-yes">交渉あり</Pill> : <Pill cls="neg-no">交渉なし</Pill>);
export const CatPill = ({ cat }: { cat: PostCat }) => <Pill cls={CATS[cat].cls}>{CATS[cat].label}</Pill>;

/** 丸いアイコン。人IDなら下の名前の1文字目、世帯IDなら世帯名の1文字目 */
export function Dot({ id }: { id: string }) {
	const { d } = useData();
	const p = d.people[id];
	const parts = (p?.name ?? "").trim().split(/[\s　]+/);
	const ch = (p ? parts[parts.length - 1] : d.households[id]?.name || "?").slice(0, 1);
	return <span className="dot" style={{ background: colorOf(id) }} aria-hidden="true">{ch}</span>;
}

/** 人の表示：アイコン・名前・世帯 */
export function Owner({ id, extra }: { id: string; extra?: ReactNode }) {
	const { d } = useData();
	return (
		<span className="owner">
			<Dot id={id} />
			<b>{nameOf(d, id)}</b>
			<span className="owner-home">{homeOf(d, id)}</span>
			{extra}
		</span>
	);
}

export function Empty({ title, children, steps, action }: { title: string; children?: ReactNode; steps?: string[]; action?: ReactNode }) {
	return (
		<div className="empty">
			<h3>{title}</h3>
			{children && <p>{children}</p>}
			{steps && (
				<div className="flow">
					{steps.map((s) => <span key={s}>{s}</span>)}
				</div>
			)}
			{action}
		</div>
	);
}

/** 保存済みの写真（R2 の id）を表示 */
export function Photo({ pid, alt = "", className }: { pid: string; alt?: string; className?: string }) {
	const { photos } = useData();
	const [failed, setFailed] = useState(false);
	if (failed) return <div className="noimg">画像なし</div>;
	return <img src={photos.url(pid)} alt={alt} className={className} loading="lazy" onError={() => setFailed(true)} />;
}

export function Modal({ title, children, footer, onClose }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void }) {
	useEffect(() => {
		const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
		addEventListener("keydown", k);
		return () => removeEventListener("keydown", k);
	}, [onClose]);
	return (
		<div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
			<div className="modal" role="dialog" aria-modal="true" aria-label={title}>
				<div className="modal-head">
					<h2>{title}</h2>
					<button className="x" onClick={onClose} aria-label="閉じる">×</button>
				</div>
				<div className="modal-body">{children}</div>
				{footer && <div className="modal-foot">{footer}</div>}
			</div>
		</div>
	);
}

/** 2回押すと実行される削除ボタン（確認ダイアログの代わり） */
export function ConfirmButton({ onConfirm, children, className = "btn danger" }: { onConfirm: () => void; children: ReactNode; className?: string }) {
	const [armed, setArmed] = useState(false);
	return (
		<button type="button" className={className} style={{ marginRight: "auto" }} onClick={() => (armed ? onConfirm() : setArmed(true))}>
			{armed ? "もう一度押すと削除" : children}
		</button>
	);
}
