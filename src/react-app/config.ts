/* ============================================================
   設定ファイル — 石の発行枚数などはここで管理します
   変更したら git にコミット＆プッシュすると、Cloudflare に反映されます
   ============================================================ */

export type Issuance = { date: string; amount: number; note?: string };

export const CONFIG = {
	/** コミュニティ名 */
	siteName: "加賀移住者コミュニティ",
	/** サブタイトル */
	tagline: "地域の貢献と加賀市の未来",
	/** 通貨の名前 */
	currencyName: "石",
	/**
	 * 石の発行の記録。追加で発行したら行を足してください（日付は YYYY-MM-DD）。
	 * 発行枚数 = その日までの amount の合計
	 */
	stoneIssuance: [
		{ date: "2026-04-01", amount: 10000, note: "初回発行" },
		// { date: "2026-10-01", amount: 5000, note: "追加発行" },
	] as Issuance[],
};
