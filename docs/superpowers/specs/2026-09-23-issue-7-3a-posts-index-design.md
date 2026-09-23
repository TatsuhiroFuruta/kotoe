# issue 7-3a お題一覧・検索（/posts） 設計

- 対象 issue：`docs/issues_backlog.md` 7-3a（GitHub #114。#24「7-3」を割った 2 つ目）
- 依存：7-1（`apiRequest`）、3-2（`GET /api/posts`）、7-2.7（timeout・`buttonClasses()`）
- 作成日：2026-09-23
- 前提：`frontend/AGENTS.md`（Next 16.2.10 の API は型定義とコンパイル済み実装を直接読む）
- 前提：CLAUDE.md「XSS：React の自動エスケープを迂回しない」
- 前提：CLAUDE.md「テスト戦略」（フロントは純粋ロジックにだけ Vitest）

## この issue で作るもの

1. `/posts`：検索バー・新着／人気の並び替え・カードグリッド・ページ送り（12 件／頁）・空状態
2. Cloudinary の配信 URL を組み立てるヘルパ `cloudinaryUrl()`（7-3b・7-4・7-6 が使い回す）
3. ナビの「探す」→ `/posts` と、トップの CTA「お題を探す」（7-2.7 から持ち越し）
4. 通信エラーの文言を auth の辞書から切り出す（一覧でも同じ文言が要るため）

## 調べて分かったこと（2026-09-23 実測）

| 確認したこと | 結果 |
|---|---|
| `GET /api/posts` の応答 | `{ posts: PostSummary[], meta: { current_page, total_pages, total_count } }`。件数は kaminari で 12 固定（`max_per_page` も 12）なので `per` は送らない |
| `sort` の受け付け | `"popular"` だけを見て、それ以外はすべて新着順（`Post.listing`） |
| `page` の受け付け | サーバー側で `1..1_000_000` に丸める（`Paginating#page_param`） |
| 壊れた JWT を付けた `GET /api/posts` | **200** |
| **期限切れ**の JWT を付けた `GET /api/posts` | **200**（`rails runner` で署名の正しい期限切れトークンを作って確認） |
| `page.tsx` の `searchParams` | **Promise の prop**（next 16.2.10 の `next-types-plugin` で確認）。`useSearchParams()` と違い `<Suspense>` 境界を要求しない |
| `next/form` | next 16.2.10 に同梱。`action` が文字列なら GET フォームをクライアント遷移に変える。ハイドレーション前は普通の GET フォームとして動く |
| Cloudinary の `public_id` | `kotoe/<Rails.env>/posts/<id>` の形（`Images::Uploader`）。**`/` を含む** |

期限切れトークンで 200 が返るのが効いている。一覧は `auth.status` を待たずに取得を始めてよい。
もし 401 が返るなら、`api.ts` がトークンを捨てたうえで一覧まで失敗し、毎日（JWT は 24 時間固定）
再訪ユーザーの一覧が一度壊れるところだった。

## 決めたこと

### 決定 1：一覧はクライアントで取得する

`page.tsx` はサーバーコンポーネントのまま `searchParams` を受けて正規化するだけにする。
取得はクライアントコンポーネントの `useEffect` から `apiFetch` で行う。

| | クライアント取得（採用） | サーバーコンポーネントで取得 |
|---|---|---|
| Render がスリープ中の初回 | ヘッダーとスケルトンがすぐ出る。15 秒で `ApiTimeoutError`、再試行できる | **最大約 60 秒真っ白**、または Vercel 関数のタイムアウト |
| 既存の部品 | `api.ts`・`tokenStore`・`ApiTimeoutError` をそのまま使える | サーバー用クライアントが別に要る。docker 内では `localhost:3000` が backend に届かないので、ベース URL の環境変数も分かれる |
| SEO / 初回 HTML | 中身の無い殻 | 中身入り |

MVP は無料枠で動いており、スリープ復帰は毎日起きる。SEO と OGP は 8-3 でまとめて扱う。

### 決定 2：状態は URL だけに持たせる

`/posts?q=猫&sort=popular&page=2`。リロード・戻る・URL の共有で状態が保たれる。
画面が持つクライアント状態は**取得結果だけ**（loading / success / error）。

| 操作 | 部品 | q | sort | page |
|---|---|---|---|---|
| 検索 | `next/form` の `<Form action="/posts">` | 入力値 | hidden で引き継ぐ | 1 に戻す（送らない） |
| 並び替え | `<Link>` × 2 | 引き継ぐ | 切り替える | 1 に戻す |
| ページ送り | `<Link>` | 引き継ぐ | 引き継ぐ | ±1 |

