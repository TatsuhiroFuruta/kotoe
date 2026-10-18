# issue 7-2.6 セッション失効の通知と再ログイン導線 設計

- 対象 issue：`docs/issues_backlog.md` 7-2.6（GitHub #105）
- 依存：7-2.5（トースト）、7-5（最初のガード付きページ `/posts/new`）
- 作成日：2026-10-16
- 前提：`frontend/AGENTS.md`（Next 16 の API は型定義とコンパイル済み実装を直接読む）
- 前提：CLAUDE.md「XSS」（`href` や URL 由来の値は検証を挟む）「テスト戦略」「メッセージ・エラー・i18n の責務」
- 前提：7-2.5 設計書（トーストのストアは api.ts から呼べるよう React の外に置いた）、
  7-2.7 設計書「後続への申し送り 2」（401 の本文を読む途中のタイムアウト）

## この issue で作るもの

1. 失効（Authorization を載せたリクエストの 401）を 1 箇所で記録し、トーストで 1 回だけ知らせる仕組み
2. ガード付きページで失効したときの `/login?reason=expired&next=...` と、ログイン画面の案内の枠
3. 各画面が個別に出している失効トースト（4 箇所）の撤去

バックエンドの変更は無い。

**この issue で作らないもの**

| 項目 | 理由・担当 |
|---|---|
| 書きかけ（描写文、お題投稿の画像・タイトル）を失効のあとまで残す | 7-3d（#127）。保存先の問いが同じなので一度で決める（決定 1） |
| 失効したタブ以外のタブで理由を出す | 既知の制約 1 |
| 24 時間より前に失効を予告する、トークンを自動で延長する | バックの変更（リフレッシュトークン等）になる。必要になったら別 issue |
| `/signup` での案内 | 失効したユーザーが送られるのは `/login` だけ |

## 調べて分かったこと（2026-10-16、コードと実測から確認）

| 確認したこと | 結果 |
|---|---|
| JWT の有効期限 | 24 時間固定（`backend/config/initializers/devise.rb:337`）。**毎日必ず起きる** |
| 失効したトークンでの `GET /api/me` | 401（ローカルで実測） |
| 失効したトークンでの `GET /api/posts`・`GET /api/posts/:id` | **200**（ローカルで実測）。`authenticate_user!` を通さず `current_user` が nil になるだけ。挑戦詳細（`attempts#show`）とポーリングも同じ |
| つまり、失効が見つかる経路 | (a) 起動時の `GET /api/me`、(b) 認証必須の操作（お気に入り・いいね・描写の保存と生成・お題投稿）の 2 つだけ |
| 操作の 401 の今の扱い | 4 箇所が個別に `SESSION_EXPIRED_MESSAGE` をトーストで出している（`favorite-button.tsx`、`attempt-messages.ts` の `toLikeErrorMessage`、`attempt-composer.tsx` の 2 箇所、`post-form.tsx`／`post-messages.ts`） |
| (a) の今の扱い | 何も出ない。認証不要ページはヘッダーが黙って「ログイン」に変わり、ガード付きページは説明なしで `/login` へ送られる |
| トーストの置き場所 | ルートレイアウト（`app/layout.tsx`）。クライアント遷移をまたいで残る |
| `status === "unauthenticated"` の分岐 | 7 箇所（`page.tsx`、`site-header.tsx`、`favorite-button.tsx`、`like-button.tsx`、`attempt-composer.tsx`、`require-auth.tsx`、`derive-auth-state.ts`） |
| `error-messages.ts` の import | `api.ts` を import している。api.ts からこちらを import すると循環する |

## 決めたこと

### 決定 1：入力を守る件は 7-3d に任せ、この issue は「失効を伝える」に絞る

backlog の「先に決めること 3」への答え。

- 描写文は、失効しても入力欄が残る（7-3c）。消えるのは「ログインして描写する」でログイン画面へ移ったときで、
  **画面を離れると書きかけが消える 7-3d と同じ問題**
- お題投稿の画像とタイトルは、`RequireAuth` が画面を切り替えるので必ず消える。画像は `File` なので、
  残すには IndexedDB が要る（localStorage は文字列だけで、Base64 にすると 1 枚で上限の約 5MB を超える）
- どちらも「どこに保存するか」の問いになる。7-3d で一度決めれば両方に効く
- backlog の 7-3d に、お題投稿の画像・タイトルと「失効でログイン画面へ移るときも同じ問題」を書き足す

### 決定 2：失効の理由は tokenStore が持つ。5 つ目の状態にはしない

backlog の「先に決めること 1」への答え。

