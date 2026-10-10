export type Member = { name: string; relation: string; birthYear: string };

export type Household = {
	id: string;
	name: string;
	headName: string;
	headBirth: string;
	district: string;
	note: string;
	members: Member[];
	createdAt: number;
	updatedAt: number;
};

export type Job = {
	id: string;
	owner: string;
	title: string;
	desc: string;
	price: number;
	negotiable: boolean;
	active: boolean;
	createdAt: number;
	updatedAt: number;
};

export type ItemStatus = "open" | "nego" | "done";

export type Item = {
	id: string;
	owner: string;
	name: string;
	desc: string;
	priceStone: number | null;
	priceYen: number | null;
	/** 旧データ互換（石の値段） */
	price?: number;
	photos: string[];
	status: ItemStatus;
	buyer?: string;
	doneAt?: number;
	createdAt: number;
	updatedAt: number;
};

export type ThreadKind = "job" | "item" | "info";

export type Thread = {
	id: string;
	kind: ThreadKind;
	refId: string;
	/** 仕事の提供者・出品者・投稿者 */
	owner: string;
	/** 相談を始めた側（依頼者・購入希望者・質問者） */
	other: string;
	title: string;
	createdAt: number;
	lastAt: number;
	lastBy: string | null;
	lastText: string;
};

export type Message = { id: string; from: string; t: number; text: string; sys?: boolean };

export type PostCat = "edu" | "farm" | "event";

export type EventInfo = {
	date: string;
	start: string;
	end: string;
	place: string;
	capacity: number | null;
	bring: string;
};

export type Rsvp = { s: "go" | "maybe"; n: number; at: number };

export type Post = {
	id: string;
	owner: string;
	cat: PostCat;
	kind: string;
	title: string;
	body: string;
	link: string;
	targets: string[];
	event: EventInfo | null;
	photo: string | null;
	rsvps: Record<string, Rsvp>;
	createdAt: number;
	updatedAt: number;
};

export type LedgerEntry = {
	id: string;
	date: string;
	at: number;
	kind: "job" | "item";
	refId: string;
	tid: string;
	/** 石を払った世帯 */
	from: string;
	/** 石を受け取った世帯 */
	to: string;
	amount: number;
	title: string;
	by: string;
};

export type State = {
	households: Record<string, Household>;
	jobs: Record<string, Job>;
	items: Record<string, Item>;
	threads: Record<string, Thread>;
	messages: Record<string, Message[]>;
	reads: Record<string, Record<string, number>>;
	posts: Record<string, Post>;
	seen: Record<string, number>;
	ledger: Record<string, LedgerEntry>;
};

export const COLS = ["households", "jobs", "items", "threads", "messages", "reads", "posts", "seen", "ledger"] as const;

export const emptyState = (): State => ({
	households: {}, jobs: {}, items: {}, threads: {}, messages: {}, reads: {}, posts: {}, seen: {}, ledger: {},
});
