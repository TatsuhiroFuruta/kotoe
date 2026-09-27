# issue 7-3b お題詳細の閲覧（/posts/[id]） 設計

- 対象 issue：`docs/issues_backlog.md` 7-3b（GitHub #115）
- 依存：7-3a（`cloudinaryUrl()`・一覧の取得パターン）、6-1（`best_attempts`）、5-2（お気に入り API）、7-2.5（トースト）
- 作成日：2026-09-27
- 前提：`frontend/AGENTS.md`（Next 16.2.10 の API は型定義とコンパイル済み実装を直接読む）
- 前提：CLAUDE.md「XSS：React の自動エスケープを迂回しない」「テスト戦略」
- 前提：7-3a の設計書（`2026-09-23-issue-7-3a-posts-index-design.md`）の決定 1・2・4・5 をそのまま引き継ぐ

## 分割の経緯

当初の 7-3b は「閲覧＋描写入力＋生成ポーリング」だった。数えると約 16〜18 ファイルになり、
7-3 を割ったときの理由（20 ファイル規模の PR は「1 issue = 1 PR」と釣り合わない）の境界に
近いので、**閲覧（7-3b・#115）**と**描写・生成（7-3c・#120）**に再分割した（2026-09-27）。

設計は分割前に全体を通して合意している。7-3c ぶんの決定事項は失われないよう
`docs/issues_backlog.md` の 7-3c に「決めたこと」として先に記録する（この PR に含める）。

## この issue で作るもの

1. `/posts/[id]`：元画像・タイトル・投稿者・お気に入りボタン・ベスト再現（表彰台）・
   みんなの挑戦（再現度順／新着順・ページ送り）・404・通信エラー・空状態
2. 一覧のカードから詳細へのリンク（7-3a からの申し送り）
3. `Pagination` と並び替えトグルを、一覧と詳細で共有できる形にする
4. `cloudinaryUrl()` に「切り抜かない」指定を足す（元画像のヒーロー用）
5. `health-panel.tsx` のトースト確認用ボタンの削除（お気に入り失敗の `toast.error` がトーストの初の実利用になるため）

## 調べて分かったこと（2026-09-27 実測）

| 確認したこと | 結果 |
|---|---|
| `GET /api/posts/:id` の応答 | `{ post, best_attempts, attempts, meta }`。`post` は一覧と同じ `PostSerializer`、挑戦は `AttemptSerializer` |
| 挑戦 0 件のときの `meta` | `{ current_page: 1, total_pages: 0, total_count: 0 }`。**`total_pages` が 0** になる |
| `sort` の受け付け | `"likes"` だけを見て、それ以外はすべて新着順（`Attempt.listing_for`）。お題一覧の `"popular"` とは値が違う |
| `id` が `999999` / `abc` / `0` / `-1` / `1.5` / `99999999999999999999` | すべて **404**（500 にならない） |
| **期限切れ**の JWT を付けた `GET /api/posts/:id` | **200**（`rails runner` で署名の正しい期限切れトークンを作って確認）。`GET /api/me` は 401 |
| 期限切れの JWT で `POST /api/posts/:id/favorite` | **401** `{"error":"unauthorized"}`。`api.ts` がトークンを捨てる |
| 未認証の `POST /api/posts/:id/favorite` | 401 |
| お気に入りの応答 | `{ post }`（更新後の `favorited` を含む）。POST・DELETE とも冪等で 200 |
| `page.tsx` の `params` | `Promise<{ id: string }>`（`next-types-plugin` の `PageProps`） |
| `notFound()` | `next/navigation` から import できる。自前の `app/not-found.tsx` が描画される |
| ローカル DB の公開済み挑戦 | **0 件**。手動確認用のデータを作る必要がある（「手動確認」参照） |

期限切れトークンで詳細が 200 を返すので、7-3a と同じく `auth.status` を待たずに取得を始めてよい。
詳細の `favorited` はトークン依存だが、取得は `tokenStore` のトークンを載せるので、`auth.status` の
確定を待たなくても正しい値が返る。

## 決めたこと

### 決定 1：取得は 1 本、クライアントで行う（7-3a の決定 1 を踏襲）

`app/posts/[id]/page.tsx` はサーバーコンポーネントのまま `params` と `searchParams` を正規化して渡すだけにする。
取得は `PostDetail`（client）が `GET /api/posts/:id?sort&page` を**1 本だけ**呼ぶ。

