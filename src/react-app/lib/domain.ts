import { CONFIG } from "../config";
import type { Item, LedgerEntry, Post, PostCat, State, Thread, ThreadKind } from "./types";
import { WD } from "./util";

// ---- 世帯と人 ----
/** 世帯名（世帯ID） */
export function hhLabel(d: State, householdId: string | null | undefined) {
	const h = householdId ? d.households[householdId] : undefined;
	return h ? h.name || "世帯" : "退会した世帯";
}
/** 人の名前（人ID） */
export const nameOf = (d: State, userId: string | null | undefined) => (userId && d.people[userId]?.name) || "退会した人";
/** 人が属する世帯の名前（人ID） */
export const homeOf = (d: State, userId: string | null | undefined) => hhLabel(d, userId ? d.people[userId]?.householdId : null);
/** 「山田 花子（山田家）」 */
export const whoLabel = (d: State, userId: string | null | undefined) => `${nameOf(d, userId)}（${homeOf(d, userId)}）`;
export const householdOf = (d: State, userId: string | null | undefined) => (userId ? d.people[userId]?.householdId ?? null : null);
const RELATION_ORDER = ["世帯主", "配偶者", "父", "母", "祖父", "祖母", "子", "孫", "兄弟姉妹", "その他"];
export function familyOf(d: State, householdId: string | null | undefined) {
	return Object.values(d.people)
		.filter((p) => p.householdId === householdId)
		.sort((a, b) => (RELATION_ORDER.indexOf(a.relation) + 100) % 100 - (RELATION_ORDER.indexOf(b.relation) + 100) % 100 || a.createdAt - b.createdAt);
}
export const familySize = (d: State, householdId: string | null | undefined) => familyOf(d, householdId).length;

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
/** 仕事の相談で、投稿した人（thread.owner）が頼む側か。お願い（依頼）の投稿なら true */
export const ownerRequests = (d: State, t: Thread) => t.kind === "job" && d.jobs[t.refId]?.type === "request";
export function roleOf(t: Thread, me: string, d?: State) {
	if (t.kind === "info") return t.owner === me ? "あなたの投稿への質問" : "投稿への質問";
	if (t.kind === "job") {
		const ownerIsRequester = !!d && ownerRequests(d, t);
		return (t.owner === me) === ownerIsRequester ? "あなたが頼む側" : "あなたが引き受ける側";
	}
	return t.owner === me ? "あなたが出品者" : "あなたが購入希望";
}

// ---- 情報 ----
export const CATS: Record<PostCat, { label: string; cls: string }> = {
	farm: { label: "農業", cls: "farm" },
	edu: { label: "教育", cls: "edu" },
	bousai: { label: "防災", cls: "bousai" },
	event: { label: "地域イベント", cls: "evt" },
};
export const SUBKINDS: Record<PostCat, string[]> = {
	farm: ["情報共有", "手伝い募集", "道具の貸し借り", "おすそわけ・直売", "獣害・困りごと"],
	edu: ["学校・園", "習い事・教室", "学び合い", "子育て", "その他"],
	bousai: ["避難・防災情報", "防災訓練", "知識講座", "備え・備蓄", "災害時の助け合い", "その他"],
	event: ["お祭り・行事", "清掃・共同作業", "交流会", "体験・講座", "クラウドファンディング", "議会", "その他"],
};
export const AGES = ["未就学", "小学生", "中学生", "高校生", "大人", "全員"];

export function ageBucket(y: string | undefined) {
	if (!y) return null;
	const a = new Date().getFullYear() - Number(y);
	if (isNaN(a) || a < 0) return null;
	return a < 6 ? "未就学" : a < 12 ? "小学生" : a < 15 ? "中学生" : a < 18 ? "高校生" : "大人";
}
export function myBuckets(d: State, me: string) {
	const s = new Set(["大人"]);
	for (const p of familyOf(d, householdOf(d, me))) { const b = ageBucket(p.birthYear); if (b) s.add(b); }
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
	if (!p.event?.date) return false;
	return new Date(p.event.date + "T" + (p.event.end || "23:59")) < new Date();
}
/** クラウドファンディングは日付を「締切日」として扱う（時刻なし） */
export const isFunding = (p: Pick<Post, "kind">) => p.kind === "クラウドファンディング";
export function evDateStr(p: Post, fundingSuffix = true) {
	const d = evStart(p);
	if (!d || !p.event) return "";
	const day = `${d.getMonth() + 1}月${d.getDate()}日（${WD[d.getDay()]}）`;
	if (isFunding(p)) return fundingSuffix ? day + "締切" : day;
	return `${day}${p.event.start ? " " + p.event.start : ""}${p.event.end ? "〜" + p.event.end : ""}`;
}
/** イベントの並び順：これからの日付順 → 日付なし（新しい順）→ 終了（新しい順） */
export function evOrder(a: Post, b: Post) {
	const rank = (p: Post) => (evPast(p) ? 2 : evStart(p) ? 0 : 1);
	const ra = rank(a), rb = rank(b);
	if (ra !== rb) return ra - rb;
	if (ra === 0) return +evStart(a)! - +evStart(b)!;
	if (ra === 2) return +evStart(b)! - +evStart(a)!;
	return b.createdAt - a.createdAt;
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
