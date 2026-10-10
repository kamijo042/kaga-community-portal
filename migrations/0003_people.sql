-- 家族ひとりずつを「人」として登録し、ログインは人ごとにする
-- ・世帯 = 家族のまとまり（世帯名・地区・メモ）。世帯は管理者だけが作れる
-- ・人   = 世帯に属する家族。ログインを持たない人（赤ちゃんなど）も登録できる
-- ・仕事・出品・投稿・相談・石の流通は「人」の名義
-- ・イベントの参加表明は「世帯」単位のまま

CREATE TABLE people (
	id           TEXT PRIMARY KEY,
	household_id TEXT NOT NULL,                -- households.id（後から別の世帯へは移せない）
	name         TEXT NOT NULL,
	relation     TEXT NOT NULL DEFAULT '',     -- 世帯主・配偶者・子 など
	birth_year   TEXT NOT NULL DEFAULT '',
	created_at   INTEGER NOT NULL,
	updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_people_updated ON people(updated_at);
CREATE INDEX idx_people_household ON people(household_id);

-- これまでの世帯主を「人」に移す。
-- 人のIDを世帯IDと同じにして、これまでの仕事・出品・相談などの持ち主をそのまま引き継ぐ
INSERT INTO people (id, household_id, name, relation, birth_year, created_at, updated_at)
	SELECT id, id, head_name, '世帯主', head_birth, created_at, updated_at FROM households WHERE head_name <> '';

-- これまでの家族構成（JSON）も「人」に移す
INSERT INTO people (id, household_id, name, relation, birth_year, created_at, updated_at)
	SELECT 'u_' || h.id || '_' || j.key, h.id, json_extract(j.value, '$.name'),
	       coalesce(json_extract(j.value, '$.relation'), ''), coalesce(json_extract(j.value, '$.birthYear'), ''), h.created_at, h.updated_at
	FROM households h, json_each(h.members) j
	WHERE coalesce(json_extract(j.value, '$.name'), '') <> '';

-- アカウントを「人」単位に作り直す（これまでのアカウントは世帯主のものとして引き継ぐ）
CREATE TABLE accounts_v2 (
	user_id       TEXT PRIMARY KEY,               -- people.id
	household_id  TEXT NOT NULL,
	login_id      TEXT NOT NULL UNIQUE COLLATE NOCASE,
	password_hash TEXT NOT NULL,
	role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
	disabled      INTEGER NOT NULL DEFAULT 0,
	session_epoch INTEGER NOT NULL DEFAULT 0,
	last_login_at INTEGER,
	created_at    INTEGER NOT NULL,
	updated_at    INTEGER NOT NULL
);
INSERT INTO accounts_v2 (user_id, household_id, login_id, password_hash, role, disabled, session_epoch, last_login_at, created_at, updated_at)
	SELECT household_id, household_id, login_id, password_hash, role, disabled, session_epoch, last_login_at, created_at, updated_at FROM accounts;
DROP TABLE accounts;
ALTER TABLE accounts_v2 RENAME TO accounts;
CREATE INDEX idx_accounts_household ON accounts(household_id);

-- 招待コードも「人」宛てにする（未使用のコードは引き継がない）
DROP TABLE invites;
CREATE TABLE invites (
	code_hash    TEXT PRIMARY KEY,
	user_id      TEXT NOT NULL,                  -- ログインを作る（再設定する）人
	household_id TEXT NOT NULL,
	purpose      TEXT NOT NULL CHECK (purpose IN ('new','reset')),
	created_by   TEXT NOT NULL,
	created_at   INTEGER NOT NULL,
	expires_at   INTEGER NOT NULL,
	used_at      INTEGER
);
CREATE INDEX idx_invites_user ON invites(user_id);

-- 既読は人ごと
ALTER TABLE reads RENAME COLUMN household_id TO user_id;
ALTER TABLE seen RENAME COLUMN household_id TO user_id;
