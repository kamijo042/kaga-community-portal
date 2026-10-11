/** サーバーAPIの呼び出し（ログイン状態は HttpOnly Cookie で送られる） */

export class ApiError extends Error {
	constructor(public status: number, message: string) { super(message); }
}

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: (() => void) | null) => { onUnauthorized = fn; };

export async function api(path: string, init: RequestInit = {}) {
	const r = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store" });
	if (r.status === 401 && !path.startsWith("/api/auth/")) onUnauthorized?.();
	return r;
}

export async function apiJson<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
	const r = await api(path, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
	const data = (await r.json().catch(() => ({}))) as T & { error?: string };
	if (!r.ok) throw new ApiError(r.status, data.error || "通信に失敗しました。時間をおいて試してください。");
	return data;
}

// ---------- ログイン ----------
export type User = { userId: string; householdId: string; role: "member" | "admin"; loginId: string };

export const authApi = {
	me: () => apiJson<{ user: User | null; needsSetup?: boolean }>("/api/auth/me"),
	login: (loginId: string, password: string) => apiJson<{ ok: true }>("/api/auth/login", { loginId, password }),
	logout: () => apiJson<{ ok: true }>("/api/auth/logout", {}),
	setup: (setupCode: string, loginId: string, password: string, person: { name: string; birthYear?: string }, household: { name?: string; district?: string }) =>
		apiJson<{ ok: true }>("/api/auth/setup", { setupCode, loginId, password, person, household }),
	invite: (code: string) =>
		apiJson<{ purpose: "new" | "reset"; loginId: string | null; person: { name: string; relation: string } | null; household: { name: string; district: string } | null }>("/api/auth/invite", { code }),
	accept: (code: string, password: string, loginId?: string) => apiJson<{ ok: true }>("/api/auth/accept", { code, password, loginId }),
	changePassword: (current: string, next: string) => apiJson<{ ok: true }>("/api/auth/password", { current, next }),
};

// ---------- 家族のログイン・管理者 ----------
export type AccountRow = {
	userId: string; householdId: string; name: string; relation: string; householdName: string; district: string; invitedBy?: string | null;
	loginId: string | null; role: "member" | "admin" | null; disabled: boolean; lastLoginAt: number | null; inviteExpiresAt: number | null;
};
type Invite = { code: string; expiresAt: number; purpose: "new" | "reset" };

export const familyApi = {
	list: () => apiJson<{ accounts: AccountRow[] }>("/api/family/accounts"),
	invite: (userId: string) => apiJson<Invite>("/api/family/invite", { userId }),
};

export const adminApi = {
	list: () => apiJson<{ accounts: AccountRow[] }>("/api/admin/accounts"),
	createHousehold: (h: { name?: string; headName: string; district?: string; force?: boolean }) =>
		apiJson<Invite & { householdId: string; userId: string; name: string }>("/api/admin/households", h),
	invite: (userId: string) => apiJson<Invite>("/api/admin/invite", { userId }),
	update: (userId: string, patch: { disabled?: boolean; role?: "member" | "admin" }) =>
		apiJson<{ ok: true }>("/api/admin/account", { userId, ...patch }),
	/** confirm なし：消える件数だけ返す／confirm: true：削除する */
	deleteHousehold: (householdId: string, confirm = false) =>
		apiJson<HouseholdFootprint & { name: string; ok?: true }>("/api/admin/household/delete", { householdId, confirm }),
};
/** 会員による新しい世帯の招待（1人あたり上限あり。管理者は上限なし＝limit が null） */
export type MyHouseholdInvite = { householdId: string; name: string; district: string; headId: string | null; headName: string; registered: boolean; inviteExpiresAt: number | null; createdAt: number };
export const invitesApi = {
	list: () => apiJson<{ list: MyHouseholdInvite[]; limit: number | null; remaining: number | null }>("/api/invites/households"),
	create: (h: { name?: string; headName: string; district?: string; force?: boolean }) =>
		apiJson<Invite & { householdId: string; userId: string; name: string }>("/api/invites/households", h),
	reissue: (householdId: string) => apiJson<Invite>("/api/invites/reissue", { householdId }),
};
export type HouseholdFootprint = { people: number; logins: number; jobs: number; items: number; posts: number; threads: number; ledger: number };