`<Link>` で同じ `/posts` のクエリだけが変わると、Next はサーバーコンポーネントを再描画し、
新しい `searchParams` が props としてクライアントコンポーネントへ降りてくる。
`useEffect` の依存配列を正規化後の `q` / `sort` / `page` にすれば取り直しが起きる。
`useSearchParams()` は使わない（7-2 の規約。Vercel の本番ビルドだけ落ちる）。

### 決定 3：検索は送信で発火する（入力に合わせた自動検索はしない）

| | 送信で検索（採用） | 入力に合わせて自動（debounce） |
|---|---|---|
| リクエスト数 | 検索 1 回につき 1 回 | 打鍵ごと。**日本語 IME の変換途中でも発火しやすい** |
| 戻るボタン | 検索 1 回ぶん | `replace` にしないと 1 文字ずつ積まれる |
| 実装 | `<Form>` だけ | 入力の state・タイマー・古い応答の破棄・`compositionend` |

### 決定 4：画像は `<img>` ＋ Cloudinary の変換 URL（`next/image` は使わない）

無料枠（2026-09 時点）：

- **Cloudinary Free**：月 25 クレジット。1 クレジット＝1,000 変換／1 GB 保存／1 GB 配信のいずれか。
  **3 つで同じ枠を分け合う**。変換は派生画像（サイズ×形式）1 つにつき初回に 1 回数える。
  超過すると課金されず、**翌月まで変換と配信が止まる**
- **Vercel Hobby の Image Optimization**：月 5,000 変換。超過分は 402

| | `<img>` ＋変換 URL（採用） | `next/image`（Vercel 最適化） | `next/image` ＋カスタムローダー |
|---|---|---|---|
| お題 1 件の変換数 | 1 サイズ × `f_auto` の形式 ≒ **1〜3** | Cloudinary 0 ＋ Vercel 側に数件 | `deviceSizes` 8 幅 × 形式 ≒ **8〜24** |
| お題 100 件 | 約 100〜300（25,000 のうち） | Vercel の 5,000 枠を消費。原本配信で Cloudinary の GB も増える | 約 800〜2,400。7-3b・7-4 の画像も同じ倍率 |

`next/image` の Vercel 最適化は同じ画像を 2 つのサービスで二重に処理し、2 つの枠を両方消費する。
カスタムローダーは「画像が 1 枚増えると変換がまとめて増える」構造で、止まるときは翌月まで全画像が止まる。
カードは最大 3 列・幅 320px 程度なので、Retina でも 640px の 1 本で足りる。

`@next/next/no-img-element` の警告は、`PostCard` の該当行でだけ理由を書いて抑える。

### 決定 5：ページ送りは「前へ｜2 / 5｜次へ」

`total_pages` は返ってくるので番号列も作れるが、12 件／頁で MVP のお題数なら現在位置と前後で足りる。
省略記号付きの番号列は窓の計算が要るので YAGNI とする。端では `<Link>` を出さず、
押せない見た目の `<span>`（`aria-disabled`）にする（`<Link>` に disabled は無い）。

### 決定 6：カードは今回はリンクにしない

`/posts/[id]` は 7-3b まで存在しない。main は Vercel の本番を追跡しているので、リンクを置くと
**本番で 404 になる**（`SiteHeader` のコメントにある規約と同じ判断）。`PostCard` に
「7-3b がここを `<Link href={`/posts/${post.id}`}>` で包む」とコメントで残す。

### 決定 7：通信エラーの文言を `lib/request-error-messages.ts` へ切り出す

タイムアウト・通信断・5xx の文言は、今は `lib/auth/error-messages.ts` の中にしか無い。
一覧でも同じ文言が要るので、同じ文を 2 箇所に書かないために切り出す。

```ts
// lib/request-error-messages.ts
export const TIMEOUT_MESSAGE = "サーバーの応答がありません。起動中の可能性があるので、少し待ってから再度お試しください";
export const NETWORK_MESSAGE = "サーバーに接続できませんでした。通信環境を確認してください";
export const SERVER_MESSAGE = "サーバーでエラーが発生しました。時間をおいて再度お試しください";

/** 認証に依存しない取得（一覧など）の失敗を 1 文にする。 */
export function toRequestErrorMessage(error: unknown): string
```

`toRequestErrorMessage` の振り分けは `toAuthFormErrors` の末尾と同じ順序にする：
`ApiTimeoutError` → TIMEOUT、`ApiError` → SERVER、`TypeError` → NETWORK、
それ以外 → `console.error` を残して「読み込みに失敗しました。時間をおいて再度お試しください」。
auth 側は 3 定数を import に置き換えるだけで、**振る舞いは変えない**
（既存の `error-messages.test.ts` がそのまま通ることで確認する）。

## 構成

