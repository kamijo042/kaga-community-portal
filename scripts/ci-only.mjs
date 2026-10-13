// 本番（Cloudflare）を触るコマンドは、Cloudflare の自動デプロイ（Workers Builds）の中でだけ動かす。
// 手元の Mac から本番へデプロイ・マイグレーションしないためのガード。
// Workers Builds は WORKERS_CI=1 を自動で設定する。
if (process.env.WORKERS_CI !== "1") {
	console.error(
		"\n✋ このコマンドは Cloudflare の自動デプロイ専用です（手元からの本番操作は禁止）。\n" +
		"   本番への反映は git に commit して push してください。\n" +
		"   シークレットや DB の操作は Cloudflare のダッシュボードから行います（README の「運用のルール」）。\n",
	);
	process.exit(1);
}
