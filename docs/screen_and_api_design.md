# Kotoe 画面・API設計

README の機能・データモデルから導いた、**画面一覧 → Next.js ルート → Rails API エンドポイント**の対応表。
分離構成（Next.js + Rails API）のため、各画面が必要とするデータ・操作が、そのままバックエンドのエンドポイント仕様になる。

---

## 1. 画面一覧

| # | 画面 | 役割 | 主な状態（画面内） |
|---|---|---|---|
| 1 | トップ | 入口。新着・人気のお題、アプリの説明 | 未ログイン時の導線 |
| 2 | ログイン | 認証 | エラー表示 |
| 3 | 新規登録 | アカウント作成 | バリデーションエラー |
| 4 | お題一覧・検索 | お題をブラウズ。検索(ransack)・ページネーション(kaminari) | 0件の空状態 |
| 5 | お題投稿 | お題画像をアップロード | アップロード中／バリデーション |
| 6 | お題詳細 | 元画像＋挑戦一覧＋**描写入力（保存／生成）**＋**ベスト再現（上位3件）** | 生成中ローディング／生成失敗／削除確認 |
| 7 | 挑戦詳細・比較ビュー | 元画像と再現画像を並列表示＋いいね | 共有用パーマリンク／通報モーダル |
| 8 | ランキング | いいね数等による順位 | 0件の空状態 |
| 9 | マイページ | 自分の投稿・挑戦・**下書き**・お気に入り（タブ切替） | 各タブの空状態 |

> 「生成中」「空状態」「生成失敗」「削除確認」「通報」は独立画面ではなく、各画面内の状態／モーダルとして実装する。

---

## 2. Next.js ルート構成（App Router）

| ルート | 画面 | 認証 | 備考 |
|---|---|---|---|
| `/` | トップ | 不要 | |
| `/login` | ログイン | 不要 | |
| `/signup` | 新規登録 | 不要 | |
| `/posts` | お題一覧・検索 | 不要（投稿は要） | クエリで検索・並び替え・ページ指定 `?q=&sort=new\|popular&page=` |
| `/posts/new` | お題投稿 | 必要 | |
| `/posts/[id]` | お題詳細 | 閲覧は不要／描写は要 | コアループの起点 |
| `/attempts/[id]` | 挑戦詳細・比較 | 閲覧は不要 | 共有用パーマリンク |
| `/rankings` | ランキング | 不要 | `?page=` |
| `/mypage` | マイページ | 必要 | タブ：投稿／挑戦／お気に入り |

---

## 3. Rails API エンドポイント一覧

すべて `/api` 配下、JSON。認証は JWT（Authorization ヘッダ）。

### 認証（Devise + devise-jwt）
| メソッド | パス | 役割 |
|---|---|---|
| POST | `/api/auth/sign_up` | 新規登録 |
| POST | `/api/auth/sign_in` | ログイン（JWT を発行） |
| DELETE | `/api/auth/sign_out` | ログアウト（JWT を失効） |
| GET | `/api/me` | ログイン中のユーザー情報 |

### お題（Post）
| メソッド | パス | 役割 | 画面 |
|---|---|---|---|
| GET | `/api/posts` | お題一覧（ransack 検索・kaminari ページング）。`?q=` タイトル部分一致／`?sort=new\|popular`（popular＝いいね合計の降順）／`?page=`（1ページ12件固定） | 一覧 |
| POST | `/api/posts` | お題投稿 | 投稿 |
| GET | `/api/posts/:id` | お題詳細＋挑戦一覧（`sort=likes` で再現度順＝ベスト再現の取得にも使用） | 詳細 |
| DELETE | `/api/posts/:id` | 自分のお題を削除（ソフトデリート） | マイページ |