```
api.ts（Authorization を載せたリクエストが 401）
  └─ tokenStore.expire(送ったトークン)  … 今も同じトークンなら捨てて「失効」を記録し、true を返す
       └─ true のときだけ notifySessionExpired()  … toast.error(SESSION_EXPIRED_MESSAGE)
AuthProvider
  └─ useSyncExternalStore で token と wasExpired を購読
       └─ deriveAuthState() → { status: "unauthenticated", expired: true }
RequireAuth
  └─ expired なら /login?reason=expired&next=...、そうでなければ今までどおり /login?next=...
```

**tokenStore**

- `expire(token): boolean` を足す。中身が `token` と一致するときだけ捨てて、理由を記録し、true を返す。
  いま api.ts にある「今も同じトークンか」（`tokenStore.get() === token`）の比較をここへ移す
- 理由が消えるのは 3 つの場合：
  - `set()`（ログイン）
  - `clear()`（ログアウト）
  - **storage イベント（ほかのタブがトークンを変えた）**。これが無いと、昔の失効の記録が残ったまま
    別タブでログアウトされたとき、「期限切れ」と誤って出る
- 読み出しの口 `wasExpired(): boolean` を足す。購読は既存の `subscribe` を共有する（`expire()` は値を
  書いてから通知するので、通知を受けた時点で `wasExpired()` は新しい値を返す）
- `clear()` の意味は「ログアウト（理由なし）」に限定する。api.ts からは呼ばなくなる

**`deriveAuthState()`**

- 入力に `expired: boolean` を足し、`unauthenticated` のときだけ出力に `expired` を載せる
- 判定の順序（仕様そのもの）は変えない

**5 つ目の状態（`status: "expired"`）にしない理由**

- 7 箇所の分岐は、失効のあとも「未ログイン」と同じ表示でよいものばかり。状態を分けると全箇所に
  `|| status === "expired"` が要り、**1 箇所でも漏れると、そこだけ失効後に何も表示されない**
- 失効かどうかを見たいのは `RequireAuth` だけ

**トーストを api.ts（の呼ぶ関数）で出す理由**

- 並行した 401 が何本あっても、`expire()` が true を返すのは最初の 1 本だけ。**1 回の失効につき
  トーストは 1 回**になり、重複を除く処理が要らない
- AuthProvider の effect で出す案は採らない。開発時の StrictMode で effect が 2 回走るので二重に
  出さないための ref が要り、しかも記録した瞬間ではなく次の描画のあとに出る。部品が増えるだけで得るものが小さい
- 7-2.5 でトーストのストアを React の外に置いたのは、この使い方のため

**新しいモジュール `lib/auth/session-expiry.ts`**

- `SESSION_EXPIRED_MESSAGE` を `error-messages.ts` からここへ移し、`notifySessionExpired()` を置く
- `error-messages.ts` はここから import し直す（文言は 1 箇所のまま）。移すのは循環 import を避けるため

### 決定 3：ログイン画面へは `?reason=expired` で運ぶ

backlog の「先に決めること 2」への答え。

| 案 | 採否 |
|---|---|
| トースト ＋ `?reason=expired`（**採用**） | リロードしても枠が残る。どの訪問で枠を出すかが URL ごとに決まるので、消すタイミングの管理が要らない |
| トースト ＋ AuthProvider のメモリ上のフラグ | リロードで消える。ログイン成功・ログアウト・ヘッダーから自分で「ログイン」を押したときに消す処理が要り、消し忘れると関係のないときにも「期限切れ」と出る |
| トーストだけ | トーストは 8 秒で消えるので、ログイン画面に着いた頃には読み終わる前に消えていることがある |

**検証：`lib/auth/login-reason.ts`**

- `LOGIN_REASON_EXPIRED = "expired"` を export し、`RequireAuth` が URL を組み立てるときも使う
  （送る側と受ける側で文字列が食い違わないように）
- `parseLoginReason(raw: string | string[] | undefined): "expired" | null`。値が文字列で、
  `"expired"` と**完全に一致したときだけ** `"expired"` を返す。未指定・配列・大文字違い・前後の空白・
  別の値はすべて `null`
- `?reason=` は誰でも書ける（`safeNextPath()` の `?next=` と同じ）。ただし URL の値は画面に出さない。
  外部から `?reason=expired` 付きのリンクを踏まされても、出るのはこちらが決めた 1 文だけ

**`RequireAuth` が組み立てる URL**

- `/login?reason=expired&next=<encodeURIComponent(current)>`（失効のとき）
- `/login?next=<encodeURIComponent(current)>`（それ以外。今と同じ）

### 決定 4：ログイン画面はサーバーコンポーネントで `?reason=` を読み、枠を HTML の時点で出す

- `app/(auth)/login/page.tsx` をサーバーコンポーネントにし、`searchParams` prop から
  `parseLoginReason()` で読む。いまの中身はクライアントコンポーネント `components/auth/login-form.tsx` へ移し、
  `expired: boolean` を prop で渡す。`/posts` と同じ形
