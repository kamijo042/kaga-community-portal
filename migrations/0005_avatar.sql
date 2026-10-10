-- プロフィール写真（R2 の写真ID）。未設定なら NULL（名前の1文字目の丸アイコンを表示）
ALTER TABLE people ADD COLUMN avatar TEXT;
