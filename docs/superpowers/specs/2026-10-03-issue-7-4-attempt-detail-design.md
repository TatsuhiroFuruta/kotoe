# issue 7-4 挑戦詳細・比較ビュー 設計

- 対象 issue：`docs/issues_backlog.md` 7-4（GitHub #25）
- 依存：7-1（`apiFetch`・認証）、5-1（いいね API）、7-3b（`AttemptCard`・`PostDetail` の取得の形）、
  7-3c（`PublishedResult`・`cloudinaryDownloadUrlOrNull()`）、7-2.5（トースト）
- 作成日：2026-10-03
- 前提：`frontend/AGENTS.md`（Next 16.2.10 の API は型定義とコンパイル済み実装を直接読む）
- 前提：CLAUDE.md「XSS」「テスト戦略」「メッセージ・エラー・i18n の責務」
- 前提：backlog 7-4 の申し送り（7-3b：カードのリンク化、7-3c：結果パネルからのリンク・本人だけのダウンロード）。
  本書は、カードにいいねボタンを足す申し送りを**採らない**（決定 3）

## この issue で作るもの

1. `/attempts/[id]`：元画像と再現画像の比較、描写文の全文、いいね、リンクのコピー、本人だけのダウンロード
2. 挑戦カード（`AttemptCard`）を比較ビューへのリンクにする
3. 生成直後の結果パネル（`PublishedResult`）に比較ビューへのリンクを足す

バックエンドの変更は無い。

**この issue で作らないもの**

| 項目 | 理由・担当 |
|---|---|
| 通報の導線 | 通報 API（5-3）が未実装（🔵 本リリース） |
| 類似度スコア | `similarity_score` は 8-4 まで常に null |
| ページタイトル・OGP に挑戦の中身を入れる | 8-3（決定 1） |
| カードでのいいね | 決定 3。必要になったら別 issue に積む |
| 未公開の挑戦の状態表示（生成中のポーリング・失敗理由） | 4-5（#93）・7-6（決定 2） |

## 調べて分かったこと（2026-10-03、コードから確認）

| 確認したこと | 結果 |
|---|---|
| 取得 | `GET /api/attempts/:id` → `{ attempt, post }`。**認証不要**（`before_action :authenticate_user!, except: :show`） |
| 見える範囲 | `Attempt.kept` かつ（`published` または本人）。それ以外は 404（`visible_attempt`）。**お題が削除済みでも 404**（`Post.kept.find`） |
| `liked` | `current_user` で判定。未認証なら false |
| いいね | `POST` / `DELETE /api/attempts/:id/like` → 200 `{ attempt }`（更新後の `liked`・`likes_count`）。どちらも冪等 |
| いいねの 404 | `kept` かつ `published` かつお題が `kept` でないもの |
| 自分の挑戦へのいいね | 422 `{ error: "cannot_like_own_attempt" }`。解除（`DELETE`）は自分の挑戦でも 404 にならない |
| 期限切れトークンでの `show` | `posts#show` と同じ形（`authenticate_user!` を通らず `current_user` を見るだけ）。お題詳細は 200 を返すことを 7-3b で実測済み。**`attempts#show` は実装時に実測する**（手動確認 3） |
| 生成画像 | 1024×1024 の正方形、WebP で保存（4-3） |
| 元画像 | 縦横比は自由。お題詳細では切り抜かずに出している（7-3b 決定 4） |

## 決めたこと

### 決定 1：取得はクライアントで 1 本だけ行う（7-3a・7-3b と同じ）

`app/attempts/[id]/page.tsx` はサーバーコンポーネントのまま、id を検証するだけにする。取得はクライアント
コンポーネント `AttemptDetail` で行う。

- Render がスリープしていても HTML がすぐ返る（サーバーで取得すると最大約 60 秒、白い画面のまま待たされる）
- 本人にしか見えない未公開の挑戦は `localStorage` のトークンが必要。サーバーではトークンを読めない
- タイトルは固定の「挑戦」。挑戦の中身を `<title>` や OGP に入れるには `generateMetadata` での取得が要るので、
  8-3 で扱う（メタデータだけサーバーで取り、本体はクライアントで取る形が有力）

認証状態の確定は待たずに取得を始める。`apiFetch` は `tokenStore` のトークンを同期的に載せるので、`liked` も
本人判定も正しく返る（7-3b の `PostDetail` と同じ根拠）。

### 決定 2：公開済み以外は比較ビューにしない

API は本人に対してだけ、`draft` / `generating` / `failed` の挑戦も 200 で返す。その場合は
「この挑戦はまだ公開されていません」と、そのお題へ戻るリンクだけを出す。