- 並び替え・ページ送りのたびに表彰台とお題本体も取り直すことになるが、表彰台はページングを持たない
  3 件だけなので許容する。分けるとお題本体を 2 回引く口が要る
- `id` が正の整数の文字列でなければ、API を呼ばずに `notFound()` を返す（下の `parsePostId`）

### 決定 2：再取得中は直前のデータを出し続ける（7-3c の前提）

7-3a の一覧は「クエリが変わったら全体をスケルトンに戻す」だったが、詳細ではそうしない。
**同じお題の再取得（並び替え・ページ送り・再試行）では、直前に成功したデータでヒーローと表彰台を出し続け、
みんなの挑戦の部分だけを読み込み中にする。**

理由は 7-3c の描写フォーム。フォームは書きかけの文面と生成中のポーリングを持つので、
並び替えのたびにアンマウントされると両方が消える。7-3b の時点でこの構造にしておけば、7-3c は
ヒーローとみんなの挑戦の間にフォームを差し込むだけで済む。

| 状況 | ヒーロー・表彰台 | みんなの挑戦 |
|---|---|---|
| 初回の取得中 | スケルトン | スケルトン |
| 同じお題の再取得中 | 直前のデータ | スケルトン（`aria-busy`） |
| 再取得の失敗 | 直前のデータ | エラー枠＋再試行 |
| 初回の失敗（404 以外） | エラー枠＋再試行（ページ全体） | ― |
| 404 | 「お題が見つかりませんでした」＋一覧への導線（ページ全体） | ― |

「直前のデータ」は**お題 id が一致するときだけ**使う。別のお題へ遷移したときに前のお題の画像を
出さないため（実際には `[id]` が変わると Next がページを作り直すが、前提に頼らず id で判定する）。

結果の持ち方は 7-3a と同じく「どのリクエストに対する結果か」を表す key と一緒に持ち、
今の key と一致しない応答は表示しない（effect の中で同期的に `setState` しない。
`react-hooks/set-state-in-effect` と古い応答の上書きの両方を避ける）。

### 決定 3：表彰台には `likes_count > 0` の挑戦だけを載せる

`best_attempts` は「いいね上位 3 件」だが、全員 0 件のときは実質「新着 3 件」になる
（6-1：「全員 0 なら表彰台を出さない」は見せ方の判断なのでフロントが決める）。
見出しが「ベスト再現」なのに新着が並ぶのは嘘になるので、**`likes_count > 0` のものだけを載せ、
0 件になったらセクションごと出さない**。1〜2 件なら、その件数だけ出す。

表彰台の挑戦は、みんなの挑戦にも重複して出る（6-1 の申し送り。一覧から除くと `total_count` と
OFFSET がずれる）。重複は仕様として受け入れる。

レイアウト：`sm` 以上は 2 位・1 位・3 位の順に横並びで、1 位を大きくする。スマホ幅は 1 位・2 位・3 位の縦並び。
DOM の順序は常に 1・2・3 位にし、横並びの配置は `col-start` と `row-start-1` で列を名指しする
（読み上げ順が順位と一致するように）。**`order` は使わない**。`order` は並び順を変えるだけで
自動配置は左の列から詰めるため、表彰台が 1〜2 件のとき 1 位が左端に寄る（最終レビューで判明、
`905969e` で修正）。いいねが少ない MVP では 1〜2 件が普通の状態になる。

### 決定 4：元画像は切り抜かない

お題の元画像は**描写の対象そのもの**なので、4:3 に切り抜くと描写すべき部分が見えなくなる。
`cloudinaryUrl()` の `aspect` を省略可能にし、省略時は `c_fit`（幅×幅の正方形に縦横比を保って収める。
小さい画像は拡大、大きい画像は縮小する）にする。

```ts
cloudinaryUrl(publicId, { width: 1280 })            // → c_fit,w_1280,h_1280,f_auto,q_auto
cloudinaryUrl(publicId, { width: 640, aspect: "1:1" }) // → c_fill,ar_1:1,w_640,f_auto,q_auto（従来どおり）
```

- ヒーローは幅 1280 の 1 本（本文の最大幅 `max-w-5xl` ≒ 1024px を Retina で少し下回るが、
  変換数と転送量を抑える。7-3a の決定 4 の「1 画像 1 サイズ」）
- **表示の枠は画像ごとの縦横比にする**（`w-auto h-auto max-w-full max-h-[70vh] mx-auto`）。横幅は本文の幅まで、
  高さは 70vh までに縮めて中央に置く。お題ごとにヒーローの高さは変わる
