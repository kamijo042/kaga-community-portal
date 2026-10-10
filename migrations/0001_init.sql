-- 加賀移住者コミュニティ 初期スキーマ
-- 時刻はすべて UNIX ミリ秒。updated_at はサーバーが付ける（差分同期に使う）
-- JSON 列は TEXT に JSON 文字列で保存

-- 世帯（会員の単位）
CREATE TABLE households (
	id          TEXT PRIMARY KEY,
	name        TEXT NOT NULL,
	head_name   TEXT NOT NULL,
	head_birth  TEXT NOT NULL DEFAULT '',
	district    TEXT NOT NULL DEFAULT '',
	note        TEXT NOT NULL DEFAULT '',
	members     TEXT NOT NULL DEFAULT '[]',   -- JSON: [{name, relation, birthYear}]
	created_at  INTEGER NOT NULL,
	updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_households_updated ON households(updated_at);

-- 仕事（提供者が登録）
CREATE TABLE jobs (
	id          TEXT PRIMARY KEY,
	owner       TEXT NOT NULL,              -- households.id
	title       TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	price       INTEGER NOT NULL DEFAULT 0, -- 石
	negotiable  INTEGER NOT NULL DEFAULT 1, -- 0/1
	active      INTEGER NOT NULL DEFAULT 1, -- 0/1 受付中
	created_at  INTEGER NOT NULL,
	updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_jobs_updated ON jobs(updated_at);
CREATE INDEX idx_jobs_owner ON jobs(owner);

-- フリマの出品
CREATE TABLE items (
	id          TEXT PRIMARY KEY,
	owner       TEXT NOT NULL,
	name        TEXT NOT NULL,
	description TEXT NOT NULL DEFAULT '',
	price_stone INTEGER,                    -- 石（NULL 可）
	price_yen   INTEGER,                    -- 円（NULL 可）
	photos      TEXT NOT NULL DEFAULT '[]', -- JSON: R2 の写真ID配列
	status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','nego','done')),
	buyer       TEXT,                       -- 成立相手 households.id
	done_at     INTEGER,
	created_at  INTEGER NOT NULL,
	updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_items_updated ON items(updated_at);
CREATE INDEX idx_items_owner ON items(owner);

-- 情報（教育・農業・地域イベント）
CREATE TABLE posts (
	id          TEXT PRIMARY KEY,
	owner       TEXT NOT NULL,
	cat         TEXT NOT NULL CHECK (cat IN ('edu','farm','event')),
	kind        TEXT NOT NULL DEFAULT '',
	title       TEXT NOT NULL,
	body        TEXT NOT NULL DEFAULT '',
	link        TEXT NOT NULL DEFAULT '',
	targets     TEXT NOT NULL DEFAULT '[]', -- JSON: ["小学生", ...]
	photo       TEXT,                       -- R2 の写真ID
	ev_date     TEXT,                       -- YYYY-MM-DD（イベントのみ）
	ev_start    TEXT,
	ev_end      TEXT,
	ev_place    TEXT,
	ev_capacity INTEGER,
	ev_bring    TEXT,
	created_at  INTEGER NOT NULL,
	updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_posts_updated ON posts(updated_at);
CREATE INDEX idx_posts_event ON posts(cat, ev_date);

-- イベントの参加表明（世帯ごとに1行）
CREATE TABLE rsvps (
	post_id      TEXT NOT NULL,
	household_id TEXT NOT NULL,
	status       TEXT NOT NULL CHECK (status IN ('go','maybe')),
	people       INTEGER NOT NULL DEFAULT 1,
	updated_at   INTEGER NOT NULL,
	PRIMARY KEY (post_id, household_id)
);
CREATE INDEX idx_rsvps_updated ON rsvps(updated_at);

-- 相談スレッド（仕事・フリマ・情報）
CREATE TABLE threads (
	id          TEXT PRIMARY KEY,
	kind        TEXT NOT NULL CHECK (kind IN ('job','item','info')),
	ref_id      TEXT NOT NULL,
	owner       TEXT NOT NULL,              -- 提供者・出品者・投稿者
	other       TEXT NOT NULL,              -- 相談を始めた側
	title       TEXT NOT NULL,
	last_at     INTEGER NOT NULL DEFAULT 0,
	last_by     TEXT,
	last_text   TEXT NOT NULL DEFAULT '',
	created_at  INTEGER NOT NULL,
	updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_threads_updated ON threads(updated_at);
CREATE INDEX idx_threads_owner ON threads(owner);
CREATE INDEX idx_threads_other ON threads(other);

-- チャットのメッセージ（1メッセージ1行）
CREATE TABLE messages (
	id          TEXT PRIMARY KEY,
	thread_id   TEXT NOT NULL,
	sender      TEXT NOT NULL,              -- households.id
	text        TEXT NOT NULL,
	sys         INTEGER NOT NULL DEFAULT 0, -- 1 = お知らせ
	sent_at     INTEGER NOT NULL,           -- 送信者の時刻（表示用）
	updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_messages_updated ON messages(updated_at);
CREATE INDEX idx_messages_thread ON messages(thread_id, sent_at);

-- 既読（世帯 × スレッド）
CREATE TABLE reads (
	household_id TEXT NOT NULL,
	thread_id    TEXT NOT NULL,
	read_at      INTEGER NOT NULL,
	updated_at   INTEGER NOT NULL,
	PRIMARY KEY (household_id, thread_id)
);
CREATE INDEX idx_reads_updated ON reads(updated_at);

-- 情報タブを最後に見た時刻（新着表示用）
CREATE TABLE seen (
	household_id TEXT PRIMARY KEY,
	seen_at      INTEGER NOT NULL,
	updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_seen_updated ON seen(updated_at);

-- 石の流通（仕事の依頼成立・フリマの交渉成立）
CREATE TABLE ledger (
	id          TEXT PRIMARY KEY,
	date        TEXT NOT NULL,              -- 成立日 YYYY-MM-DD
	kind        TEXT NOT NULL CHECK (kind IN ('job','item')),
	ref_id      TEXT NOT NULL,
	thread_id   TEXT NOT NULL,
	payer       TEXT NOT NULL,              -- 石を払った世帯
	payee       TEXT NOT NULL,              -- 石を受け取った世帯
	amount      INTEGER NOT NULL CHECK (amount >= 0),
	title       TEXT NOT NULL,
	recorded_by TEXT NOT NULL,
	recorded_at INTEGER NOT NULL,
	updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_ledger_updated ON ledger(updated_at);
CREATE INDEX idx_ledger_date ON ledger(date);

-- 削除の記録（差分同期で「消えた」ことを伝える）
CREATE TABLE tombstones (
	tbl         TEXT NOT NULL,
	id          TEXT NOT NULL,
	deleted_at  INTEGER NOT NULL,
	PRIMARY KEY (tbl, id)
);
CREATE INDEX idx_tombstones_deleted ON tombstones(deleted_at);
