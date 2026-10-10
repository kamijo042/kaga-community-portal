# 加賀移住者コミュニティ ポータル

地域の貢献と加賀市の未来 — 世帯単位で登録し、**情報（教育・農業・地域イベント）／仕事／フリマ／相談チャット／石の流通** を共有するポータルです。

- フロント: React 19 + TypeScript + Vite（`src/react-app`）
- サーバー: Cloudflare Workers + Durable Objects（`src/worker`）
- データはすべて Durable Object（`PortalHub`）に保存され、WebSocket で接続中の全員にリアルタイム反映されます

## 開発

```bash
npm install
npm run dev        # http://localhost:5173 （Worker・Durable Object もローカルで動きます）
```

ブラウザを2つ（通常ウィンドウとシークレットウィンドウなど）開いて別の世帯でログインすると、チャットや投稿がリアルタイムに反映されるのを確認できます。

## 公開（Cloudflare）

GitHub の `main` に push すると、Cloudflare（Workers Builds）が自動でビルド・公開します。手動で出す場合:

```bash
npm run build && npm run deploy
```

初回デプロイ時に Durable Object（`PortalHub`）が作成されます（`wrangler.json` の `migrations`）。

### 合言葉（推奨）

公開URLは誰でも開けるので、合言葉を設定してください。設定すると、合言葉を入れた人だけが使えます。

```bash
npx wrangler secret put PORTAL_PASSCODE
```

ローカルで試す場合は `.dev.vars` に `PORTAL_PASSCODE=好きな言葉` と書きます（git には入りません）。

## 設定ファイル

`src/react-app/config.ts` で次を管理します。変更して push すると反映されます。

| 項目 | 内容 |
|---|---|
| `siteName` / `tagline` | サイト名とサブタイトル |
| `stoneIssuance` | 石の発行の記録（日付・枚数・メモ）。追加発行したら行を足す |

## フォルダ構成

```
src/
  worker/
    index.ts        API の入口（合言葉チェック → Durable Object へ）
    hub.ts          PortalHub：データ保存・差分適用・WebSocket 通知・写真保存
  react-app/
    config.ts       設定ファイル（発行枚数など）
    App.tsx         画面全体（タブ・ヘッダー・モーダル）
    index.css       スタイル（ライト／ダーク対応）
    lib/            型・同期（store.tsx）・業務ロジック（domain.ts, actions.ts）
    components/     共通部品
    forms/          世帯・仕事・出品・投稿の入力フォーム
    views/          情報・仕事・フリマ・相談・石・世帯の各画面
```

## API（Worker）

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/state` | 全データ（＋版番号 rev） |
| POST | `/api/patch` | 変更の差分 `{ set: {"jobs/<id>": {...}}, del: ["items/<id>"], by }` |
| GET | `/api/ws` | WebSocket。変更があると `{"rev": n}` が届く |
| GET/PUT/DELETE | `/api/photo/:id` | 写真（縮小済みの data URL） |
| GET | `/api/ping` | 死活確認と版番号 |

同時編集の扱い: チャットはメッセージIDで合算、イベントの参加表明は本人の分だけ反映、それ以外は後から書いた方が優先です。

## 今後の課題

- 世帯ごとのログイン（今は合言葉のみで、世帯の切り替えは誰でもできます。Cloudflare Access やメールリンク認証の導入を想定）
- 管理者機能（不適切な投稿の非表示など）
- 写真が大量になった場合は R2 への移行