- 経緯（2026-09-27、ユーザー確認済み）：最初は `c_limit`（拡大しない）で実装したが、開発データの 64px の画像が
  切手大になった。そこで枠を本文の幅に固定（`w-full` ＋ `object-contain`）したところ、横長（約 1.7:1 より横長）
  以外の画像では左右に枠の背景がグレーの帯として出た。4:3・正方形・縦長の写真で必ず出るので、拡大は
  Cloudinary の `c_fit` に任せ、枠は画像の形に合わせる形に落ち着いた。高さにも上限（`h_1280`）が付くので、
  縦に極端に長い画像を実寸のまま転送することもない
- 枠を固定して余白を地の色にする案は不採用。縦長の画像が枠の中で小さくなり、描写の対象を最大限大きく見せられない
- 一覧のサムネイルは 4:3 の切り抜きのまま（一覧はグリッドを揃えることが優先で、全体は詳細で見られる）

生成画像は 1024×1024 の正方形（4-3）なので、表彰台とみんなの挑戦はどちらも `{ width: 640, aspect: "1:1" }` に揃える。
**同じ変換にすれば Cloudinary の派生画像が 1 つで済む**（表彰台と一覧に同じ挑戦が出ても変換数は増えない）。

### 決定 5：お気に入りは応答で確定させる（楽観更新しない）

| 認証状態 | 表示 |
|---|---|
| `loading` | ボタンを disabled |
| `authenticated` | トグルボタン（`aria-pressed`）。押している間は disabled |
| `unauthenticated` | 「ログインしてお気に入り」→ `/login?next=/posts/<id>` |
| `unreachable` | ボタンは出す。押して失敗すれば下の表のとおり |

- 押したら `POST` / `DELETE /api/posts/:id/favorite` を送り、**応答の `post.favorited` で表示を確定**する。
  API は冪等で、応答が真の状態を返すため、楽観更新の巻き戻しロジックを持つ理由が無い
- 失敗は**無言にしない**（backlog 7-3b：7-2.6 が未着手のうちの最低限）。`toast.error` を出し、表示は変えない

| 失敗 | 文言 |
|---|---|
| 401 | `error-messages.ts` の `unauthorized`（「セッションの有効期限が切れました。もう一度ログインしてください」）。`api.ts` がトークンを捨てるので、ボタンは「ログインしてお気に入り」に変わる |
| 404 | 「このお題は削除されました」 |
| それ以外 | `toRequestErrorMessage(error)` |

`unauthorized` の文言は今 `error-messages.ts` の中の辞書にしか無い。これを export して使う
（文言を 2 箇所に書かない）。

### 決定 6：並び替えとページ送りは URL に持たせる（7-3a の決定 2 を踏襲）

`/posts/9?sort=likes&page=2`。既定値（新着順・1 ページ目）は省く。画面の URL と API のパスは
`lib/posts/post-detail-query.ts` の同じ関数から組み立てる（`posts-query.ts` と同じ理由）。

並び替えのラベルは「新着順」「再現度順」（`sort=likes`）。デザインブリーフの
「再現度順（いいね順）／新着順」に合わせる。既定は新着順（API の既定と揃える）。

**みんなの挑戦のリンク（並び替え・ページ送り・「1 ページ目へ」）には見出しへの断片
`#attempts-heading` を付ける**（`attemptsSectionHref()`）。断片が無いと Next はクエリの変わった
ページの先頭へスクロールし、押すたびに高さ 70vh のヒーローと表彰台の上まで戻される
（最終レビューで判明、`905969e` で修正）。**7-3c で描写フォームを見出しの上に入れると、
戻される距離がさらに延びる**ので、この断片を外さないこと。見出しは再取得中もアンマウント
されない（決定 2）ので行き先として使える。見出しには `tabIndex={-1}` を付ける。Next は断片の
行き先に `focus()` を呼ぶが、見出しは既定でフォーカスできず、押したリンク（再取得中は
アンマウントされる）と一緒にフォーカスが `body` へ落ちるため。

### 決定 7：`Pagination` と並び替えトグルを共有部品にする

今の `Pagination` と `PostSortToggle` は `postsHref` に直結している。詳細でも同じ見た目の部品が要るので、
**URL の組み立てを呼び出し側に出す**。

```ts
// components/ui/pagination.tsx（components/posts/ から移す）
Pagination({ page, totalPages, hrefFor }: { page: number; totalPages: number; hrefFor: (page: number) => string })

// components/ui/sort-toggle.tsx（新規）。PostSortToggle はこれに置き換えて削除する
SortToggle({ options }: { options: { label: string; href: string; active: boolean }[] })
```

