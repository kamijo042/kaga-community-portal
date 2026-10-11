-- 情報の分類に「防災」を追加（農業・教育・防災・地域イベント）
-- SQLite は CHECK 制約を変更できないので、posts を作り直してデータを移す
CREATE TABLE posts_v2 (
	id          TEXT PRIMARY KEY,
	owner       TEXT NOT NULL,
	cat         TEXT NOT NULL CHECK (cat IN ('farm','edu','bousai','event')),
	kind        TEXT NOT NULL DEFAULT '',
	title       TEXT NOT NULL,
	body        TEXT NOT NULL DEFAULT '',
	link        TEXT NOT NULL DEFAULT '',
	targets     TEXT NOT NULL DEFAULT '[]',
	photo       TEXT,
	ev_date     TEXT,
	ev_start    TEXT,
	ev_end      TEXT,
	ev_place    TEXT,
	ev_capacity INTEGER,
	ev_bring    TEXT,
	created_at  INTEGER NOT NULL,
	updated_at  INTEGER NOT NULL
);
INSERT INTO posts_v2 (id, owner, cat, kind, title, body, link, targets, photo, ev_date, ev_start, ev_end, ev_place, ev_capacity, ev_bring, created_at, updated_at)
	SELECT id, owner, cat, kind, title, body, link, targets, photo, ev_date, ev_start, ev_end, ev_place, ev_capacity, ev_bring, created_at, updated_at FROM posts;
DROP TABLE posts;
ALTER TABLE posts_v2 RENAME TO posts;
CREATE INDEX idx_posts_updated ON posts(updated_at);
CREATE INDEX idx_posts_event ON posts(cat, ev_date);
CREATE INDEX IF NOT EXISTS idx_posts_owner ON posts(owner);