### 挑戦（Attempt）
| メソッド | パス | 役割 | 画面 |
|---|---|---|---|
| POST | `/api/posts/:post_id/attempts` | 描写を**下書き保存**（生成しない） | 詳細 |
| PATCH | `/api/attempts/:id` | 下書きの描写を更新 | 詳細 |
| POST | `/api/attempts/:id/generate` | 下書きから生成ジョブ起動→即公開。生成回数を消費 | 詳細 |
| GET | `/api/attempts/:id` | 生成状況のポーリング／挑戦詳細 | 詳細・比較 |
| DELETE | `/api/attempts/:id` | 自分の挑戦/下書きを削除（ソフトデリート、回数は戻さない） | 詳細・マイページ |

実装は issue 4-2。確定した挙動：

- 状態は `draft → generating → published`（生成成功で即公開）または `failed`。
  **`published` / `failed` は終端**で、再試行は新しい下書きを作る。
- `PATCH` と `generate` は **draft のときだけ**受け付ける。それ以外は 422 `attempt_not_draft`。
- 生成回数は **1日 3 回**（`KOTOE_DAILY_GENERATION_LIMIT` で上書き可）。「1日」は JST の暦日。
  上限到達は 422 で、補助情報を添える：

  ```json
  { "error": "generation_limit_reached", "limit": 3, "resets_at": "2026-08-02T15:00:00Z" }
  ```

- サービス全体でも **1日 50 枚**の上限を持つ（`KOTOE_SERVICE_DAILY_GENERATION_LIMIT` で
  上書き可、issue 4-3）。到達すると **503**。個人の上限（422）と分けているのは、
  422 が「あなたの操作の問題」、503 が「こちら側の都合」だから。

  ```json
  { "error": "service_generation_limit_reached", "resets_at": "2026-08-02T15:00:00Z" }
  ```

  `KOTOE_GENERATION_ENABLED=false`（キルスイッチ）のときも **503** で
  `{ "error": "generation_disabled" }` を返す。どちらもジョブを積まず、**生成枠も消費しない**。
- 失敗した挑戦は `failure_reason` を持つ（issue 4-3）。値は `content_policy` /
  `rate_limited` / `api_error` / `upload_failed` / `internal_error` / `generation_disabled`
  のいずれかで、`failed` 以外は `null`。文言は返さず、フロントの辞書で翻訳する。
  `generation_disabled` は 503 のエラーコードと同じ値で、「ジョブが積まれたあとに
  キルスイッチが入った」場合に入る（辞書を分けずに済ませるため同じコードにしてある）。
- 生成画像は **WebP** で Cloudinary に保存する（issue 4-3）。**ダウンロードURLには必ず
  `f_png` / `f_jpg` と `fl_attachment` を付ける**こと。付け忘れると `.webp` が落ち、
  macOS の Preview で開けない環境がある。
- `GET /api/attempts/:id` は `{ "attempt": {...}, "post": {...} }` を返す（比較ビューが
  元画像を必要とするため）。`published` は誰でも、それ以外は**本人のみ**で、他人・未認証からは
  404（403 や 401 にせず存在ごと隠す）。**生成中はまだ公開されていないので、
  フロントのポーリングは Authorization ヘッダを付ける必要がある。**
- `DELETE` は論理削除で、`generated_at` を消さない（**回数は戻らない**）。生成中でも削除できる。
- 描写（`description`）は **1〜1,000 文字**。超過は 422 `{ "errors": { "description": ["too_long"] } }`。

> 補足：「保存」ボタン＝`POST /attempts`（draft 作成）または `PATCH`（更新）。「画像を生成」ボタン＝`POST /attempts/:id/generate`。生成を一発で行いたい場合は、内部で「draft 作成 → generate」を続けて呼ぶ。

### 再現いいね（Like）
| メソッド | パス | 役割 |
|---|---|---|
| POST | `/api/attempts/:id/like` | いいねする |
| DELETE | `/api/attempts/:id/like` | いいね解除 |