```
frontend/src/
├── app/posts/page.tsx                  … サーバーコンポーネント。searchParams → parsePostsQuery → <PostList>
├── components/posts/
│   ├── post-list.tsx                   … "use client"。取得・状態の出し分け
│   ├── post-search-form.tsx            … <Form action="/posts">
│   ├── post-sort-toggle.tsx            … 新着／人気の <Link>
│   ├── post-card.tsx                   … サムネイル・タイトル・投稿者・挑戦数・いいね合計
│   └── pagination.tsx                  … 前へ｜n / N｜次へ
├── lib/
│   ├── posts/posts-query.ts            … 正規化と URL 組み立て（純粋関数）
│   ├── cloudinary.ts                   … cloudinaryUrl()（純粋関数）
│   └── request-error-messages.ts       … 決定 7
└── types/api.ts                        … PostSummary / PaginationMeta / PostsIndexResponse を追加
```

### `lib/posts/posts-query.ts`

```ts
export type PostsSort = "recent" | "popular";
export type PostsQuery = { q: string; sort: PostsSort; page: number };

/** URL から来る任意の値を正規化する。どんな入力でも例外を投げない。 */
export function parsePostsQuery(params: Record<string, string | string[] | undefined>): PostsQuery

/** 画面の URL。既定値（q 空・sort recent・page 1）のパラメータは省く。 */
export function postsHref(query: Partial<PostsQuery>): string

/** API のパス。画面の URL と同じ正規化を通す。 */
export function postsApiPath(query: PostsQuery): string
```

- `sort`：`"popular"` のときだけ popular、それ以外（不正値・配列・未指定）は recent
- `page`：`/^\d+$/` に一致し 1 以上の値だけを採用、それ以外は 1。上限はサーバー（`MAX_PAGE`）に任せる
- `q`：前後の空白を落とす。配列なら先頭を使う
- 配列が来るのは `?sort=a&sort=b` のとき（Next の `searchParams` の型が `string | string[]`）

画面の URL と API のパスを同じモジュールで作るのは、並び替えの値を片方だけ変えて
「画面は人気順と表示しているのに新着順が返る」ずれを防ぐため。

### `lib/cloudinary.ts`

```ts
export function cloudinaryUrl(publicId: string, options: { width: number; aspect: "4:3" | "1:1" }): string
// → https://res.cloudinary.com/<cloud>/image/upload/c_fill,ar_4:3,w_640,f_auto,q_auto/<public_id>
```

- cloud name は `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`。未設定なら例外（`api.ts` の `NEXT_PUBLIC_API_BASE_URL` と同じ扱い）
- `public_id` は `/` で分割し、**セグメントごとに `encodeURIComponent`** して `/` で戻す。
  `..` のセグメントもエンコードで無害化されるわけではないので、`.` / `..` のセグメントは例外にする
- **オリジンは `https://res.cloudinary.com` に固定**。`public_id` にどんな値が来ても
  `javascript:` や別オリジンにはならない（CLAUDE.md の XSS 2 経路目への対処）
- `aspect` はリテラル型に絞る。いま要るのは一覧の 4:3 だけだが、7-4 の比較で 1:1 を使う見込みなので型に入れておく
  （変換文字列を呼び出し側に自由に書かせない）
- ダウンロード URL（`f_png` + `fl_attachment`、4-3 からの申し送り）は 7-3b / 7-4 で要るときに足す

## 画面の状態

| 状態 | 表示 |
|---|---|
| 取得中 | カードと同寸のスケルトン 12 枚、`aria-busy="true"`。並び替え・ページ送りのたびにもスケルトンへ戻す（前の結果を薄く残す案は状態が増えるので採らない） |
| 成功 | 「全 N 件」＋カードグリッド（`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`）＋ページ送り |
| 0 件・検索あり | 「『{q}』に一致するお題はありません。条件を変えて探してみましょう」＋「検索をクリア」（`postsHref({ sort })`） |
| 0 件・検索なし | 「まだお題がありません」。投稿導線は置かない（`/posts/new` は 7-5） |
| 範囲外のページ | `posts` が空で `total_count > 0`。「このページにはお題がありません」＋ 1 ページ目へのリンク |
| 失敗 | 一覧の位置にエラー枠：`toRequestErrorMessage(error)` ＋「再試行」ボタン。**トーストにしない**（再試行という操作が要り、数秒で消えては困る） |

- 取得は `AbortController` を effect ごとに作り、cleanup で `abort()`。クエリが素早く変わったとき
  古い応答が新しい結果を上書きしないため。`AbortError` は失敗として扱わない
- 「再試行」は同じクエリで取り直す（effect の依存に再試行カウンタを足す）
- 検索語 `q` を空状態の文言に出すのは `{q}` のまま（React がエスケープする）

## ナビと CTA

