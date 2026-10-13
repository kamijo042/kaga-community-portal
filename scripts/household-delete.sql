-- 世帯をまるごと削除する（元に戻せません。先に household-check.sql で中身を確認し、バックアップを取ること）
-- __HID__ は sed で世帯IDに置き換える。管理画面の「世帯を削除」と同じ内容。
-- 消した行は tombstones に記録するので、ログイン中の人の画面からも自動で消える。
-- 途中で止まっても、もう一度流せば残りが消える（何度流しても同じ結果）

-- 相談・メッセージ・既読
INSERT OR REPLACE INTO tombstones (tbl, id, deleted_at) SELECT 'threads',  id, strftime('%s','now') * 1000 FROM threads WHERE owner IN (SELECT id FROM people WHERE household_id = '__HID__') OR other IN (SELECT id FROM people WHERE household_id = '__HID__');
INSERT OR REPLACE INTO tombstones (tbl, id, deleted_at) SELECT 'messages', id, strftime('%s','now') * 1000 FROM threads WHERE owner IN (SELECT id FROM people WHERE household_id = '__HID__') OR other IN (SELECT id FROM people WHERE household_id = '__HID__');
DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE owner IN (SELECT id FROM people WHERE household_id = '__HID__') OR other IN (SELECT id FROM people WHERE household_id = '__HID__'));
DELETE FROM reads WHERE user_id IN (SELECT id FROM people WHERE household_id = '__HID__') OR thread_id IN (SELECT id FROM threads WHERE owner IN (SELECT id FROM people WHERE household_id = '__HID__') OR other IN (SELECT id FROM people WHERE household_id = '__HID__'));
DELETE FROM threads WHERE owner IN (SELECT id FROM people WHERE household_id = '__HID__') OR other IN (SELECT id FROM people WHERE household_id = '__HID__');

-- イベントの参加表明（この世帯の表明と、この世帯のイベントへの表明）
INSERT OR REPLACE INTO tombstones (tbl, id, deleted_at) SELECT 'rsvps', post_id || '|' || household_id, strftime('%s','now') * 1000 FROM rsvps WHERE household_id = '__HID__' OR post_id IN (SELECT id FROM posts WHERE owner IN (SELECT id FROM people WHERE household_id = '__HID__'));
DELETE FROM rsvps WHERE household_id = '__HID__' OR post_id IN (SELECT id FROM posts WHERE owner IN (SELECT id FROM people WHERE household_id = '__HID__'));

-- 仕事・出品・情報・石の流通
INSERT OR REPLACE INTO tombstones (tbl, id, deleted_at) SELECT 'jobs',  id, strftime('%s','now') * 1000 FROM jobs  WHERE owner IN (SELECT id FROM people WHERE household_id = '__HID__');
DELETE FROM jobs  WHERE owner IN (SELECT id FROM people WHERE household_id = '__HID__');
INSERT OR REPLACE INTO tombstones (tbl, id, deleted_at) SELECT 'items', id, strftime('%s','now') * 1000 FROM items WHERE owner IN (SELECT id FROM people WHERE household_id = '__HID__');
DELETE FROM items WHERE owner IN (SELECT id FROM people WHERE household_id = '__HID__');
INSERT OR REPLACE INTO tombstones (tbl, id, deleted_at) SELECT 'posts', id, strftime('%s','now') * 1000 FROM posts WHERE owner IN (SELECT id FROM people WHERE household_id = '__HID__');
DELETE FROM posts WHERE owner IN (SELECT id FROM people WHERE household_id = '__HID__');
INSERT OR REPLACE INTO tombstones (tbl, id, deleted_at) SELECT 'ledger', id, strftime('%s','now') * 1000 FROM ledger WHERE payer IN (SELECT id FROM people WHERE household_id = '__HID__') OR payee IN (SELECT id FROM people WHERE household_id = '__HID__');
DELETE FROM ledger WHERE payer IN (SELECT id FROM people WHERE household_id = '__HID__') OR payee IN (SELECT id FROM people WHERE household_id = '__HID__');

-- ログイン・招待・既読時刻（アカウントが消えるとログイン中の端末は次の通信でログアウト）
DELETE FROM seen     WHERE user_id IN (SELECT id FROM people WHERE household_id = '__HID__');
DELETE FROM invites  WHERE household_id = '__HID__';
DELETE FROM accounts WHERE household_id = '__HID__';

-- 人と世帯（最後に消す。上の文はすべて people を使って対象を探すため）
INSERT OR REPLACE INTO tombstones (tbl, id, deleted_at) SELECT 'people', id, strftime('%s','now') * 1000 FROM people WHERE household_id = '__HID__';
DELETE FROM people WHERE household_id = '__HID__';
INSERT OR REPLACE INTO tombstones (tbl, id, deleted_at) SELECT 'households', id, strftime('%s','now') * 1000 FROM households WHERE id = '__HID__';
DELETE FROM households WHERE id = '__HID__';
