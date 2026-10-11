# 加賀移住者コミュニティ ポータル

地域の貢献と加賀市の未来 — 世帯単位で登録し、**情報（農業・教育・防災・地域イベント）／仕事／フリマ／相談チャット／石の流通** を共有するポータルです。

## 構成

| 役割 | Cloudflare | AWSでいうと |
|---|---|---|
| 画面・API | Workers（`src/worker`）＋ React（`src/react-app`） | Lambda + API Gateway + CloudFront |
| データ | **D1**（SQLite。`migrations/`） | RDS / Aurora Serverless |
| 写真 | **R2**（バケット `kaga-community-photos`） | S3 |
| ログイン状態 | **KV**（`AUTH`） | ElastiCache / DynamoDB（TTL付き） |
| リアルタイム通知 | **Durable Objects**（`Notifier`） | API Gateway WebSocket ＋ α |

```
画面 ──(変更 /api/ops)──▶ Worker ──▶ D1 に保存
  ▲                         └──▶ Notifier(DO) ──(WebSocket)──▶ 全員の画面に「変わったよ」
  └──(差分 /api/sync?since=…)── Worker ◀── D1（前回より後に変わった行だけ）
```

## はじめての準備（1回だけ）

```bash
npm install
npx wrangler login

# D1 を作る → 表示された database_id を wrangler.json に貼る
npx wrangler d1 create kaga-community-portal

# R2 バケットを作る（初回は Cloudflare ダッシュボードで R2 の有効化が必要）
npx wrangler r2 bucket create kaga-community-photos

# KV（ログイン状態の保存先）を作る → 表示された id を wrangler.json の kv_namespaces に貼る
npx wrangler kv namespace create kaga-auth

# 表を作る（本番とローカルの両方）
npm run db:migrate:remote
npm run db:migrate:local

# 最初の管理者を登録するときの「初期設定コード」（長めの好きな文字列）
npx wrangler secret put ADMIN_SETUP_CODE

# パスワードに混ぜる秘密の値（ペッパー）。長いランダムな文字列にする。**一度決めたら変えない・なくさない**
#   作り方の例：openssl rand -base64 48
npx wrangler secret put PASSWORD_PEPPER
```

公開後、サイトを開くと「はじめの設定」画面が出るので、初期設定コードを入れて**運営の世帯を管理者として登録**します（アカウントが1つもないときだけ表示されます）。

### Cloudflare に登録する値のまとめ

| 種類 | 名前 | 登録のしかた | 内容 |
|---|---|---|---|
| シークレット | `PASSWORD_PEPPER` | `npx wrangler secret put PASSWORD_PEPPER` | パスワードのハッシュに混ぜる秘密の値。**必須・変更不可**（変えたり消したりすると全員ログインできなくなる）。パスワード管理ツールなどに控えておく |
| シークレット | `ADMIN_SETUP_CODE` | `npx wrangler secret put ADMIN_SETUP_CODE`（またはダッシュボード → Workers → kaga-community-portal → 設定 → 変数とシークレット） | 最初の管理者を登録するときの初期設定コード。**必須** |
| バインディング | `DB`（D1） | `wrangler.json` の `database_id` に貼る | データ本体 |
| バインディング | `AUTH`（KV） | `wrangler.json` の `kv_namespaces.id` に貼る | ログイン状態 |
| バインディング | `PHOTOS`（R2） | バケット名 `kaga-community-photos` を作るだけ | 写真・プロフィール写真 |
| バインディング | `RL_AUTH` `RL_AUTH_ALL` `RL_USER`（Rate Limiting） | 設定不要（`wrangler.json` の `ratelimits` に記載済み。Wrangler 4.36 以上） | メモリ上の回数制限。D1 の無料枠を守る |
| バインディング | `NOTIFIER`（Durable Object） | 設定不要（初回デプロイで自動作成） | リアルタイム通知 |

- 普通の環境変数（`vars`）は使っていません。登録が必要な秘密の値は `PASSWORD_PEPPER` と `ADMIN_SETUP_CODE` の2つです
- `PASSWORD_PEPPER` を入れる前に作られたパスワードは、その人が次にログインしたときに自動でペッパー入りに作り直されます
- シークレットは一度登録すれば、push でデプロイし直しても消えません
- ローカル開発では `.dev.vars` に `ADMIN_SETUP_CODE=...` と `PASSWORD_PEPPER=...` を書きます（git には入りません）
- Workers Builds のビルド用の環境変数は不要です

Cloudflare ダッシュボードの Workers Builds の **Deploy command** を `npm run deploy` にしてください。
こうすると、push のたびに「表の変更（マイグレーション）を適用 → 公開」の順で実行されます。

## 開発

```bash
npm run dev        # http://localhost:5173 （D1・R2・DO もローカルの模擬環境で動きます）
```

ローカルのデータは `.wrangler/state` に保存され、本番とは別です。`.dev.vars.example` を `.dev.vars` にコピーして `ADMIN_SETUP_CODE` と `PASSWORD_PEPPER` を設定してください。
ブラウザを2つ（通常とシークレットなど）開いて別の世帯でログインすると、リアルタイム反映を確認できます。