見た目と挙動（端の `aria-disabled`、`aria-current="true"`、読み上げ用のラベル）は変えない。
一覧の手動確認で回帰を見る。

### 決定 8：挑戦カードはリンクにしない・いいねボタンを置かない

- `/attempts/[id]` は 7-4 まで存在しない。main は Vercel の本番を追跡しているので、リンクにすると本番で 404 になる
  （7-3a の決定 6 と同じ判断）。`AttemptCard` にコメントで場所を残し、7-4 への申し送りに書く
- いいねボタンは 7-4（比較ビューでいいねを実装する回）に回す。カードには数だけ出す
- 自分の挑戦カードの削除メニュー（デザインブリーフ 3-B）は 7-6 に回す

## 構成

```
frontend/src/
├── app/posts/[id]/page.tsx              … サーバーコンポーネント。parsePostId → notFound()／parsePostDetailQuery → <PostDetail>
├── components/
│   ├── posts/
│   │   ├── post-detail.tsx              … "use client"。取得・決定 2 の出し分け
│   │   ├── post-hero.tsx                … 元画像・タイトル・投稿者・FavoriteButton
│   │   ├── favorite-button.tsx          … 決定 5
│   │   ├── post-card.tsx                … <Link> で包む（変更）
│   │   ├── post-list.tsx                … Pagination / SortToggle の呼び出しを変更
│   │   └── post-sort-toggle.tsx         … 削除（SortToggle に置き換え）
│   ├── attempts/
│   │   ├── best-attempts.tsx            … 決定 3
│   │   ├── attempt-list.tsx             … 並び替え・グリッド・ページ送り・空状態
│   │   └── attempt-card.tsx             … 生成画像・描写文（3 行で省略）・挑戦者・いいね数
│   ├── ui/
│   │   ├── pagination.tsx               … components/posts/ から移動・一般化
│   │   └── sort-toggle.tsx              … 新規
│   └── dev/health-panel.tsx             … トースト確認用ボタンを削除
├── lib/
│   ├── posts/post-detail-query.ts       … 正規化と URL 組み立て（純粋関数）
│   ├── cloudinary.ts                    … aspect を省略可能に（決定 4）
│   └── auth/error-messages.ts           … unauthorized の文言を export
└── types/api.ts                         … Attempt / PostDetailResponse / FavoriteResponse を追加
```

### `lib/posts/post-detail-query.ts`

```ts
export type AttemptsSort = "recent" | "likes";
export type PostDetailQuery = { sort: AttemptsSort; page: number };

/** URL の [id]。正の安全な整数の文字列だけを受け付け、それ以外は null（page.tsx が notFound() にする）。 */
export function parsePostId(raw: string): number | null

/** URL から来る任意の値を正規化する。どんな入力でも例外を投げない。 */
export function parsePostDetailQuery(params: RawSearchParams): PostDetailQuery

/** 画面の URL。既定値（recent・1 ページ目）は省く。 */
export function postDetailHref(id: number, query?: Partial<PostDetailQuery>): string

/** API のパス。画面の URL と同じ規則で組み立てる。 */
export function postDetailApiPath(id: number, query: PostDetailQuery): string
```

- `sort`：`"likes"` のときだけ likes、それ以外は recent。配列は先頭で判定
- `page`：`posts-query.ts` と同じ規則（`/^\d+$/`・1 以上・安全な整数）。**判定関数は `posts-query.ts` から切り出して共有する**
  （同じ規則を 2 箇所に書くと、片方だけ直したときにずれる）
- `parsePostId`：`/^\d+$/` かつ 1 以上かつ `Number.isSafeInteger`。`"007"` は 7 として受け付ける
  （API も 7 として扱う。正規化の URL へのリダイレクトはしない）

### 型（`types/api.ts`）

```ts
export type AttemptStatus = "draft" | "generating" | "published" | "failed";

/** 挑戦 1 件（AttemptSerializer）。 */
export type Attempt = {
  id: number;
  description: string;
  /** published 以外は null。表示には必ず cloudinaryUrl() を通す */
  generated_image_public_id: string | null;
  status: AttemptStatus;
  failure_reason: string | null;   // 7-3c でリテラル型に絞る
  similarity_score: number | null; // 8-4 まで常に null。描画しない
  user: PublicUser;
  likes_count: number;
  liked: boolean;                  // 7-4 まで描画しない
  created_at: string;
};

/** GET /api/posts/:id。meta は attempts のページングだけを指す（best_attempts はページングを持たない）。 */
export type PostDetailResponse = { post: PostSummary; best_attempts: Attempt[]; attempts: Attempt[]; meta: PaginationMeta };

/** POST / DELETE /api/posts/:id/favorite */
export type FavoriteResponse = { post: PostSummary };
```

