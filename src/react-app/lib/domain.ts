import { CONFIG } from "../config";
import type { Item, LedgerEntry, Post, PostCat, State, Thread, ThreadKind } from "./types";
import { WD } from "./util";

// ---- 世帯 ----
export function hhLabel(d: State, id: string | null | undefined) {
	const h = id ? d.households[id] : undefined;
	return h ? h.name || h.headName + " 家" : "退会した世帯";
}
export const familySize = (d: State, id: string) => 1 + (d.households[id]?.members?.length ?? 0);

// ---- フリマの値段 ----
export function itemStone(i: Item): number | null {
	// 旧データ（price のみ）にも対応
	return i.priceStone !== undefined ? i.priceStone : (i.price ?? null);
}

// ---- 相談 ----
export const KIND_LABEL: Record<ThreadKind, string> = { job: "仕事", item: "フリマ", info: "情報" };
export const threadId = (kind: ThreadKind, refId: string, requester: string) => `${kind}_${refId}_${requester}`;
export function myThreads(d: State, me: string) {
	return Object.values(d.threads)
		.filter((t) => t.owner === me || t.other === me)
		.sort((a, b) => (b.lastAt || b.createdAt) - (a.lastAt || a.createdAt));
}
export function isUnread(d: State, me: string, t: Thread) {
	return !!t.lastAt && t.lastBy !== me && (d.reads[me]?.[t.id] ?? 0) < t.lastAt;
}
export const unreadCount = (d: State, me: string) => myThreads(d, me).filter((t) => isUnread(d, me, t)).length;
export const threadsFor = (d: State, kind: ThreadKind, refId: string) =>
	Object.values(d.threads).filter((t) => t.kind === kind && t.refId === refId);
export const counterpart = (t: Thread, me: string) => (t.owner === me ? t.other : t.owner);
export function roleOf(t: Thread, me: string) {
	if (t.kind === "info") return t.owner === me ? "あなたの投稿への質問" : "投稿への質問";
	if (t.kind === "job") return t.owner === me ? "あなたが引き受ける側" : "あなたが頼む側";
	return t.owner === me ? "あなたが出品者" : "あなたが購入希望";
}

// ---- 情報 ----
export const CATS: Record<PostCat, { label: string; cls: string }> = {
	edu: { label: "教育", cls: "edu" },
	farm: { label: "農業", cls: "farm" },
	event: { label: "地域イベント", cls: "evt" },
};
export const SUBKINDS: Record<PostCat, string[]> = {
	edu: ["学校・園", "習い事・教室", "学び合い", "子育て", "その他"],
	farm: ["情報共有", "手伝い募集", "道具の貸し借り", "おすそわけ・直売", "獣害・困りごと"],
	event: ["お祭り・行事", "清掃・共同作業", "交流会", "体験・講座", "その他"],
};
export const AGES = ["未就学", "小学生", "中学生", "高校生", "大人", "全員"];

export function ageBucket(y: string | undefined) {
	if (!y) return null;
	const a = new Date().getFullYear() - Number(y);
	if (isNaN(a) || a < 0) return null;
	return a < 6 ? "未就学" : a < 12 ? "小学生" : a < 15 ? "中学生" : a < 18 ? "高校生" : "大人";
}
export function myBuckets(d: State, me: string) {
	const h = d.households[me];
	const s = new Set(["大人"]);
	if (h) [h.headBirth, ...(h.members ?? []).map((m) => m.birthYear)].forEach((y) => { const b = ageBucket(y); if (b) s.add(b); });
	return s;
}
export function forMyKids(d: State, me: string, p: Post) {
	const mb = myBuckets(d, me);
	return (p.targets ?? []).some((x) => x !== "全員" && x !== "大人" && mb.has(x));
}
export function matchesFamily(d: State, me: string, p: Post) {
	const t = p.targets ?? [];
	if (!t.length || t.includes("全員")) return true;
	const mb = myBuckets(d, me);
	return t.some((x) => mb.has(x));
}
export const evStart = (p: Post) => (p.event?.date ? new Date(p.event.date + "T" + (p.event.start || "00:00")) : null);
export function evPast(p: Post) {
	if (p.cat !== "event" || !p.event?.date) return false;
	return new Date(p.event.date + "T" + (p.event.end || "23:59")) < new Date();
}
export function evDateStr(p: Post) {
	const d = evStart(p);
	if (!d || !p.event) return "";
	return `${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）${p.event.start ? " " + p.event.start : ""}${p.event.end ? "〜" + p.event.end : ""}`;
}
export function goCount(p: Post) {
	const r = Object.values(p.rsvps ?? {});
	const go = r.filter((x) => x.s === "go");
	return { hh: go.length, people: go.reduce((a, x) => a + (Number(x.n) || 1), 0), maybe: r.filter((x) => x.s === "maybe").length };
}
export function newPostCount(d: State, me: string) {
	const seen = d.seen[me] ?? 0;
	return Object.values(d.posts).filter((p) => p.owner !== me && p.createdAt > seen).length;
}

// ---- 石の流通 ----
export const issuedUntil = (ds?: string) =>
	CONFIG.stoneIssuance.filter((x) => !ds || x.date <= ds).reduce((a, x) => a + (Number(x.amount) || 0), 0);

export function flowStats(d: State) {
	const list: LedgerEntry[] = Object.values(d.ledger);
	const byDay: Record<string, { job: number; item: number; n: number }> = {};
	for (const e of list) {
		const x = (byDay[e.date] ??= { job: 0, item: 0, n: 0 });
		x[e.kind] += e.amount;
		x.n++;
	}
	return { list, byDay, total: list.reduce((a, e) => a + e.amount, 0) };
}