- **どちらも冪等**。すでにいいね済みの `POST`、いいねしていない `DELETE` はエラーにせず、
  現在の状態を `200` で返す（ボタン連打・通信リトライ・別タブとの状態ズレで無意味なエラーを出さない）。
  二重いいねは `likes(user_id, attempt_id)` の複合ユニークインデックスが防ぐ。
- 応答は `{ "attempt": {...} }`（更新後の `likes_count` と `liked` を含む）。ボディを返すので
  `204` ではなく `200`。
- 対象は **`kept` かつ `published`** で、かつ**お題も `kept`** の挑戦のみ。下書き・生成中・失敗・
  削除済み・存在しない ID・**お題が削除済み**は、すべて `404`（403 にせず存在ごと隠す）。
  お題側も見るのは `Post#discard` が挑戦にカスケードしないため。挑戦だけを見ると
  `kept` かつ `published` のままで、読み取り API から辿れないのにいいねだけ書き込め、
  その票がベスト再現（6-1）と全体ランキング（6-2）に効いてしまう。
- **自分の挑戦にはいいねできない**。`422 { "error": "cannot_like_own_attempt" }`。
  いいねはベスト再現（6-1）と全体ランキング（6-2）の順位を決める投票のため。
- 解除は**物理削除**（`discard` を使わない）。行を残すと複合ユニークに引っかかり、
  同じ挑戦にいいねし直せなくなる。
- 挑戦の応答に含まれる `liked` は、**そのリクエストの本人**がいいね済みかどうか。
  未認証なら常に `false`。**誰がいいねしたかは公開しない**（一覧 API も通知も持たない。5-5 で検討）。

### お気に入り（Favorite）
| メソッド | パス | 役割 |
|---|---|---|
| POST | `/api/posts/:id/favorite` | お気に入り登録 |
| DELETE | `/api/posts/:id/favorite` | お気に入り解除 |

### ランキング・マイページ・通報
| メソッド | パス | 役割 | 画面 |
|---|---|---|---|
| GET | `/api/rankings` | いいね数等の全体順位（kaminari） | ランキング |
| GET | `/api/me/posts` | 自分の投稿一覧 | マイページ |
| GET | `/api/me/attempts` | 自分の公開済み挑戦一覧（`status: published`） | マイページ |
| GET | `/api/me/drafts` | 自分の下書き一覧（`status: draft`／保存したプロンプト） | マイページ |
| GET | `/api/me/favorites` | お気に入り一覧 | マイページ |
| POST | `/api/attempts/:id/report` | 挑戦を通報（モデレーション） | 比較ビュー |

---

## 4. コアループ（最重要フロー）

```
お題詳細 /posts/[id]
   │ 描写を入力 →「画像を生成」
   ▼
POST /api/posts/:post_id/attempts   （status: generating、生成回数を消費）
   │ 非同期ジョブで生成 → Cloudinary 保存 → status: published（即公開）
   ▼
GET /api/attempts/:id   （フロントがポーリングで完了を検知）
   ▼
挑戦詳細・比較ビュー /attempts/[id]   （元画像 vs 再現画像、いいね対象に）
```

> この「お題詳細 → 挑戦詳細」がアプリの中心。ここの体験（生成中の見せ方・即公開の瞬間・比較ビュー）に最も投資する。

---

## 5. 実装の着手順（推奨）

1. Rails：モデル＋マイグレーション（User / Post / Attempt / Like / Favorite、`discard` 導入）
2. Rails：認証（devise-jwt）と `/api/me` まで通す
3. Rails：Post の CRUD と `GET /api/posts/:id`（挑戦一覧含む）
4. Rails：Attempt 生成を**ダミー（固定画像を返すスタブ）**でジョブ化し、非同期フローの骨組みを通す
5. Next.js：ルートの骨組み（`/`, `/posts`, `/posts/[id]`）と API 接続
6. 画像生成 API を本物に差し替え → いいね・お気に入り・ランキング・検索を順次
