-- 世帯アカウント（ログイン）と招待コード
-- パスワードは PBKDF2-SHA256 でハッシュ化して保存（平文は保存しない）

CREATE TABLE accounts (
	household_id  TEXT PRIMARY KEY,               -- households.id（1世帯1アカウント）
	login_id      TEXT NOT NULL UNIQUE COLLATE NOCASE,
	password_hash TEXT NOT NULL,                  -- pbkdf2-sha256$<回数>$<salt b64>$<hash b64>
	role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
	disabled      INTEGER NOT NULL DEFAULT 0,     -- 1 = 利用停止
	session_epoch INTEGER NOT NULL DEFAULT 0,     -- 増やすと既存のログインがすべて無効になる
	last_login_at INTEGER,
	created_at    INTEGER NOT NULL,
	updated_at    INTEGER NOT NULL
);

-- 招待コード（新規発行・パスワード再設定の両方に使う）。コードはハッシュで保存
CREATE TABLE invites (
	code_hash    TEXT PRIMARY KEY,
	household_id TEXT NOT NULL,
	purpose      TEXT NOT NULL CHECK (purpose IN ('new','reset')),
	created_by   TEXT NOT NULL,
	created_at   INTEGER NOT NULL,
	expires_at   INTEGER NOT NULL,
	used_at      INTEGER
);
CREATE INDEX idx_invites_household ON invites(household_id);