## 公開

`main` に push すると自動で公開されます。手動の場合は `npm run build && npm run deploy`。

## 世帯・家族・ログイン

- **世帯は1回だけ登録**：世帯（家族のまとまり）は管理者だけが作れます。同じ世帯主・同じ世帯名＋地区の世帯があると警告が出ます
- **仕事は2種類**：「できること（引き受けます）」と「お願い（依頼）」。お願いは「仕事」→「自分の登録」→「お願いを出す」（例：小松空港まで送迎してほしい・4000石・希望日）。お願いでは投稿した人が頼む側なので、成立を記録すると石は投稿した人→引き受けた人に流れる。種類はあとから変えられない。DB には migrations/0008 が必要
- **メニュー**：上（スマホは下）は「情報・仕事・フリマ・石」。石は管理者だけに表示。相談と世帯と家族は右上のメニューから開く（未読の相談があるとメニューボタンに数字が出る）
- **家族は世帯の中に追加**：右上のメニュー →「世帯と家族」→「家族を追加」。ログインしない家族（赤ちゃんなど）は**登録だけ**でOK（世帯の人数・「わが家向け」の判定に使われます）
- **ログインは家族ひとりずつ**：家族の「ログインを発行」で招待コードが出る → その家族が自分の端末で登録。家族なら誰でも発行できます（まだログインが無い家族あてのみ）
- **名義**：仕事・出品・投稿・相談・石の流通は「人」の名義（例：佐藤 花子・佐藤家）。イベントの参加表明だけは世帯単位
- **新しい世帯の受け入れ**：会員なら誰でも、右上のメニュー →「新しい世帯を招待」で世帯主あての招待コードを出せる（1人3世帯まで。上限は `src/worker/accounts.ts` の `HOUSEHOLD_INVITES_PER_PERSON`。招待した世帯が削除されると枠は戻る）。管理者は「アカウント管理」→「新しい世帯を招待」から上限なしで招待でき、一覧に「招待：〇〇」と招待した人が出る。DB には migrations/0007 が必要
- **パスワードを忘れたとき**：管理者（運営）に頼んで「再設定コード」を発行してもらう → そのコードで新しいパスワードを設定（ほかの端末のログインは無効になる）
- **利用停止**：管理者が「停止」を押すと、その人は即座にログアウトされます
- 招待コードは14日間・1回限り。新しく発行すると古いコードは使えなくなります
- **世帯の削除**：管理者が「アカウント管理」の世帯の行にある「世帯を削除」→ 世帯名を入力して確定。家族・ログイン・招待・仕事・出品・情報・相談（相手側の履歴も）・石の流通の記録・写真をまとめて消します。元に戻せません。自分の世帯は消せません。一時的に止めたいだけなら「停止」を使います
- ログインを持っている家族は、世帯から外せません（運営に連絡）

### 安全のための仕組み

| 項目 | 内容 |
|---|---|
| パスワード | 秘密の値（ペッパー）で HMAC-SHA256 をかけてから PBKDF2-SHA256（10万回、ソルト16バイト）でハッシュ化して D1 に保存。平文は保存しない。データベースだけが漏れても、ペッパーが無ければ総当たりできない |
| ログイン状態 | ランダムな32バイトのトークンを HttpOnly・SameSite=Lax の Cookie に入れ、KV には**トークンのハッシュ**だけを保存（30日で自動失効） |
| 権限 | サーバー側で毎回確認。自分の世帯の情報と家族・自分の投稿・自分が当事者の相談だけ変更できる。家族を別の世帯へ移すことはできない。相談とメッセージは当事者にしか送らない。連絡メモ・生まれ年・続柄は自分の世帯にしか返さない |
| 総当たり対策 | ログイン・招待・初期設定は、まずメモリ上の回数制限（同じ回線から1分10回、全体で1分60回／拠点）で止める。そのうえで「同じ回線×ログインID」の**失敗だけ**を D1 で数え、15分に10回でロック。IPv6 は /64 単位で1つの回線として数える。ログインIDだけではロックしないので、他人のIDを知っていてもその人を締め出せない |
| 無料枠の保護 | 1人あたり：操作は1分120回まで、1回の送信は100件まで、D1 への書き込みは1日3000文まで、全件に近い読み直しは1日60回まで。既読は自分が当事者の相談にしか付けられない |
| 家族のアカウント | 家族が発行できるのは「まだログインが無い家族」への招待コードだけ。ログインのある人のパスワード再設定は管理者だけ（家族によるなりすましを防ぐ） |
| 子どもなどの情報 | ログインの無い家族（赤ちゃん・子どもなど）の名前と写真は、ほかの世帯には送らない（人数にだけ数える） |
| CSRF | 書き込みと WebSocket は、Origin が自サイトと完全に一致するときだけ受け付ける |
| 招待コード | D1 にはハッシュだけを保存 |
| 画面 | クリックジャッキング防止と、`javascript:` リンクを開かない設定（`public/_headers`） |

