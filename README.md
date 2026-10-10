# 加賀移住者コミュニティ ポータル

地域の貢献と加賀市の未来 — 世帯単位で登録し、**情報（教育・農業・地域イベント）／仕事／フリマ／相談チャット／石の流通** を共有するポータルです。

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
```

公開後、サイトを開くと「はじめの設定」画面が出るので、初期設定コードを入れて**運営の世帯を管理者として登録**します（アカウントが1つもないときだけ表示されます）。

Cloudflare ダッシュボードの Workers Builds の **Deploy command** を `npm run deploy` にしてください。
こうすると、push のたびに「表の変更（マイグレーション）を適用 → 公開」の順で実行されます。

## 開発

```bash
npm run dev        # http://localhost:5173 （D1・R2・DO もローカルの模擬環境で動きます）
```

ローカルのデータは `.wrangler/state` に保存され、本番とは別です。`.dev.vars.example` を `.dev.vars` にコピーして `ADMIN_SETUP_CODE` を設定してください。
ブラウザを2つ（通常とシークレットなど）開いて別の世帯でログインすると、リアルタイム反映を確認できます。

## 公開

`main` に push すると自動で公開されます。手動の場合は `npm run build && npm run deploy`。

## 世帯・家族・ログイン

- **世帯は1回だけ登録**：世帯（家族のまとまり）は管理者だけが作れます。同じ世帯主・同じ世帯名＋地区の世帯があると警告が出ます
- **家族は世帯の中に追加**：「世帯」タブ →「家族を追加」。ログインしない家族（赤ちゃんなど）は**登録だけ**でOK（世帯の人数・「わが家向け」の判定に使われます）
- **ログインは家族ひとりずつ**：家族の「ログインを発行」で招待コードが出る → その家族が自分の端末で登録。家族なら誰でも発行できます
- **名義**：仕事・出品・投稿・相談・石の流通は「人」の名義（例：佐藤 花子・佐藤家）。イベントの参加表明だけは世帯単位
- **新しい世帯の受け入れ**：管理者が「アカウント管理」→「新しい世帯を招待」→ 世帯主あての招待コードを渡す
- **パスワードを忘れたとき**：家族か管理者が「再設定コード」を発行 → そのコードで新しいパスワードを設定（ほかの端末のログインは無効になる）
- **利用停止**：管理者が「停止」を押すと、その人は即座にログアウトされます
- 招待コードは14日間・1回限り。新しく発行すると古いコードは使えなくなります
- ログインを持っている家族は、世帯から外せません（運営に連絡）

### 安全のための仕組み

| 項目 | 内容 |
|---|---|
| パスワード | PBKDF2-SHA256（10万回、ソルト16バイト）でハッシュ化して D1 に保存。平文は保存しない |
| ログイン状態 | ランダムな32バイトのトークンを HttpOnly・SameSite=Lax の Cookie に入れ、KV には**トークンのハッシュ**だけを保存（30日で自動失効） |
| 権限 | サーバー側で毎回確認。自分の世帯の情報と家族・自分の投稿・自分が当事者の相談だけ変更できる。家族を別の世帯へ移すことはできない。相談とメッセージは当事者にしか送らない。連絡メモ・生まれ年・続柄は自分の世帯にしか返さない |
| 総当たり対策 | 15分間の回数を D1 で原子的に数える（同じ回線 30回、同じ回線×ログインID 10回）。ログインIDだけではロックしないので、他人のIDを知っていてもその人を締め出せない |
| CSRF | 書き込みと WebSocket は、Origin が自サイトと完全に一致するときだけ受け付ける |
| 招待コード | D1 にはハッシュだけを保存。家族は同じ世帯の管理者の再設定コードを発行できない |
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
| `posts` / `rsvps` | 情報（教育・農業・イベント）と、イベントの参加表明 |
| `threads` / `messages` / `reads` | 相談チャットと既読 |
| `seen` | 情報タブの既読（新着表示用） |
| `ledger` | 石の流通（成立日・払った世帯・受け取った世帯・石の額） |
| `tombstones` | 削除の記録（差分同期用） |
| `people` | 家族ひとりずつ（世帯・氏名・続柄・生まれ年）。ログインのない家族も含む |
| `accounts` | ログイン（人ごと。ログインID・パスワードのハッシュ・権限・停止） |
| `invites` | 招待コード／再設定コード（人あて。ハッシュで保存） |

## API（Worker）

| メソッド | パス | 内容 |
|---|---|---|
| POST | `/api/auth/login` `logout` `setup` `invite` `accept` `password` | ログイン・初期設定・招待の受け取り・パスワード変更 |
| GET | `/api/auth/me` | ログイン中の世帯（未ログインなら null） |
| GET/POST | `/api/family/accounts` `invite` | 家族のログイン状況・家族へのログイン発行（同じ世帯のみ） |
| GET/POST | `/api/admin/accounts` `households` `invite` `account` | 管理者用：一覧・新しい世帯の招待・招待コード発行・停止／管理者付け外し |
| GET | `/api/sync?since=<ms>` | 指定時刻より後に変わった行と削除。相談・メッセージ・既読はログイン中の人が関わるものだけ |
| POST | `/api/ops` | 変更操作の配列 `{ ops: [{t:"upsert",tbl,doc} / {t:"message"} / {t:"rsvp"} / {t:"delete"} …] }` |
| GET | `/api/ws` | WebSocket。変更があると `{"type":"changed"}` が届く |
| GET/POST/DELETE | `/api/photo` `/api/photo/:id` | 写真（R2）。アップロードは POST（サーバーがIDを決める）。表示はログイン中のみ、削除はアップロードした人か管理者のみ |

## 今後の課題

- 管理者機能（不適切な投稿の非表示など）
- 石の流通の集計を SQL で（月別・世帯別）
