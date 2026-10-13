-- 世帯の削除前の確認（読み取りだけ。何も変えません）
-- 使い方は README の「世帯の削除（DB から）」を参照。__HID__ は sed で世帯IDに置き換える

-- 1) 対象の世帯と家族
SELECT h.id AS household_id, h.name AS household, h.district, p.id AS person_id, p.name, p.relation, a.login_id, a.role
FROM households h JOIN people p ON p.household_id = h.id LEFT JOIN accounts a ON a.user_id = p.id
WHERE h.id = '__HID__';

-- 2) 消える件数
SELECT
	(SELECT COUNT(*) FROM people   WHERE household_id = '__HID__') AS people,
	(SELECT COUNT(*) FROM accounts WHERE household_id = '__HID__') AS logins,
	(SELECT COUNT(*) FROM jobs  WHERE owner IN (SELECT id FROM people WHERE household_id = '__HID__')) AS jobs,
	(SELECT COUNT(*) FROM items WHERE owner IN (SELECT id FROM people WHERE household_id = '__HID__')) AS items,
	(SELECT COUNT(*) FROM posts WHERE owner IN (SELECT id FROM people WHERE household_id = '__HID__')) AS posts,
	(SELECT COUNT(*) FROM threads WHERE owner IN (SELECT id FROM people WHERE household_id = '__HID__') OR other IN (SELECT id FROM people WHERE household_id = '__HID__')) AS threads,
	(SELECT COUNT(*) FROM ledger WHERE payer IN (SELECT id FROM people WHERE household_id = '__HID__') OR payee IN (SELECT id FROM people WHERE household_id = '__HID__')) AS ledger;

-- 3) R2 から消す写真のキー
SELECT 'photos/' || j.value AS r2_key FROM items i, json_each(i.photos) j WHERE i.owner IN (SELECT id FROM people WHERE household_id = '__HID__')
UNION SELECT 'photos/' || photo  FROM posts  WHERE owner IN (SELECT id FROM people WHERE household_id = '__HID__') AND photo  IS NOT NULL
UNION SELECT 'photos/' || avatar FROM people WHERE household_id = '__HID__' AND avatar IS NOT NULL;
