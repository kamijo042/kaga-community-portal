-- ログイン試行などの回数。1文で増やすので、同時に何回送られても上限を超えられる
CREATE TABLE IF NOT EXISTS rate_limits (
	key      TEXT PRIMARY KEY,
	n        INTEGER NOT NULL,
	reset_at INTEGER NOT NULL
);

-- 初期設定は1回だけ。同時に送られても管理者は1人しかできない
CREATE TABLE IF NOT EXISTS app_lock (
	id         TEXT PRIMARY KEY,
	created_at INTEGER NOT NULL
);

-- すでにアカウントがある環境では、初期設定をやり直せないようにする。
-- 集計関数は行が0件でも1行返すので、ここでは LIMIT で「無ければ何も入れない」
INSERT INTO app_lock (id, created_at)
	SELECT 'setup', created_at FROM accounts
	WHERE NOT EXISTS (SELECT 1 FROM app_lock WHERE id = 'setup')
	ORDER BY created_at
	LIMIT 1;
