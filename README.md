# 加賀移住者コミュニティ ポータル

地域の貢献と加賀市の未来 — 世帯単位で登録し、**情報（教育・農業・地域イベント）／仕事／フリマ／相談チャット／石の流通** を共有するポータルです。

## 構成

| 役割 | Cloudflare | AWSでいうと |
|---|---|---|
| 画面・API | Workers（`src/worker`）＋ React（`src/react-app`） | Lambda + API Gateway + CloudFront |
| データ | **D1**（SQLite。`migrations/`） | RDS / Aurora Serverless |
| 写真 | **R2**（バケット `kaga-community-photos`） | S3 |
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

# 表を作る（本番とローカルの両方）
npm run db:migrate:remote
npm run db:migrate:local

# 合言葉（推奨）
npx wrangler secret put PORTAL_PASSCODE
```

Cloudflare ダッシュボードの Workers Builds の **Deploy command** を `npm run deploy` にしてください。
こうすると、push のたびに「表の変更（マイグレーション）を適用 → 公開」の順で実行されます。

## 開発

```bash
npm run dev        # http://localhost:5173 （D1・R2・DO もローカルの模擬環境で動きます）
```

ローカルのデータは `.wrangler/state` に保存され、本番とは別です。合言葉を試すときは `.dev.vars.example` を `.dev.vars` にコピーして設定します。
ブラウザを2つ（通常とシークレットなど）開いて別の世帯でログインすると、リアルタイム反映を確認できます。

## 公開

`main` に push すると自動で公開されます。手動の場合は `npm run build && npm run deploy`。

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
| `households` | 世帯（世帯主・地区・家族構成） |
| `jobs` | 仕事（タイトル・内容・石の価格・交渉可否・受付中） |
| `items` | フリマ（商品名・説明・石／円・写真ID・状態・成立相手） |
| `posts` / `rsvps` | 情報（教育・農業・イベント）と、イベントの参加表明 |
| `threads` / `messages` / `reads` | 相談チャットと既読 |
| `seen` | 情報タブの既読（新着表示用） |
| `ledger` | 石の流通（成立日・払った世帯・受け取った世帯・石の額） |
| `tombstones` | 削除の記録（差分同期用） |

## API（Worker）

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/sync?since=<ms>&me=<世帯ID>` | 指定時刻より後に変わった行と削除。相談・メッセージ・既読は me が関わるものだけ |
| POST | `/api/ops` | 変更操作の配列 `{ ops: [{t:"upsert",tbl,doc} / {t:"message"} / {t:"rsvp"} / {t:"delete"} …] }` |
| GET | `/api/ws` | WebSocket。変更があると `{"type":"changed"}` が届く |
| GET/PUT/DELETE | `/api/photo/:id` | 写真（R2）。GET は合言葉なしで表示可（IDは推測できない乱数） |

## 今後の課題

- 世帯ごとのログイン（今は合言葉のみ。世帯の切り替えは誰でもできる。Cloudflare Access やメールリンク認証を想定）
- 管理者機能（不適切な投稿の非表示など）
- 石の流通の集計を SQL で（月別・世帯別）
