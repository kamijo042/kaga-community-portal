-- フリマの値段の払い方をはっきりさせる
-- pay_mode: stone = 石だけ ／ yen = 円だけ ／ either = 石か円のどちらでも ／ both = 石と円を合わせて
-- これまでの出品は、値段の入れ方から決める（両方入っていたものは「どちらでも」）
ALTER TABLE items ADD COLUMN pay_mode TEXT CHECK (pay_mode IN ('stone','yen','either','both'));
UPDATE items SET pay_mode = CASE
	WHEN price_stone IS NOT NULL AND price_yen IS NOT NULL THEN 'either'
	WHEN price_yen IS NOT NULL THEN 'yen'
	ELSE 'stone' END
WHERE pay_mode IS NULL;
