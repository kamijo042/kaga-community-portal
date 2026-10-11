-- 会員なら誰でも新しい世帯を招待できるようにする（クラブハウス方式）
-- 世帯ごとに「招待した人」を記録し、1人あたりの招待数の上限に使う
ALTER TABLE households ADD COLUMN invited_by TEXT;
CREATE INDEX IF NOT EXISTS idx_households_invited_by ON households(invited_by);
