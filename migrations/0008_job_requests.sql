-- 仕事に「お願い（依頼）」を追加する
-- type: offer = できること（引き受けます）／ request = お願いしたいこと（依頼）
-- want_date: お願いの希望日（任意）
-- お願いでは投稿した人が「頼む側」になるので、石は投稿した人から引き受けた人へ流れる
ALTER TABLE jobs ADD COLUMN type TEXT NOT NULL DEFAULT 'offer' CHECK (type IN ('offer','request'));
ALTER TABLE jobs ADD COLUMN want_date TEXT;