## 画面

上から順に：

1. **ヒーロー**：元画像（決定 4）→ タイトル（`h1`）→ 投稿者名・挑戦数・いいね合計 → お気に入りボタン
2. **ベスト再現**（決定 3。0 件なら出さない）：`h2`「このお題のベスト再現」。各枠に順位・生成画像・挑戦者名・いいね数
3. （7-3c：描写フォームがここに入る。7-3b では何も置かない）
4. **みんなの挑戦**：`h2`「みんなの挑戦」＋「全 N 件」＋並び替え → グリッド（`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`）→ ページ送り

| みんなの挑戦の状態 | 表示 |
|---|---|
| 0 件（`total_count === 0`） | 「まだ挑戦がありません」。7-3b では描写の導線を置かない（フォームは 7-3c） |
| 範囲外のページ（空かつ `total_count > 0`） | 「このページには挑戦がありません」＋「1 ページ目へ」 |
| 取得中・失敗 | 決定 2 の表 |

`total_pages` は 0 件のとき 0 で返る。`Pagination` は `totalPages <= 1` で何も描かないので、そのまま渡してよい。

### メタデータ

`title: "お題"`（テンプレートで「お題 | Kotoe（言絵）」）。お題のタイトルを入れるには
サーバーでの取得（`generateMetadata`）が要り、決定 1 と衝突する。OGP とあわせて 8-3 で扱う。

## XSS

- `title` / `user.name` / `description` は `{value}` で出す。`dangerouslySetInnerHTML` は使わない（eslint が止める）
- **描写文の改行は `whitespace-pre-wrap` で反映する**（`replace(/\n/g, "<br>")` は XSS）。
  カードでは `line-clamp-3` と併用する。長い英数字の連続は `wrap-break-word`
- `<img src>` に入れるのは `cloudinaryUrlOrNull()` の戻り値だけ（オリジン固定）。組み立てられないときは同寸の空枠
- `href` に入る変数は `id`（`parsePostId` を通した整数）と、`postDetailHref` / `postsHref` が組み立てた値だけ
- ログイン導線の `next` は `postDetailHref(id)` の値（アプリ内パス。並び替えとページは引き継がない）。
  `URLSearchParams` で組み立ててエンコードする。ログイン画面側は既存の `safeNextPath()` で検証される

## テスト

CLAUDE.md の方針どおり、純粋な関数にだけ Vitest を書く。コンポーネントのテストは書かない（E2E は 8-1）。

- `test/lib/posts/post-detail-query.test.ts`
  - `parsePostId`：`"1"` → 1、`"007"` → 7、`"0"` / `"-1"` / `"1.5"` / `"abc"` / `""` / `"1e3"` / 安全な整数を超える値 → null
  - `sort`：`"likes"` → likes、`"popular"`（一覧の値）・不正値・未指定 → recent、配列は先頭で判定
  - `page`：`posts-query.test.ts` と同じ観点
  - `postDetailHref`：既定値を省く（`postDetailHref(9)` → `/posts/9`）
  - **往復**：`parsePostDetailQuery(postDetailHref(9, x) のクエリ)` が `x` に戻る
  - `postDetailApiPath`：`sort: "likes"` がクエリに**乗る**こと、`recent` のとき `sort` を送らないこと
- `test/lib/cloudinary.test.ts` に追加：`aspect` を省くと `c_fit,w_<幅>,h_<幅>` になり `ar_` を含まない
- `test/lib/posts/posts-query.test.ts`：ページ判定を切り出した後も変更せずに通ること（回帰確認）

並び順（いいね順の正しさ）は API 側の責務で、6-1 の request spec が守っている。
フロントの責務は「`likes` を API に渡すこと」なので、`postDetailApiPath` のテストで押さえる。

## 手動確認（ローカル）

### データの用意

ローカル DB に公開済みの挑戦が無いので、`rails runner` で作る。生成画像の `public_id` には
既存のお題画像の `public_id` を流用する（Cloudinary に実在する画像なら表示できる）。

