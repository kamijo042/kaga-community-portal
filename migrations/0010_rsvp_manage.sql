-- 情報の「参加」を管理できるようにする
-- rsvp_on: 参加を受け付けるか（NULL = 分類どおり。地域イベントは受け付け、それ以外は受け付けない）
-- rsvp_closed: 投稿者が受付を締め切った（1）
-- rsvps.by_user: 参加を登録した人（世帯の誰が申し込んだか）
ALTER TABLE posts ADD COLUMN rsvp_on INTEGER;
ALTER TABLE posts ADD COLUMN rsvp_closed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rsvps ADD COLUMN by_user TEXT;
