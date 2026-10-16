/** 世帯（家族のまとまり）。世帯は管理者だけが作る */
export type Household = {
	id: string;
	name: string;
	district: string;
	note: string;
	createdAt: number;
	updatedAt: number;
};

/** 家族ひとり。ログインを持たない人（赤ちゃんなど）もいる */
export type Person = {
	id: string;
	householdId: string;
	name: string;
	relation: string;
	birthYear: string;
	/** プロフィール写真（R2 の写真ID）。なければ名前の1文字目の丸アイコン */
	avatar?: string | null;
	createdAt: number;
	updatedAt: number;
};

/** offer = できること（引き受けます）／ request = お願いしたいこと（依頼） */
export type JobType = "offer" | "request";
export type Job = {
	id: string;
	owner: string;
	type?: JobType;
	/** お願いの希望日（YYYY-MM-DD・任意） */
	wantDate?: string;
	title: string;
	desc: string;
	price: number;
	negotiable: boolean;
	active: boolean;
	createdAt: number;
	updatedAt: number;
};

export type ItemStatus = "open" | "nego" | "done";

/** フリマの払い方 */
export type PayMode = "stone" | "yen" | "either" | "both";
export type Item = {
	id: string;
	owner: string;
	name: string;
	desc: string;
	priceStone: number | null;
	priceYen: number | null;
	/** 払い方：石だけ／円だけ／石か円のどちらでも／石と円を合わせて（古いデータは null。値段の入れ方から決める） */
	payMode?: PayMode | null;
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
	/** 仕事の提供者・出品者・投稿者（人のID） */
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

export type PostCat = "farm" | "edu" | "bousai" | "event";

export type EventInfo = {
	date: string;
	start: string;
	end: string;
	place: string;
	capacity: number | null;
	bring: string;
};

/** 参加表明（世帯ごと）。by は申し込んだ人（サーバーが記録） */
export type Rsvp = { s: "go" | "maybe"; n: number; at: number; by?: string | null };

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
	/** 参加を受け付けるか（未設定なら地域イベントだけ受け付け） */
	rsvpOn?: boolean;
	/** 投稿者が受付を締め切った */
	rsvpClosed?: boolean;
	/** 会員以外も参加できる公開URLの鍵（投稿者にだけ届く） */
	publicToken?: string | null;
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
	/** 石を払った人 */
	from: string;
	/** 石を受け取った人 */
	to: string;
	amount: number;
	title: string;
	by: string;
};

/** 会員以外の参加登録（公開URLから。名前・人数・ひとことだけ） */
export type Guest = { id: string; postId: string; name: string; n: number; note: string; at: number };

export type State = {
	households: Record<string, Household>;
	people: Record<string, Person>;
	jobs: Record<string, Job>;
	items: Record<string, Item>;
	threads: Record<string, Thread>;
	messages: Record<string, Message[]>;
	reads: Record<string, Record<string, number>>;
	posts: Record<string, Post>;
	seen: Record<string, number>;
	ledger: Record<string, LedgerEntry>;
	/** 会員以外の参加登録（公開URLから） */
	guests: Record<string, Guest>;
};

export const COLS = ["households", "people", "jobs", "items", "threads", "messages", "reads", "posts", "seen", "ledger", "guests"] as const;

export const emptyState = (): State => ({
	households: {}, people: {}, jobs: {}, items: {}, threads: {}, messages: {}, reads: {}, posts: {}, seen: {}, ledger: {}, guests: {},
});