- 1 つのお題に公開済みの挑戦を **13 件以上**（2 ページ目が出るように）
- **いいね数を作成順と逆向きに振る**（古い挑戦ほどいいねが多い）。同じ向きだと、フロントが `sort` を
  渡し忘れていても新着順と再現度順の並びが一致して気づけない（メモリ：ミューテーション確認の教訓）
- いいね 0 件だけのお題（表彰台が出ないこと）と、いいね 1 以上が 2 件だけのお題（表彰台が 2 枠）も作る
- 改行を含む描写文と、空白の無い長い英数字の描写文を 1 件ずつ

### 確認項目

1. 一覧のカードから詳細へ移動できる。**`/posts/9?sort=likes&page=2` を直接ロード／リロード**しても同じ表示になる
   （`<Link>` 遷移だけだとハイドレーション経路が露出しない。メモリの教訓）
2. 並び替え・ページ送りで URL が変わり、**ヒーローと表彰台がスケルトンに戻らない**（決定 2）。戻るボタンで前の状態に戻る
3. 再現度順と新着順が逆の並びになる
4. 表彰台：いいね 1 以上だけが載る。0 件のお題ではセクションが出ない。スマホ幅で 1・2・3 位の縦並び
5. 縦長・横長の元画像が切り抜かれずに出る（決定 4）
6. お気に入り：ログイン中に付け外しでき、リロード後も保たれる。未ログインではログイン導線になり、ログイン後に詳細へ戻る
7. 失効：`localStorage` のトークンを期限切れのもの（上の `rails runner` の手順）に差し替えてお気に入りを押すと、
   トーストが出てボタンがログイン導線に変わる
8. `/posts/abc` と `/posts/999999` がどちらも「見つかりません」になる（前者は `notFound()`、後者は API の 404）
9. `docker compose pause backend` で初回のタイムアウト表示と再試行。表示後に並び替えを押して、再取得の失敗が
   みんなの挑戦の枠にだけ出る
10. 描写文の改行が反映され、長い英数字がカードからはみ出さない
11. 一覧（`/posts`）の並び替えとページ送りが以前と同じに動く（決定 7 の回帰確認）
12. スマホ幅（DevTools）で横スクロールが出ない
13. トップの `HealthPanel` からトースト確認用ボタンが消えている
14. 並び替え・ページ送りの後も、みんなの挑戦の見出しが画面の上端付近に留まり、フォーカスが見出しに移る
    （7-3c でフォームを入れたときの回帰確認にも使う）
15. いいね 1 以上が 1 件・2 件のお題で、1 位が中央の列に来る

## リリース

- 環境変数の追加は無い。依存の追加も無い
- マージ後、本番（Vercel）で一覧 → 詳細の遷移と、お気に入りの付け外しを 1 回ずつ確認する

## ドキュメントの後始末（同じ PR）

- `docs/issues_backlog.md`
  - 7-3b を閲覧の内容に書き換え、「決めたこと」を記録する
  - **7-3c（#120）を新設**し、分割前に合意した描写・生成の決定事項を「決めたこと」として書く
    （下書き id は画面の中だけで持つ／「画像を生成」は未保存の変更を自動で保存してから起動／
    ポーリングは React を知らない関数＋薄いフック、3 秒間隔・6 分で打ち切り・通信エラーでは続行・404 で停止／
    入力欄は認証状態によらず常に表示／生成後は `draftId` を戻し文面は残す／`cloudinaryDownloadUrl()`）
  - 背骨の順序を `… → 7-3a → 7-3b → 7-3c →（7-4・7-5）→ …` に直す
  - 7-4 に追記：挑戦カードのいいねボタンと `/attempts/[id]` へのリンク化（`AttemptCard` にコメントあり）
  - 7-6 に追記：自分の挑戦カードの削除メニューと確認ダイアログ（デザインブリーフ 3-B）、
    「編集」ボタンの受け口（`/posts/[id]?draft=`）の設計
  - 8-3 に追記：詳細のタイトルを `<title>` に入れるにはサーバー取得が要る（上の「メタデータ」）
  - 8-5 の「`connect-src` は 7-3b で確定」を 7-3c に書き換える（ポーリングが 7-3c に移ったため）

## この issue で作らないもの

- 描写フォーム・生成・ポーリング・ダウンロード URL（7-3c）
- 挑戦カードのいいねボタンとリンク（7-4）
- 自分の挑戦の削除メニュー（7-6）
- `<title>` へのお題タイトルの反映・OGP（8-3）