- `useSearchParams()` は使わない（`<Suspense>` を要求し、本番ビルドだけ落ちる。7-2 の規約）
- 枠はサーバーが返す HTML の時点で入っているので、表示後に差し込まれて入力欄がずれることがない
- 代わりに `/login` は静的ページから、リクエストごとに描画するページになる。描画は Vercel 側で行い、
  Render は叩かないので、スリープの影響は受けない
- `?next=` の読み方（イベントハンドラの中で `window.location` から読む）は変えない

**枠の見た目**

- フォームの上、今の赤いエラー枠と同じ位置。エラーではなく案内なので、アクセント色の薄い背景
  （`bg-accent/10`、文字は `text-ink`）
- `role="status"`。ページに着いた時点から出ている説明で、割り込んで読み上げるものではないため（`alert` にしない）
- 文言は `SESSION_EXPIRED_MESSAGE`
- ログインに失敗したときは、枠を残したまま、その下に赤いエラー枠を出す

### 決定 5：各画面の個別トーストを撤去する

中央のトーストと二重に出ないように、401 のときは何も出さない。トースト以外の後処理は残す。

| 場所 | 変更 | 残すもの |
|---|---|---|
| `favorite-button.tsx` の `toFavoriteErrorMessage` | 401 は `null` を返し、呼び出し側は `null` ならトーストを出さない | 404 などほかの文言 |
| `attempt-messages.ts` の `toLikeErrorMessage` | 同上（戻り値の型を `string \| null` に） | 同上 |
| `attempt-composer.tsx`（保存・生成の 2 箇所） | `toast.error` の行だけ消す | 状態を idle に戻す処理、入力欄へのフォーカス |
| `post-form.tsx` | 画面上の分岐はトーストを消して return だけ | `session_expired` という種別（赤いエラー枠を出さないために使っている） |
| `post-messages.ts` の `toLeftPageFailureMessage` | 失効なら `null`。呼び出し側は `null` ならトーストを出さない | ほかの文言 |

副次効果：**再ログインでトークンが差し替わったあとに古い 401 が返ってきた**とき、今は各画面が
「期限切れ」と出してしまう。中央の判定は「今も同じトークンか」を見るので出さない。

### 決定 6：401 の本文を読む途中のタイムアウトは `ApiError(401)` にする

7-2.7 設計書「後続への申し送り 2」。

- api.ts で、このリクエストで `expire()` が true を返したことを変数（`expiredByThisRequest`）に覚えておく
- `catch` でタイムアウトを `ApiTimeoutError` に変換する**前に**その変数を見て、立っていれば
  `new ApiError(401, null)` を投げる。各画面は 401 として扱い、「応答がありません」とは出さない
- 7-2.7 で見送った「401 の判定を `catch` の外へ持ち出す」組み替えはしない。変数を 1 つ足すだけで済む
- `expire()` が false だった（ほかのリクエストが先に捨てた、トークンが差し替わった）401 は今までどおり。
  タイムアウトならタイムアウトとして投げる

## 経路ごとの見え方（変更後）

| 経路 | 認証不要ページ | ガード付きページ（`/posts/new`） |
|---|---|---|
| 起動時の `GET /api/me` が 401 | トースト。ヘッダーが「ログイン」に変わる。ページはそのまま | トースト ＋ `/login?reason=expired&next=/posts/new`。枠が出る |
| 操作が 401 | トースト（1 件）。ボタンが「ログインして〜」に変わる。入力欄は残る | トースト ＋ 同上。入力は消える（決定 1） |
| ログアウト・ほかのタブでのログアウト | 何も出ない（今と同じ） | `/login?next=...`（枠なし。今と同じ） |
| ログインに失敗（パスワードの誤り。`skipAuth` の 401） | ― | ― （ログイン画面の赤い枠だけ。今と同じ） |

## 構成

```
frontend/src/
├── lib/
│   ├── api.ts                     … expire() を呼ぶ／expiredByThisRequest
│   └── auth/
│       ├── token-store.ts         … expire() / wasExpired() / 理由の消去
│       ├── derive-auth-state.ts   … expired の入出力
│       ├── auth-context.tsx       … wasExpired を購読して deriveAuthState へ
│       ├── require-auth.tsx       … expired なら ?reason=expired
│       ├── session-expiry.ts      … 新規。SESSION_EXPIRED_MESSAGE と notifySessionExpired()
│       ├── login-reason.ts        … 新規。LOGIN_REASON_EXPIRED と parseLoginReason()
│       └── error-messages.ts      … 文言を session-expiry.ts から import
├── app/(auth)/login/page.tsx      … サーバーコンポーネントに
├── components/auth/login-form.tsx … 新規。今の login/page.tsx の中身 ＋ 案内の枠
└── （決定 5 の 5 ファイル）
```