- `SiteHeader`：ロゴの隣（中央のコメント位置）に「探す」→ `/posts`。認証状態に関係なく出す
- トップ（`page.tsx`）：CTA「お題を探す」→ `/posts` を**常時**出す（一覧は誰でも見られる）。
  既存の「新規登録／ログイン」は今まで通り `unauthenticated` のときだけ
- どちらも「7-3 が足す」のコメントを実物に置き換える。7-5 / 7-6 / 7-7 のぶんのコメントは残す

## メタデータ

- `layout.tsx` の `metadata.title` を `{ default: "Kotoe（言絵）", template: "%s | Kotoe（言絵）" }` にする
- `posts/page.tsx` から `title: "お題を探す"`

## XSS

- `title` / `user.name` は `{value}` で出すだけ。`dangerouslySetInnerHTML` は使わない（eslint が止める）
- `<img src>` に入れるのは `cloudinaryUrl()` の戻り値だけ（オリジン固定）
- `alt={post.title}`（属性値も React がエスケープする）

## テスト

CLAUDE.md の方針どおり、純粋な関数にだけ Vitest を書く。コンポーネントのテストは書かない（E2E は 8-1）。

- `test/lib/posts/posts-query.test.ts`
  - `sort`：不正値・配列・未指定 → recent、`"popular"` → popular
  - `page`：`"0"` / `"-1"` / `"abc"` / `"2.5"` / `""` / 配列 → 1、`"3"` → 3
  - `q`：前後の空白・空文字・配列
  - `postsHref`：既定値を省く（`{}` → `/posts`）、`&` `#` `?` を含む検索語をエンコードする
  - **往復**：`parsePostsQuery(postsHref(x) のクエリ)` が `x` に戻る
  - `postsApiPath`：`sort: "popular"` がクエリに**乗る**こと、`recent` のとき `sort` を送らないこと
- `test/lib/cloudinary.test.ts`
  - 変換文字列の組み立て、`/` を含む `public_id` がパスとして残る
  - `?` `#` `%` がエンコードされる、`.` / `..` のセグメントは例外
  - 戻り値のオリジンが常に `https://res.cloudinary.com`
  - cloud name 未設定で例外（`vi.stubEnv`）
- `test/lib/request-error-messages.test.ts`：4 分岐の振り分け
- 既存の `test/lib/auth/error-messages.test.ts` は変更せずに通ること（決定 7 の回帰確認）

並び替えそのもの（いいね順の正しさ）は API 側の責務で、6-1 の request spec が守っている。
フロントの責務は「`popular` を API に渡すこと」なので、`postsApiPath` のテストでそこを押さえる。

## 手動確認（ローカル）

- 検索 → 並び替え → ページ送りをすべて URL 経由で行い、**リロードと戻るボタン**で状態が戻る
- `/posts?page=2&sort=popular` を**直接ロード**する（`<Link>` 遷移だけだとハイドレーション経路が露出しない）
- 人気順と新着順が**逆の並び**になるデータで見比べる（いいねの多いお題を**古く**作る。
  作成順と同じ向きだと、フロントが `sort` を渡し忘れていても並びが一致して気づけない）
- `docker compose pause backend` でタイムアウト表示と再試行（`stop` だと即座に通信断になり timeout の経路を通らない）
- 0 件（検索あり／なし）・`?page=99`・`?page=abc`・スマホ幅（1 列）
- ログイン済み・未ログインの両方で表示が同じ

## 環境変数とリリース

- `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` を `frontend/.env.example` に足す。ローカルの
  `frontend/.env.development` にも足す（値はバックの `CLOUDINARY_URL` の `@` 以降と同じ公開値）
- **Vercel の Production と Preview の両方に、マージ前に設定する。** `NEXT_PUBLIC_*` は
  ビルド時に埋め込まれるので、未設定でマージすると本番の一覧で `cloudinaryUrl()` が例外を投げる。
  PR 本文のチェックリストに入れる
- 依存の追加は無い（`next/form` は next 同梱）

## ドキュメントの後始末（同じ PR）

- `docs/issues_backlog.md`
  - 7-3a のタスクを完了にする
  - 7-3b への申し送り：カードを `<Link>` で包む／`cloudinaryUrl()` を使う（ダウンロード URL はそこで足す）／
    `components/dev/health-panel.tsx` のトースト確認用ボタンを削除する（7-3b がトーストの初の実利用のため）
  - 8-5：`img-src` に `https://res.cloudinary.com` を確定値として書く

## この issue で作らないもの

- 一覧のお気に入りボタン（型には `favorited` を載せるが描画しない）
- カードのクリック遷移（7-3b）
- ページ番号の列
- お題の投稿導線（7-5）
- トースト確認用ボタンの削除（7-3b。上の申し送り）