- 今、未公開の挑戦の `/attempts/[id]` へ向かう導線は無い（カードに出るのは公開済みだけで、結果パネルのリンクも公開後）
- 生成中のポーリングや失敗理由を出すと、4-5（失敗した挑戦を本人が見つける）と 7-6（下書き）の範囲に重なる
- 404 と同じ「見つかりません」にすると、本人には自分の挑戦が消えたように見える

### 決定 3：カードはリンクだけにし、いいねボタンは足さない

backlog の申し送りは「カードを `<Link>` で包み、いいねボタンを足す」だったが、いいねボタンは足さない。
カードのいいね数は表示のまま残す。

- `<a>` の中に `<button>` は置けない（入れ子は HTML として不正）。ボタンを置くなら、画像と描写文だけを
  リンクにし、ボタンをその外に出す構造が要る
- 同じ挑戦が表彰台とみんなの挑戦の両方に出る。片方で押したらもう片方も揃えるため、`PostDetail` に
  「挑戦 id → いいね状態」の上書きを持たせることになる
- 比較ビューへは 1 クリックで行ける。元画像と見比べてから押すほうが「再現度を競う」趣旨に合う

ボタンを置かないので、カードは `<article>` ごと `<Link>` で包める（中に操作できる要素が無い）。

### 決定 4：比較は同じ幅の正方形枠を 2 つ並べ、元画像を先に置く

- 枠は 2 つとも正方形で同じ幅。元画像は枠の中に `object-contain` で収め、余白は `bg-line` の帯になる
  （横長ほど帯が太い）。再現画像は 1:1 なので枠いっぱいになる
- 順番は **元画像 → 再現画像**。`sm` 以上は左右（左が元画像）、スマホ幅は縦積み（上が元画像）。
  お題 → 再現という時系列の順で、お題詳細と同じ並び
- それぞれ `<figure>` にし、`<figcaption>` で「お題」「再現」と示す

検討して採らなかった案：

- 高さを揃える案：帯は出ないが、横長の元画像だと再現画像が小さくなる。生成した画像を主に見せたい（ユーザー）
- スライダーで重ねる案（デザイン依頼文の提案）：構図のずれは一番分かるが、ドラッグ・キーボード操作・
  読み上げ対応を自作することになり、この issue の中で一番重い。必要なら後で A の上に足せる

### 決定 5：いいねは `FavoriteButton` と同じ形にする

`LikeButton`（`components/attempts/like-button.tsx`）を新規に作る。

| 認証状態 | 表示 |
|---|---|
| `unauthenticated` | 「ログインしていいね」のリンク。`/login?next=` に `attemptDetailHref(id)`。ログイン画面が `safeNextPath()` で検証する |
| `authenticated` かつ自分の挑戦（`auth.user.id === attempt.user.id`） | ボタンを出さない（押せば必ず 422 になるため） |
| `loading` | ボタンを出すが押せない |
| `authenticated`（他人の挑戦）・`unreachable` | 押せる。`unreachable` で押して失敗したら下の文言で理由を出す |

- いいね数はボタンの有無によらず常に表示する
- **楽観更新しない**。応答の `attempt.liked`・`attempt.likes_count` で表示を確定させる（巻き戻しが要らない）
- ラベルは「いいね」で固定し、状態は `aria-pressed` で伝える（ラベルと状態の両方を変えると読み上げが二重になる）
- 押している間は無効にする
- 応答は `onChange(attempt)` で `AttemptDetail` に返し、数とボタンの状態を一緒に更新する

失敗は `toast.error` で出す（無言にしない）。文言は `toLikeErrorMessage(error)`（決定 8）が決める。

| 失敗 | 文言 |
|---|---|
| 401 | `SESSION_EXPIRED_MESSAGE`（`api.ts` がトークンを捨てるので、ボタンは「ログインしていいね」に変わる） |
| 404 | 「この挑戦は削除されました」 |
| 422 `cannot_like_own_attempt` | 「自分の挑戦にはいいねできません」（ボタンを出さないので通常は起きない。別タブで別アカウントに切り替えたとき用） |
| その他 | `toRequestErrorMessage(error)` |

### 決定 6：「リンクをコピー」ボタンを置く

画面一覧の「共有用パーマリンク」に対する最小の導線。SNS シェアは 8-3。

- コピーするのは `window.location.origin + attemptDetailHref(id)`。`location.href` をそのまま使わない
  （`?` や `#` 付きで開かれたとき、それまで共有されてしまう）