## XSS

- `?reason=` の値は画面に出さない。`parseLoginReason()` が `"expired"` か `null` に正規化し、
  画面はその結果で固定の文言を出すかどうかを決めるだけ
- `?next=` の扱いは変えない（`safeNextPath()`）

## テスト

CLAUDE.md の方針どおり、純粋なロジックだけ Vitest で書く。置き場所は `frontend/test/` に `src/` を写す。

| 対象 | 検査すること |
|---|---|
| `token-store` | 一致するときだけ `expire()` が捨てて true を返す／一致しなければ何もせず false／理由が `set`・`clear`・storage イベントで消える／`expire()` で購読者に通知が届き、その時点で `wasExpired()` が true |
| `derive-auth-state` | `expired` は `unauthenticated` のときだけ載る。既存の判定順のテストは変えない |
| `api` | トークンを載せた 401 でトーストが 1 件出る／**並行した 401 が 3 本でも 1 件**／`skipAuth` の 401 では出ない／差し替え後の古い 401 では出ない（新しいトークンも残る）／本文を読む途中でタイムアウトしたら `ApiError(401)` になる |
| `login-reason` | `"expired"` だけを通す（未指定・配列・大文字・空白付き・別の値は `null`） |
| `attempt-messages`・`post-messages` | 既存の 401 の期待値を `null` に直す |

ミューテーションでの確認（並び順の判定は無いので範囲を絞る）：`expire()` の一致判定を外したとき、
トーストを `expire()` の結果によらず出したときに、それぞれテストが落ちること。

## 手動確認（ローカル）

localStorage の `kotoe.auth.token` を壊れた値に書き換えて失効を再現する（壊れたトークンも失効した
トークンも、Rails からは同じ 401 が返る。上の実測を参照）。

1. `/posts/new` を**直接開く**：トースト、`/login?reason=expired&next=%2Fposts%2Fnew`、枠が出る。
   ログインすると `/posts/new` へ戻る
2. トップでトークンを壊してから、ヘッダーの「お題を投稿」で `/posts/new` へ**移る**：1 と同じ
3. トップ・お題詳細を開く：トーストが出て、ヘッダーが「ログイン」になる。ページはそのまま
4. ログイン状態で画面を開いたあとにトークンを壊し、お気に入り・いいね・描写の保存・お題投稿を押す：
   トーストが 1 件だけ出る
5. ヘッダーの「ログイン」から普通に `/login` へ行く：枠は出ない
6. `/login?reason=EXPIRED`、`/login?reason=expired&reason=expired`、`/login?reason=foo`：枠は出ない
7. 枠が出ている状態でパスワードを間違える：枠の下に赤いエラー枠が出る

## 既知の制約

1. **失効を最初に見つけたタブ以外では、理由が出ない。** トークンは localStorage で全タブが共有するが、
   理由はタブごとのメモリにある。ほかのタブは storage イベントで「トークンが消えた」ことしか分からず、
   ヘッダーは「ログイン」に変わり、ガード付きページなら `?reason=` 無しでログイン画面へ送られる。
   直すには `BroadcastChannel` などで理由も届ける必要があるが、「消えた」と「理由」が届く順序は保証されず、
   「消えた」が先に着くと理由を待たずに遷移してしまう。起きるのは失効の時点でタブを 2 つ以上開いている
   ときに限られ、困るのも「理由が出ない」だけ（ログインし直せば `?next=` で戻れる）なので見送る。
   同じ理由で、**ほかのタブが先にトークンを捨てた（失効・再ログイン）瞬間に、こちらのタブで送信中だった操作**の
   401 では、`expire()` が false になり、トーストも各画面の文言も出ない（2026-10-16 の `/code-review` で指摘）。
   次の操作は今のトークンで送られるので、起きるのは送信中だった 1 回だけ
2. **お題投稿の入力は失効で消える。** 決定 1 のとおり 7-3d で扱う
3. **画面を開いたまま 24 時間が過ぎても、操作するまで失効に気づかない。** 認証不要の取得は失効した
   トークンでも 200 を返すため。表示中の内容は誰でも見られるものなので、実害は無い

## リリース

フロントだけの変更。マイルストーンの区切りで本番へ反映する（CLAUDE.md）。PR のプレビュー URL で
手動確認 1〜7 のうち 1・3・5・6 を確かめる。

## backlog への反映

- 7-2.6：決めたこと（決定 1〜6）と既知の制約を書く
- 7-3d（#127）：対象にお題投稿（`/posts/new`）の画像・タイトルを足す。「失効でログイン画面へ移るときも
  同じ問題（7-2.6 決定 1 から引き継ぎ）」を書き足す。画像は `File` なので保存先の候補に IndexedDB が入る
