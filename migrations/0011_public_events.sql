-- 会員以外も参加登録できるイベントの公開URL（調整さん方式）
-- posts.public_token: 公開URL（/e/<token>）の鍵。NULL なら公開していない
-- guests: 会員以外の参加登録。名前・人数・ひとことだけ（連絡先は預からない）
--   edit_hash: 登録した端末だけが変更・取り消しできるよう、編集用の鍵のハッシュを保存
ALTER TABLE posts ADD COLUMN public_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_public_token ON posts(public_token) WHERE public_token IS NOT NULL;
CREATE TABLE IF NOT EXISTS guests (
	id         TEXT PRIMARY KEY,
	post_id    TEXT NOT NULL,
	name       TEXT NOT NULL,
	people     INTEGER NOT NULL DEFAULT 1,
	note       TEXT NOT NULL DEFAULT '',
	edit_hash  TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guests_post ON guests(post_id);
CREATE INDEX IF NOT EXISTS idx_guests_updated ON guests(updated_at);