- 成功：`toast.success("リンクをコピーしました")`
- 失敗：`toast.error("リンクをコピーできませんでした。アドレスバーの URL をコピーしてください")`。
  `navigator.clipboard` は https か localhost でしか使えず、LAN 経由の dev サーバー（http、0-6）では
  `undefined` になる。存在しないときも同じ失敗として扱う

### 決定 7：ダウンロードは本人の挑戦にだけ出す（2026-09-30 決定）

- 条件：`auth.status === "authenticated"` かつ `auth.user.id === attempt.user.id`
- URL：`cloudinaryDownloadUrlOrNull(publicId, { filename: \`kotoe-attempt-${id}\` })`（7-3c と同じ。
  `f_png,fl_attachment`、原寸）。null ならボタンを出さない
- `download` 属性は付けない（別オリジンでは効かない。`fl_attachment` で保存させる）
- お題詳細のカード（表彰台・みんなの挑戦）には置かない。自分と他人の挑戦が混ざって並ぶ場所で、
  他人の生成画像を保存しやすくする導線は、通報・削除との整合を決めるまで検討しない。自分の挑戦は
  カードから比較ビューへ移れば保存できる

### 決定 8：新しく作る純粋関数

#### `lib/attempts/attempt-detail-query.ts`

- `parseAttemptId(raw: string): number | null`：`parsePositiveInt` に委ねる（`parsePostId` と同じ）
- `attemptDetailHref(id: number): string`：`/attempts/${id}`。カード・結果パネル・ログイン導線・
  リンクのコピーで共有する

#### `lib/attempts/attempt-messages.ts` に追加

- `toLikeErrorMessage(error: unknown): string`：決定 5 の表

## 状態

`AttemptDetail` の取得結果：

| 結果 | 表示 |
|---|---|
| 取得中 | スケルトン（正方形の枠 2 つと、文章の行） |
| 404 | 「挑戦が見つかりませんでした。削除された可能性があります」と「お題を探す」へのリンク |
| 200 で `published` 以外 | 「この挑戦はまだ公開されていません」と「お題に戻る」へのリンク（決定 2） |
| 通信エラー・5xx | メッセージと「再試行」ボタン |
| 200 で `published` | 本体 |

- 7-3b の `PostDetail` と同じく、結果は「どのリクエストの結果か」を表す key（`retryCount`）と一緒に持ち、
  今の key と一致しないものは表示しない。中断（アンマウント）は失敗として扱わない
- いいねの結果は `{ attemptId, liked, likes_count }` の上書きとして別に持ち、取得した値より優先する
  （再試行で取り直したときに古い値に戻さないため、`attemptId` と一緒に持つ）

## 構成

| ファイル | 変更 |
|---|---|
| `src/app/attempts/[id]/page.tsx` | 新規。id を検証し、不正なら `notFound()`。`metadata.title` は「挑戦」 |
| `src/components/attempts/attempt-detail.tsx` | 新規（client）。取得と状態の出し分け、本体の配置 |
| `src/components/attempts/attempt-comparison.tsx` | 新規。2 つの `<figure>`（決定 4） |
| `src/components/attempts/like-button.tsx` | 新規（client）。決定 5 |
| `src/components/attempts/copy-link-button.tsx` | 新規（client）。決定 6 |
| `src/lib/attempts/attempt-detail-query.ts` | 新規。決定 8 |
| `src/lib/attempts/attempt-messages.ts` | `toLikeErrorMessage` を追加 |
| `src/components/attempts/attempt-card.tsx` | `<article>` を `<Link href={attemptDetailHref(id)}>` で包む。7-4 のコメントを外す |
| `src/components/attempts/generation-panel.tsx` | `PublishedResult` に「お題と見比べる」リンクを足す。7-4 のコメントを外す |
| `src/types/api.ts` | `LikeResponse = { attempt: Attempt }` を追加。`Attempt.liked` の「7-4 まで描画しない」を外す |

### 画像の URL

- 再現画像：`cloudinaryUrlOrNull(id, { width: 640, aspect: "1:1" })`。カードと同じ変換なので、
  Cloudinary の派生画像を共有できる（7-3b からの申し送り）
- 元画像：`cloudinaryUrlOrNull(post.image_public_id, { width: 640 })`。縦横比は指定しない（切り抜かない）
- null のときは同じ寸法の空枠（`role="img"` と `aria-label`）を出す（カードと同じ）
- どちらも画面の最初に見えるので `loading="lazy"` は付けない
- `alt`：元画像はお題のタイトル、再現画像は「{name} さんの再現画像」（カードと同じ。描写文は入れない）

## 画面

上から：

