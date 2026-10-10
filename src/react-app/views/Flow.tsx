import { useEffect, useMemo, useRef, useState } from "react";
import { Empty, Pill } from "../components/ui";
import { CONFIG } from "../config";
import { flowStats, issuedUntil, whoLabel } from "../lib/domain";
import { useData } from "../lib/store";
import type { State } from "../lib/types";
import { addDays, dayLabel, downloadText, fmt, todayStr, WD } from "../lib/util";

export function FlowView() {
	const { d } = useData();
	const [range, setRange] = useState(30);
	const { list, byDay, total } = flowStats(d);
	const today = todayStr();
	const td = byDay[today] ?? { job: 0, item: 0, n: 0 };
	let w7 = 0;
	for (let i = 0; i < 7; i++) { const x = byDay[addDays(today, -i)]; if (x) w7 += x.job + x.item; }
	const issued = issuedUntil(today);
	const turn = issued ? total / issued : 0;
	const days = Object.keys(byDay).sort().reverse();
	let cum = total;
	const rows = days.map((ds) => { const x = byDay[ds]; const r = { ds, ...x, cum }; cum -= x.job + x.item; return r; });
	const recent = [...list].sort((a, b) => b.date.localeCompare(a.date) || b.at - a.at).slice(0, 15);
	const hist = [...CONFIG.stoneIssuance].sort((a, b) => b.date.localeCompare(a.date));

	return (
		<>
			<div className="view-head">
				<div><h2>石の流通</h2><p>仕事の依頼成立とフリマの交渉成立で動いた石を、日ごとに記録しています。会員全員が見られます。</p></div>
				<button className="btn" onClick={() => downloadCSV(d)}>CSVで保存</button>
			</div>
			<div className="kpis">
				<div className="kpi"><span className="k">発行枚数</span><span className="v">{fmt(issued)}<small>石</small></span><span className="s">設定ファイルの値</span></div>
				<div className="kpi"><span className="k">累計の流通量</span><span className="v">{fmt(total)}<small>石</small></span><span className="s">{list.length}件の成立</span></div>
				<div className="kpi"><span className="k">今日の流通量</span><span className="v">{fmt(td.job + td.item)}<small>石</small></span><span className="s">{td.n}件 ・ 直近7日 {fmt(w7)}石</span></div>
				<div className="kpi"><span className="k">回転率</span><span className="v">{turn.toFixed(2)}<small>回</small></span><span className="s">累計流通量 ÷ 発行枚数</span></div>
			</div>
			{list.length === 0 ? (
				<Empty title="まだ石の流通の記録がありません" steps={["相談で額を決める", "成立を記録", "会って石を手渡し"]}>
					相談チャットで、仕事は「依頼成立を記録」、フリマは出品者が「この相手と交渉成立」を押すと、その日の流通量として記録されます。
				</Empty>
			) : (
				<>
					<div className="chart-card">
						<div className="chart-head">
							<h3>日ごとの流通量（石）</h3>
							<div className="legend"><span><i style={{ background: "var(--s-job)" }} />仕事</span><span><i style={{ background: "var(--s-item)" }} />フリマ</span></div>
							<div className="seg" role="group">
								{([[14, "2週"], [30, "30日"], [90, "90日"]] as const).map(([n, l]) => <button key={n} aria-pressed={range === n} onClick={() => setRange(n)}>{l}</button>)}
							</div>
						</div>
						<FlowChart byDay={byDay} range={range} />
					</div>
					<div className="flow-grid">
						<section className="card">
							<h3>日別の記録</h3>
							<div className="tbl-wrap">
								<table className="ledger">
									<thead><tr><th>日付</th><th>仕事</th><th>フリマ</th><th>合計</th><th>件数</th><th>累計</th><th>発行枚数</th></tr></thead>
									<tbody>
										{rows.map((r) => (
											<tr key={r.ds}><td>{dayLabel(r.ds)}</td><td>{fmt(r.job)}</td><td>{fmt(r.item)}</td><td><b>{fmt(r.job + r.item)}</b></td><td>{r.n}</td><td>{fmt(r.cum)}</td><td>{fmt(issuedUntil(r.ds))}</td></tr>
										))}
									</tbody>
								</table>
							</div>
						</section>
						<section className="card">
							<h3>最近の成立</h3>
							<div className="tbl-wrap">
								<table className="ledger">
									<thead><tr><th>日付</th><th style={{ textAlign: "left" }}>内容</th><th>石</th></tr></thead>
									<tbody>
										{recent.map((e) => (
											<tr key={e.id}>
												<td>{e.date.slice(5).replace("-", "/")}</td>
												<td className="l"><Pill cls="tgt">{e.kind === "job" ? "仕事" : "フリマ"}</Pill> {e.title}<br /><span style={{ fontSize: 12, color: "var(--muted)" }}>{whoLabel(d, e.from)} → {whoLabel(d, e.to)}</span></td>
												<td><b>{fmt(e.amount)}</b></td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
							<h3 style={{ marginTop: 18 }}>発行の記録</h3>
							<div className="tbl-wrap">
								<table className="ledger"><tbody>{hist.map((x) => <tr key={x.date + x.amount}><td>{x.date}</td><td className="l">{x.note}</td><td><b>{fmt(x.amount)}</b></td></tr>)}</tbody></table>
							</div>
						</section>
					</div>
				</>
			)}
		</>
	);
}

type ByDay = Record<string, { job: number; item: number; n: number }>;

function FlowChart({ byDay, range }: { byDay: ByDay; range: number }) {
	const boxRef = useRef<HTMLDivElement>(null);
	const [w, setW] = useState(600);
	const [tip, setTip] = useState<{ i: number; x: number } | null>(null);
	useEffect(() => {
		const el = boxRef.current;
		if (!el) return;
		const ro = new ResizeObserver(() => setW(el.clientWidth || 600));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const data = useMemo(() => {
		const today = todayStr();
		const out = [];
		for (let i = range - 1; i >= 0; i--) {
			const ds = addDays(today, -i);
			out.push({ ds, job: byDay[ds]?.job ?? 0, item: byDay[ds]?.item ?? 0, n: byDay[ds]?.n ?? 0 });
		}
		return out;
	}, [byDay, range]);

	const H = 240, m = { l: 40, r: 8, t: 10, b: 24 };
	const iw = w - m.l - m.r, ih = H - m.t - m.b;
	const maxV = Math.max(1, ...data.map((x) => x.job + x.item));
	const raw = maxV / 4, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
	const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
	const top = Math.ceil(maxV / step) * step;
	const y = (v: number) => m.t + ih - (v / top) * ih;
	const bw = iw / range, barW = Math.max(2, Math.min(18, bw * 0.62)), rx = Math.min(3, barW / 3);
	const every = range <= 14 ? 2 : range <= 30 ? 5 : 14;
	const ticks: number[] = [];
	for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
	const hd = tip ? data[tip.i] : null;
	const hdDate = hd ? new Date(hd.ds + "T00:00") : null;

	return (
		<div style={{ position: "relative" }}>
			<div id="flow-chart" ref={boxRef} role="img" aria-label="日ごとの石の流通量">
				<svg viewBox={`0 0 ${w} ${H}`} width={w} height={H} onPointerLeave={() => setTip(null)}>
					{ticks.map((v) => (
						<g key={v}>
							<line x1={m.l} x2={w - m.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
							<text x={m.l - 6} y={y(v) + 4} textAnchor="end">{fmt(v)}</text>
						</g>
					))}
					{data.map((x, i) => {
						const cx = m.l + bw * i + bw / 2, bx = cx - barW / 2;
						const dt = new Date(x.ds + "T00:00");
						const itemH = x.item ? Math.max(1, (x.item / top) * ih - (x.job ? 2 : 0)) : 0;
						const base = x.job ? y(x.job) - 2 : y(0);
						return (
							<g key={x.ds}>
								{(range - 1 - i) % every === 0 && <text x={cx} y={H - 6} textAnchor="middle">{dt.getMonth() + 1}/{dt.getDate()}</text>}
								{x.job > 0 && <rect x={bx} y={y(x.job)} width={barW} height={Math.max(1, y(0) - y(x.job))} rx={rx} fill="var(--s-job)" />}
								{x.item > 0 && <rect x={bx} y={base - itemH} width={barW} height={itemH} rx={rx} fill="var(--s-item)" />}
								<rect x={m.l + bw * i} y={m.t} width={bw} height={ih} fill="transparent" data-i={i} onPointerEnter={() => setTip({ i, x: cx })} />
							</g>
						);
					})}
				</svg>
			</div>
			{hd && hdDate && tip && (
				<div className="tip" style={{ left: Math.max(8, Math.min(w - 190, tip.x - 90)), top: -8 }}>
					<b>{hdDate.getMonth() + 1}月{hdDate.getDate()}日（{WD[hdDate.getDay()]}）</b><br />
					仕事 {fmt(hd.job)}石 ・ フリマ {fmt(hd.item)}石<br />合計 {fmt(hd.job + hd.item)}石（{hd.n}件）
				</div>
			)}
		</div>
	);
}

function downloadCSV(d: State) {
	const rows: (string | number)[][] = [["日付", "種類", "内容", "支払った人", "受け取った人", "石"]];
	for (const e of Object.values(d.ledger).sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at)) {
		rows.push([e.date, e.kind === "job" ? "仕事" : "フリマ", e.title, whoLabel(d, e.from), whoLabel(d, e.to), e.amount]);
	}
	const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
	downloadText(`石の流通_${todayStr()}.csv`, csv, "text/csv");
}