> 補足：Workers の無料プランは1リクエストあたりのCPU時間が10msです。パスワードのハッシュ計算（ログイン・登録時のみ）がこれを超える場合は、有料プラン（月5ドル〜）にしてください。普段の画面操作には影響しません。

## 表（D1）を変えるとき

1. `migrations/0002_xxx.sql` のように**新しいファイル**を追加（既存のファイルは書き換えない）
2. `npm run db:migrate:local` でローカルに適用して確認
3. push すると本番にも適用されます

中身の確認: `npx wrangler d1 execute DB --remote --command "SELECT * FROM ledger ORDER BY date DESC LIMIT 20"`

## 設定ファイル

`src/react-app/config.ts`：サイト名、サブタイトル、**石の発行の記録（発行枚数）**。変更して push すると反映されます。

## 表の一覧

| 表 | 内容 |
|---|---|
| `households` | 世帯（世帯名・地区・連絡メモ） |
| `jobs` | 仕事（タイトル・内容・石の価格・交渉可否・受付中） |
| `items` | フリマ（商品名・説明・石／円・写真ID・状態・成立相手） |
| `posts` / `rsvps` | 情報（農業・教育・防災・イベント）と、イベントの参加表明 |
| `threads` / `messages` / `reads` | 相談チャットと既読 |
| `seen` | 情報タブの既読（新着表示用） |
| `ledger` | 石の流通（成立日・払った世帯・受け取った世帯・石の額） |
| `tombstones` | 削除の記録（差分同期用） |
| `people` | 家族ひとりずつ（世帯・氏名・続柄・生まれ年・プロフィール写真）。ログインのない家族も含む |
| `accounts` | ログイン（人ごと。ログインID・パスワードのハッシュ・権限・停止） |
| `invites` | 招待コード／再設定コード（人あて。ハッシュで保存） |

## API（Worker）

| メソッド | パス | 内容 |
|---|---|---|
| POST | `/api/auth/login` `logout` `setup` `invite` `accept` `password` | ログイン・初期設定・招待の受け取り・パスワード変更 |
| GET | `/api/auth/me` | ログイン中の世帯（未ログインなら null） |
| GET/POST | `/api/family/accounts` `invite` | 家族のログイン状況・家族へのログイン発行（同じ世帯のみ） |
| GET/POST | `/api/admin/accounts` `households` `invite` `account` | 管理者用：一覧・新しい世帯の招待・招待コード発行・停止／管理者付け外し |
| POST | `/api/admin/household/delete` | 管理者用：世帯の削除（`confirm: true` が無ければ消える件数だけ返す） |
| GET | `/api/sync?since=<ms>` | 指定時刻より後に変わった行と削除。相談・メッセージ・既読はログイン中の人が関わるものだけ |
| POST | `/api/ops` | 変更操作の配列 `{ ops: [{t:"upsert",tbl,doc} / {t:"message"} / {t:"rsvp"} / {t:"delete"} …] }` |
| GET | `/api/ws` | WebSocket。変更があると `{"type":"changed"}` が届く |
| GET/POST/DELETE | `/api/photo` `/api/photo/:id` | 写真（R2）。アップロードは POST（サーバーがIDを決める）。表示はログイン中のみ、削除はアップロードした人か管理者のみ |

## 今後の課題

- 管理者機能（不適切な投稿の非表示など）
- 石の流通の集計を SQL で（月別・世帯別）

## 世帯の削除（DB から）

管理画面の「世帯を削除」を使わずに、コマンドで消す手順です。元に戻せないので、必ず 1 → 5 の順に進めます。

```bash
# 1. バックアップ（いまの DB をまるごと SQL ファイルに保存）
npx wrangler d1 export kaga-community-portal --remote --output=backup-$(date +%Y%m%d-%H%M).sql

# 2. 世帯ID を探す
npx wrangler d1 execute kaga-community-portal --remote --command "SELECT id, name, district FROM households ORDER BY created_at"

# 3. 消える中身を確認（読み取りだけ）。h_xxxx を 2 の世帯ID に置き換える
HID=h_xxxx
sed "s/__HID__/$HID/g" scripts/household-check.sql > /tmp/check.sql
npx wrangler d1 execute kaga-community-portal --remote --file=/tmp/check.sql

# 4. 削除（3 の内容で間違いないときだけ）
sed "s/__HID__/$HID/g" scripts/household-delete.sql > /tmp/delete.sql
npx wrangler d1 execute kaga-community-portal --remote --file=/tmp/delete.sql

# 5. 写真を R2 から消す（3 の r2_key を 1 つずつ）
npx wrangler r2 object delete kaga-community-photos/photos/p_xxxx --remote
```

- ログイン中の人の画面からも自動で消えます（tombstones に記録するため）。消した世帯の人は次の通信でログアウトします
- 途中で止まっても、4 をもう一度流せば残りが消えます
- 間違えたときは、1 のバックアップか D1 の Time Travel（`npx wrangler d1 time-travel restore`）で削除前の時点に戻せます。戻すと、その時刻より後の全員の変更も消えます
- 自分（管理者）の世帯の ID を指定しないこと