1. 「← お題に戻る」（`postDetailHref(post.id)`）
2. `h1`：お題のタイトル
3. 比較（決定 4）
4. 挑戦者の名前と、描写文の全文（`whitespace-pre-wrap wrap-break-word`）
5. 操作の行：いいね（ボタンと数）、「リンクをコピー」、本人だけ「画像をダウンロード」。スマホ幅では折り返す

幅は `max-w-5xl`（お題詳細と同じ）。色は `globals.css` のトークンだけを使い、`dark:` は書かない。

カードはリンクになるので、フォーカスリングを `<Link>` に付ける（`focus-visible:` のアウトライン）。
ホバーでは枠線の色だけを変える。

## XSS

- 描写文・お題のタイトル・ユーザー名は `{value}` のまま置く。`dangerouslySetInnerHTML` は使わない
- `<img src>` は `cloudinaryUrlOrNull()`、ダウンロードの `<a href>` は `cloudinaryDownloadUrlOrNull()` の戻り値だけ
- `<Link href>` は `attemptDetailHref(数値)` と `postDetailHref(数値)` だけ。どちらも数値から組み立てる
- ログイン導線の `next` は `attemptDetailHref(id)`。ログイン画面が `safeNextPath()` で検証する

## テスト

CLAUDE.md の方針どおり、純粋な関数にだけ Vitest を書く。コンポーネントのテストは書かない（E2E は 8-1。
比較ビューでのいいねは 8-1 のコアループに含まれる）。backend は変えないので RSpec は追加しない。

- `test/lib/attempts/attempt-detail-query.test.ts`
  - `parseAttemptId`：`"1"` / `"007"` → 数値、`"0"` / `"-1"` / `"1.5"` / `"abc"` / `""` / `"1e3"` / 安全な整数を超える値 → null
    （`parsePostId` のテストと同じ表）
  - `attemptDetailHref(12)` → `/attempts/12`
- `test/lib/attempts/attempt-messages.test.ts` に追加
  - `toLikeErrorMessage`：401 / 404 / 422 `cannot_like_own_attempt` / 422 で別のコード・ボディが JSON でない 422
    （→ `toRequestErrorMessage` と同じ文言）/ 500 / `ApiTimeoutError` / `TypeError`

## 手動確認（ローカル）

1. お題詳細のカード（表彰台・みんなの挑戦の両方）から比較ビューへ移れる。キーボードでもフォーカスして移れる
2. 生成直後の結果パネルの「お題と見比べる」から比較ビューへ移れる
3. **期限切れのトークン**を `localStorage` に入れて公開済みの挑戦を開くと 200 で表示される（決定 1 の前提の実測）
4. 未ログイン：「ログインしていいね」→ ログイン → 同じ比較ビューに戻る。ダウンロードは出ない
5. 他人の挑戦：いいね → 数が増え、ボタンが押された状態になる → 解除で戻る。リロードしても状態が保たれる
6. **ログイン済みで比較ビューを直接ロード・リロード**しても、いいねの状態とボタンが正しい（Link 遷移だけだと
   ハイドレーションの経路が試されない。メモリの教訓）
7. 自分の挑戦：いいねボタンが無く数だけが出る。ダウンロードが出て、PNG で保存でき、macOS のプレビューで開ける
8. 失効：トークンを期限切れに差し替えていいね → トースト、ボタンが「ログインしていいね」に変わる
9. 他タブで挑戦を削除してからいいね → 「この挑戦は削除されました」
10. 未公開の自分の挑戦（下書きの id を rails runner で調べて直接開く）→ 「まだ公開されていません」
11. 存在しない id → 「見つかりませんでした」。`/attempts/abc` → Next の 404
12. backend を止めて開く → エラーと再試行。backend を起こして再試行 → 表示される
13. リンクのコピー：localhost でコピーできる。LAN の URL（http）では失敗のトーストが出る
14. 元画像を **16:9 と 3:4** にして見る（開発データは 64px の正方形だけ。メモリの教訓）。帯が左右・上下に出て、
    再現画像と同じ大きさの枠に収まる
15. スマホ幅：縦積みで元画像が上。横スクロールが出ない。操作の行が折り返す
16. 長い描写文（改行入り・空白の無い長い英数字）が全文表示され、はみ出さない

## リリース

- 環境変数・依存の追加は無い
- 本番にはお題が 0 件なので、本番での実データ確認は 7-5 以降。マージ後は Vercel のデプロイ成功と、
  既存の一覧・詳細が壊れていないこと（`/attempts/abc` が 404 になること）だけを確認する

## backlog への反映

7-4 に「決めたこと」として決定 2・3・4・6 を追記する。特に決定 3（カードにいいねを足さない）は申し送りを
覆すので、理由とともに残す。
