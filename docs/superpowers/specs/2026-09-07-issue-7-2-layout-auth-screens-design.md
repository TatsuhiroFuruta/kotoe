# issue 7-2 共通レイアウト＋認証画面（/login, /signup） 設計

- 対象 issue：`docs/issues_backlog.md` 7-2
- 依存：7-1（API クライアントと認証プラミング）
- 作成日：2026-09-07
- 前提：`docs/superpowers/specs/2026-09-01-issue-7-1-api-client-auth-design.md`（トークンの保存・復元・ガード。ここで決めた状態モデルを本 issue が変更する）
- 前提：`docs/design_briefs.md` の「0. 共通」「8. ログイン／新規登録」

## この issue で作るもの

マイルストーン 7 の全画面が乗る**見た目の土台**と、ユーザーが初めて操作できる画面 2 本。

- グローバルナビ（ヘッダー）とフッター、それを合成するルートレイアウト
- `/login`・`/signup` の 2 画面
- 全画面共通のデザイントークン（色・角丸・フォント）
- エラーコード → 日本語文言の辞書
- 7-1 の申し送り 6 が指摘した**認証状態モデルの是正**（`unreachable` の導入）
- 7-1 の暫定 UI（`auth-probe.tsx` / `auth-check/`）の削除

バックエンドは一切変更しない。変更はすべて `frontend/` に閉じる。

## 7-1 からの申し送りの処理状況

`docs/issues_backlog.md` の 7-2 に列挙されている 6 項目に、本設計がどう対応するか。

| # | 申し送り | 本設計での扱い |
|---|---|---|
| 1 | 暫定 UI を削除する | 削除する（下記「削除するもの」）。ただし副作用があるので「残る穴」に明記 |
| 2 | `?next=` は必ず `safeNextPath()` を通す | 通す。フォールバックは関数側が持つので呼び出し側には書かない |
| 3 | `useSearchParams()` には `<Suspense>` が要る | **`useSearchParams()` を使わない**。イベントハンドラ内で `window.location.search` を読む |
| 4 | エラー文言の辞書はここで持つ | `src/lib/auth/error-messages.ts` |
| 5 | `restoreFailed` からの回復導線を足す | `retryRestore()` と再試行ボタン。自動再試行は入れない（理由は下記） |
| 6 | `restoreFailed` の意味を確認する。4 つ目の状態に分けるなら今 | **分ける**（`unreachable`）。`restoreFailed` フラグは廃止 |

## 決めたこと

### 1. 認証状態を 4 つに分け、`restoreFailed` フラグを廃止する

7-1 の状態は `loading` / `authenticated` / `unauthenticated` の 3 つに `restoreFailed: boolean` を併置した形だった。問題は「トークンは残っているが `GET /api/me` の答えが得られない」ケースが `unauthenticated` に混ざっていたことにある。

`/api/me` の結果は 3 通りに分かれる。

| 結果 | 意味 | 7-1 の扱い |
|---|---|---|
| 200 | トークンは有効。ユーザーが分かった | `authenticated` |
| 401 | トークンが本当に死んでいる（24h 期限切れ／ログアウト済み） | `api.ts` が破棄 → `unauthenticated` |
| それ以外の失敗（通信断・502・504・CORS） | **何も分からない**。トークンは有効かもしれない | `unauthenticated` ＋ `restoreFailed: true` |

3 行目を `unauthenticated` として見せると、ヘッダーは「ログイン」を出す一方で `tokenStore` にはトークンが残り、`api.ts` は以降の全リクエストに `Authorization` を載せ続ける（`api.ts:78`）。**表示は未ログイン、実際の通信は認証済み**という食い違いになる。「ログアウト」も出ないので、ユーザーはこの状態を自分で解消できない。

そこで 4 つ目の状態 `unreachable` を作り、`restoreFailed` フラグは廃止する。消費側は `status` だけを見れば済み、片方の見落としが型で防げる。

**今やる理由**：`restoreFailed` の消費側は現状 `RequireAuth` の 1 箇所しかない。7-3〜7-6 で 5〜6 箇所に増えたあとでは、同じ変更の費用が数倍になる。

**頻度で正当化しない**：この食い違いは月に 1 回しか起きなくても間違った表示である。なお Render のコールドスタートは**この状態を作らない**（下記 3 を参照）。

### 2. 回復導線は手動の再試行ボタンにする（自動再試行は入れない）

7-1 の `restoreFailedFor === token` は、同じトークンでの再試行を恒久的に塞ぐ（`auth-context.tsx:95`）。通信が回復しても `AuthProvider` は二度と `/api/me` を投げないため、**回復手段がページのリロードしかない**。

`retryRestore()` を足し、`RequireAuth` とヘッダーに再試行ボタンを置く。`online` / `focus` イベントによる自動再試行は入れない。理由は 2 つ。

- 自動再試行が追加で買うのは「ユーザーがボタンを押さなくても直る」だけで、対象は通信断と 5xx に限られる（コールドスタートには効かない）
- リトライ中の表示（`unreachable` のままか `loading` に戻すか）という状態遷移が 1 本増え、テストと表示の設計が増える

必要になってから足せる。

**回復手段は 2 つある**ことを設計として意識しておく。再試行ボタンと、`/login` からのログインし直し（`signIn` は `skipAuth: true` なので古いトークンがあっても通り、成功すれば `tokenStore.set()` で差し替わる）。したがって `unreachable` のとき `/login` は通常通り表示する。

### 3. Render のコールドスタートは `unreachable` を作らない

誤解しやすいので記録する。Render のルーターはスリープ中のリクエストを**キューして待たせる**（即座に落とさない）。そして `apiRequest` には timeout も `AbortSignal` も無い（7-3 への申し送り）。したがってコールドスタートの実際の見え方は `unreachable` ではなく、**`status: "loading"` のまま 30〜60 秒ハングする**である。

`unreachable` を実際に踏むのは、オフライン・DNS 失敗・CORS 設定ミス・デプロイ再起動中の 502・ルーターの待ち時間を超えた 504 のいずれか。ハングの側は 7-3 の `AbortSignal.timeout()` で扱う。

**キープアライブ（外形監視・cron・GAS の定期 ping）で解こうとしないこと。** Solid Queue は `config/queue.yml` で `polling_interval: 1`（毎秒 DB をポーリング）、`render.yaml` で `SOLID_QUEUE_IN_PUMA=true` なので、Render を起こし続けることは Neon を毎秒叩き続けることと同義になり、オートサスペンドが永久に効かなくなる。4-1 の調査時点の数字（Neon 無料 100 CU-hours/月、最小 0.25 CU）で計算すると許容稼働は月 400 時間で、24 時間キープアライブの 730 時間は**月の 55%（17 日目）で枠切れ**になる。詳細は `docs/superpowers/specs/2026-07-31-issue-4-1-solid-queue-design.md`。

### 4. ダークモードは対応範囲に入れない

`globals.css` は Next.js の初期状態のままで `@media (prefers-color-scheme: dark)` を持ち、`dark:` の指定も 11 箇所ある（`page.tsx` に 3、削除予定の `auth-probe.tsx` に 8）。つまり「なんとなくダーク対応」の状態にある。

デザインブリーフ 0 が求めているのは「クリーンで余白広め、画像を引き立てる落ち着いた背景、アクセントカラー 1 色（例：青緑）、カード基調、角丸控えめ、モバイルファースト」だけで、ダークモードには触れていない。

**ライト固定にする。** ただし色は CSS 変数（Tailwind v4 の `@theme`）で定義し、将来ダークが要るときは変数の再定義で足りる形にしておく。

理由は、ブリーフが求めていない対応にマイルストーン 7 全体（残り 6 画面）のコストを払うことになるうえ、**中途半端なダーク対応は無対応より悪い**（背景だけ暗くなって文字が読めないカードが出る）ため。しかも確認手段が OS 設定の切り替えしかなく、実質検証されないまま増える。

### 5. フォームに依存を追加しない。クライアント検証はブラウザ標準の属性だけ

作るフォームは 2 つ（ログイン 2 項目、新規登録 3 項目）。

CLAUDE.md は「業務ルールの判定はバック、フロントで再実装しない」と「送信前のクライアントバリデーションはフロントの責務」を両方書いている。具体的にぶつかるのはパスワードの長さで、これは Rails 側が持つルールである。

Rails 側のルール（これが正）：

| 項目 | ルール | 出どころ |
|---|---|---|
| name | 必須 | `User` の `validates :name, presence: true` |
| email | 必須／形式 `/\A[^@\s]+@[^@\s.]+(\.[^@\s.]+)+\z/`／一意 | devise `validatable` ＋ `config.email_regexp` |
| password | 必須／6〜128 文字 | `config.password_length = 6..128` |

**`useState` ＋ 素の `<form>` にし、クライアント検証は `required` / `type="email"` / `minLength={6}` の 3 属性だけに留める。** `react-hook-form` + `zod` は入れない。

zod を入れた場合、スキーマは上の 6 ルールのうち 5 つの複製になり、残る 1 つ（一意性 = `taken`）は原理的にクライアントで判定できない。**つまりサーバーのエラーコード辞書は結局必要**で、表示経路が「zod のエラー」と「サーバーのエラーコード」の 2 本になる。層が減らずに増える。

争点は「二重かどうか」ではなく壊れ方である。ここが決め手になった。

- **HTML 属性の側はサーバーより緩い。** ブラウザの `type="email"` は `a@b`（ドット無し）を通すが Devise の正規表現は弾く。つまり「サーバーが通すのにフロントが拒否する」が起きない。取りこぼしはサーバーが弾き、そのコードを辞書が翻訳する
- **zod の `.email()` は Devise の `email_regexp` とは別の正規表現**なので、境界のアドレスで「サーバーは受け付けるのにフォームが送信させない」が起こりうる。ユーザーから見て回避手段も原因も分からない

### 6. `?next=` は描画中ではなくイベントハンドラの中で読む

```ts
const next = safeNextPath(new URLSearchParams(window.location.search).get("next"));
router.replace(next);
```

これで申し送り 2 と 3 が同時に片づく。

- `useSearchParams()` を使わないので **`<Suspense>` 境界が要らない**。「ローカルでは通るのに Vercel の本番ビルドだけ落ちる」経路が発生しない
- 描画中に読まないので、ハイドレーションの不一致も起きない
- `safeNextPath()` は不正値に対して `"/"` を返す（`safe-next-path.ts:1`）ので、呼び出し側にフォールバックを書かない。書くと「検査した対象」と「遷移する対象」が食い違う余地ができる

`push` ではなく `replace` を使うのは、ログイン後に戻るボタンでフォームへ戻らないようにするため。

### 7. ナビには実在するルートしか出さない

デザインブリーフ 0 は「左にロゴ、中央に『探す』『ランキング』、右に『お題を投稿』ボタンとユーザーアバター」を求めているが、7-2 時点で実在するルートは `/`・`/login`・`/signup` の 3 本しかない。

**main は Vercel の本番を追跡している**ので、ここで置いた 404 リンクはそのまま本番に出る。これは申し送り 1（暫定 UI が本番トップに公開されていた件）と同じ種類の問題である。

| ナビ項目 | ルート | 足す issue | 背骨 |
|---|---|---|---|
| 探す | `/posts` | 7-3 | ○ |
| お題を投稿 | `/posts/new` | 7-5 | ○ |
| アバター／マイページ | `/mypage` | 7-6 | ○ |
| ランキング | `/rankings` | 7-7 | **×（背骨の外）** |

「準備中」として無効化した項目を置く案も検討したが、7-7 は 🔵 で背骨の外にあり、MVP 期間ずっと「準備中」が並ぶ可能性が高いので採らない。リンクを足す差分は `<Link>` 1 行で各 issue の PR に自然に混ざる。

モバイルは 1 行レイアウトで足りる（項目が 0〜1 個のため）。項目が増える 7-5 / 7-6 でハンバーガーの要否を再検討する。

### 8. health パネルは本番でだけ隠す

申し送り 1 が消せと言っているのは `AuthProbe` だけで、`page.tsx` に残るもう一方（「Rails API 疎通確認」パネル）には触れていない。しかし本来のトップは 7-7（🔵、背骨の外）なので、何もしなければ**MVP の全期間にわたって本番トップページがデバッグ画面のまま**になる。

一方このパネルには実用的な価値がある。CLAUDE.md の「② PR を出すたび Vercel のプレビュー URL で確認する」を実際に支えているのがこれで、CORS 許可オリジンや `NEXT_PUBLIC_API_BASE_URL` の設定ミスはここで最初に見つかる（7-1 の実績あり）。

```tsx
{process.env.NEXT_PUBLIC_VERCEL_ENV !== "production" && <HealthPanel />}
```

| 環境 | `NEXT_PUBLIC_VERCEL_ENV` | パネル |
|---|---|---|
| ローカル（`docker compose up`） | 未定義 | 表示 |
| Vercel プレビュー（PR ごと） | `"preview"` | 表示 |
| Vercel 本番（main） | `"production"` | 非表示 |

Vercel が自動で入れる変数なので、ローカルには存在せず `undefined` になる。`undefined !== "production"` は真。**「本番だけ隠す」であって「本番以外で隠す」ではない。**

`NEXT_PUBLIC_*` はビルド時に値が埋め込まれるので、本番ビルドではこの条件が定数 `false` に畳まれる。Rails 側の `/api/health` エンドポイントには手を入れない（8-2a の curl スモークと Render のヘルスチェックはそのまま動く）。

## 実装の構え

### ファイル配置

```
frontend/src/
├── app/
│   ├── layout.tsx                  変更  ヘッダー／フッターを合成
│   ├── page.tsx                    変更  仮トップ（health パネルは本番のみ非表示）
│   ├── globals.css                 変更  デザイントークン定義、ダーク削除
│   ├── (auth)/
│   │   ├── layout.tsx              新規  中央寄せカードの枠
│   │   ├── login/page.tsx          新規
│   │   └── signup/page.tsx         新規
│   ├── _components/auth-probe.tsx  削除
│   └── auth-check/page.tsx         削除
├── components/                     新規ディレクトリ
│   └── layout/
│       ├── site-header.tsx         新規  "use client"（useAuth を呼ぶ）
│       └── site-footer.tsx         新規  サーバーコンポーネント
└── lib/auth/
    ├── derive-auth-state.ts        新規  純粋関数
    ├── error-messages.ts           新規  エラーコード辞書
    ├── auth-context.tsx            変更  unreachable / retryRestore
    └── require-auth.tsx            変更  unreachable 分岐
```

**`src/components/` を新設する理由**：`_components` は App Router で「そのルート専用」を表す慣習で、全ページ共通のヘッダーには合わない。7-3 以降で `components/posts/` などが増える。`src/lib` が非コンポーネント、`src/components` がコンポーネント、という分け方に揃える。

`(auth)` はルートグループなので **URL には現れない**（`/login` のまま）。この階層を作るのは、2 画面がカードの外枠を共有するため。

### レイアウトの合成

```tsx
// src/app/layout.tsx
<body className="flex min-h-full flex-col">
  <AuthProvider>
    <SiteHeader />
    <div className="flex flex-1 flex-col">{children}</div>
    <SiteFooter />
  </AuthProvider>
</body>
```

- **ヘッダーは `/login` `/signup` にも出す。** ブリーフ 0 が共通ナビを求めており、認証画面だけ外すとロゴから戻る導線が消える
- **`children` を `flex flex-1 flex-col` で包む。** 各ページが `flex-1` を付け忘れてもフッターが最下部に留まる（現状は `page.tsx` が自前で `flex-1` を持っており、ページごとに忘れうる）
- **クライアントコンポーネントは `SiteHeader` だけ。** 7-1 設計書の補足の通り、`children` に渡るサーバーコンポーネントはサーバー描画のまま `AuthProvider` の中に収まる

### `derive-auth-state.ts`

```ts
export type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: User }
  | { status: "unauthenticated" }   // 未ログインが確定した（401 or トークン無し）
  | { status: "unreachable" };      // トークンはあるが、有効か確かめられない

export type AuthStateInput = {
  hydrated: boolean;                              // ハイドレーションが済んだか
  token: string | null;                           // tokenStore の現在値
  session: { token: string; user: User } | null;  // どのトークンで誰だと分かっているか
  restoreFailedFor: string | null;                // 復元に失敗したトークン
};

export function deriveAuthState({ hydrated, token, session, restoreFailedFor }: AuthStateInput): AuthState {
  if (!hydrated) return { status: "loading" };
  if (token === null) return { status: "unauthenticated" };
  if (session?.token === token) return { status: "authenticated", user: session.user };
  if (restoreFailedFor === token) return { status: "unreachable" };
  return { status: "loading" };
}
```

**判定の順序そのものが仕様**である。各行が前の行より先に来られない理由：

| 行 | 理由 |
|---|---|
| `!hydrated` | 7-1 のバグの本体。ハイドレーション中は `useSyncExternalStore` が `getServerSnapshot`（= `null`）を返すため、これを先に見ないと有効なトークンを持つ人を「未ログイン」と誤判定し、`RequireAuth` が `/login` へ飛ばす |
| `token === null` | トークンが無いなら他を見る必要が無い |
| `session?.token === token` | `signIn` 直後。`/api/me` を叩き直さずに済ませる |
| `restoreFailedFor === token` | **トークンの一致まで見る**。再ログインで別トークンに差し替わったら、古い失敗を引きずらない（`loading` に戻って再試行される） |

`AuthProvider` の `useMemo`（`auth-context.tsx:166-180`）はこの関数を呼ぶだけにする。切り出しはテストのためだけではない。`auth-context.tsx` は現状 192 行で、状態導出・トークン購読・API 呼び出し・ハイドレーション判定が同居している。導出だけ外に出すと、`unreachable` の分岐がどこにあるか 1 ファイル読めば分かる。

### `retryRestore()`

```ts
const retryRestore = useCallback(() => setRestoreFailedFor(null), []);
```

既存の復元 `useEffect` は依存配列に `restoreFailedFor` を持っている（`auth-context.tsx:118`）ので、`null` に戻すだけで `/api/me` が再実行される。**新しい仕組みは要らない。**

再試行中の状態は自動的に `loading` になる（`restoreFailedFor` が `null`、`session` も未一致）。ボタンを押すと「読み込み中…」に変わり、成功なら `authenticated`、失敗なら `unreachable` に戻る。

`AuthContextValue` から `restoreFailed: boolean` を削り、`retryRestore(): void` を足す。

### `require-auth.tsx`

```tsx
useEffect(() => {
  if (auth.status !== "unauthenticated") return;   // unreachable は別 status
  const current = `${window.location.pathname}${window.location.search}`;
  router.replace(`/login?next=${encodeURIComponent(current)}`);
}, [auth.status, pathname, router]);

if (auth.status === "unreachable") return <接続エラー + 再試行ボタン onClick={auth.retryRestore} />;
if (auth.status !== "authenticated") return <読み込み中…>;
return <>{children}</>;
```

現在の `if (auth.restoreFailed) return;`（`require-auth.tsx:26`）が消える。飛ばさない理由が status の名前そのものになるため。`window.location` からパスを組み立てる既存の理由（`usePathname` はクエリを含まない）はそのまま維持する。

### `site-header.tsx`

4 状態すべてに表示を割り当てる。

| status | ヘッダー右側 |
|---|---|
| `loading` | プレースホルダ（高さだけ確保）。**SSR と初回クライアント描画で必ず同じものを描く** |
| `unauthenticated` | 「ログイン」リンク ＋「新規登録」ボタン |
| `authenticated` | ユーザー名 ＋「ログアウト」ボタン |
| `unreachable` | 「サーバーに接続できません」＋「再試行」ボタン |

**`unreachable` で「ログイン」を出さないのが要点**。この状態ではトークンが残っていて `api.ts` は `Authorization` を載せ続けるので、「ログイン」を出すと表示と実際の挙動が食い違う（申し送り 6 の指摘そのもの）。

ユーザー名は公開 UGC なので `{user.name}` と普通に書く（React が自動でエスケープする）。`dangerouslySetInnerHTML` は eslint が禁止している。

**ログアウト後の遷移**：`signOut()` の後にヘッダーが `router.push("/")` する。`signOut()` だけだと、`/mypage` でログアウトした人は `RequireAuth` によって `/login?next=/mypage` へ送られ、「抜ける」意思表示に対してログインを促す画面が出る。`/` は認証不要なので `RequireAuth` も動かない。`replace` ではなく `push` にするのは、戻るボタンで直前のページに戻れてよい（ログアウト済みなので危険が無い）ため。

### `/login` と `/signup` をどこまで共通化するか

**共通化するのは 4 つだけ**：`(auth)/layout.tsx` のカード外枠、エラー辞書、`?next=` の解決、入力欄のプリミティブ。**フォーム本体は各ページが自分で持つ**（ログイン約 70 行、新規登録約 85 行）。

共通の `<AuthForm fields={...}>` を作らない理由は、フィールドを配列で定義する設定駆動フォームになり、2〜3 項目のフォーム 2 つに対しては読みにくくなるだけだから。3 つ目の認証画面（パスワードリセット等）は `recoverable` を入れていないので予定が無い。

**ログイン済みで `/login` を開いた場合**も `next`（無ければ `/`）へ `replace` する。`RequireAuth` に飛ばされた後、別タブでログインして戻ってきた場合に、認証済みなのにログインフォームが出るのを防ぐ。

### `error-messages.ts`

`toAuthFormErrors(error: unknown)` が `{ formError: string | null; fieldErrors: Record<string, string> }` を返す。

| 入力 | 出力 |
|---|---|
| 401 `{"error":"invalid_credentials"}` | 「メールアドレスまたはパスワードが正しくありません」 |
| 401 `{"error":"unauthorized"}` | 「セッションの有効期限が切れました。もう一度ログインしてください」 |
| 422 `{"errors":{"email":["taken"]}}` | `fieldErrors.email` =「このメールアドレスは既に登録されています」 |
| 422 の**未知コード** | 「入力内容を確認してください（password: xxx）」 |
| その他の `ApiError`（500 / 502 / HTML ボディ） | 「サーバーでエラーが発生しました。時間をおいて再度お試しください」 |
| `TypeError`（fetch 自体の失敗＝通信断・CORS） | 「サーバーに接続できませんでした。通信環境を確認してください」 |
| `extractToken` の Error | 「ログインに失敗しました」＋ **`console.error` に原文を出す** |

辞書が持つコードは Rails 側の実体に対応させる：`name: blank` ／ `email: blank, invalid, taken` ／ `password: blank, too_short, too_long`。

**未知コードで空文字を返さない**のが要点。Rails 側にバリデーションが増えたとき、「送信しても画面に何も出ない」という原因の分からない状態になるのを防ぐ。`extractToken` の原文を `console.error` に残すのは、これが CORS の `expose` 設定の問題であり、切り分け情報を捨てると「ログインは成功しているのに入れない」という症状の原因が追えなくなるため（7-1 設計書）。

`ApiError.body` は `unknown`（HTML 文字列が来ることがある。`api.ts:37-46`）なので、型ガードを通してから読む。

### デザイントークン（`globals.css`）

```css
@theme {
  --color-canvas: #FAFAF9;        /* 背景。白より一段落として画像とカードを浮かせる */
  --color-surface: #FFFFFF;       /* カード面 */
  --color-ink: #1C1917;
  --color-ink-muted: #57534E;
  --color-line: #E7E5E4;
  --color-accent: #0D9488;        /* ブリーフの「青緑」 */
  --color-accent-strong: #0F766E; /* hover */
  --radius-card: 6px;             /* 角丸控えめ */
}
```

削除するのは `@media (prefers-color-scheme: dark)` ブロックと `--background` / `--foreground`。

**あわせて既存のバグを 1 つ直す**：`globals.css` の `body { font-family: Arial, Helvetica, sans-serif; }` が、`layout.tsx` で読み込んでいる Geist を上書きしていて、フォント指定が効いていない。ここを触る回なので直す。

### 仮トップ（`/`）

キャッチコピー 1 行＋サブ説明＋CTA（未ログイン時は「新規登録」「ログイン」）だけ。遊び方 3 ステップと新着/人気は 7-7（6-2 依存）に残す。CTA もナビと同じ方針で、実在するルートだけを出す。

## テスト

CLAUDE.md の方針通り、**UI から切り出せる純粋なロジックにだけ Vitest** を書く。React Testing Library は導入しない（8-1 の E2E と役割が被る）。

CI は既に `npm run lint` / `tsc` / `npm run test` を回している（`.github/workflows/ci.yml:106-137`）ので、CI 側の変更は無い。

### `test/lib/auth/derive-auth-state.test.ts`（5 件）

1. `hydrated: false` はトークンがあっても `loading`（7-1 のバグ）
2. `token: null` → `unauthenticated`
3. `session.token === token` → `authenticated` でユーザーを返す
4. `restoreFailedFor === token` → **`unreachable`**（`unauthenticated` ではない）
5. `restoreFailedFor` が別のトークン → `loading`（再ログイン時に古い失敗を引きずらない）

### `test/lib/auth/error-messages.test.ts`（5 件）

6. 401 `invalid_credentials` → フォームエラー文言
7. 422 `{errors:{email:["taken"]}}` → `fieldErrors.email` に文言
8. **未知コード** → 空文字にならず、コードが分かる文言になる
9. `TypeError` → 通信エラー文言
10. 500 / 文字列ボディ → サーバーエラー文言

### 手動確認

- ヘッダーの 4 状態（`unreachable` は devtools のオフラインで再現し、再試行ボタンで復帰することまで見る）
- `/signup` → 登録 → ヘッダーがユーザー名に変わる → ログアウト → `/` に戻る
- `/login?next=/mypage` のような値を手で付けて、ログイン後に `safeNextPath` が効くこと。`?next=//evil.example` や `?next=%2F%09%2Fevil.example` が `/` に落ちること
- ローカルと Vercel プレビューで health パネルが出て、本番ビルド（`npm run build` に `NEXT_PUBLIC_VERCEL_ENV=production` を与える）で出ないこと

## 削除するもの

| ファイル | 理由 |
|---|---|
| `src/app/_components/auth-probe.tsx` | 申し送り 1。パスワードが初期値で入った認証パネルが本番トップに公開されている |
| `src/app/auth-check/` | 同上 |
| `src/app/page.tsx` の `<AuthProbe />` | 同上 |

## 残る穴（7-5 / 8-1 への申し送り）

`auth-check/` を削除すると、**`RequireAuth` を使うページがリポジトリから一時的に消える**。次に使うのは 7-5（`/posts/new`）で、E2E（8-1）は 7-3・7-4 依存。つまり 7-2 で `RequireAuth` に入れる変更（`unreachable` 分岐と再試行ボタン）は、**自動テストでも画面でも確認されないまま 7-5 までマージされる**。

それでも削除する。申し送り 1 が問題にしているのは本番に公開されている認証パネルであり、確認手段のために本番の穴を残すのは割に合わない。代わりに次の 2 つで受ける。

- `RequireAuth` の変更を**機械的な置き換えに限定**する（`auth.restoreFailed` → `auth.status === "unreachable"`）。判定ロジック本体は `deriveAuthState` のテストが守る
- 7-5 で `/posts/new` にガードを敷いた回に、**直接ロード／リロードで `/login` に飛ばされないこと**を必ず手で確認する（7-1 で実際に埋め込んだバグ。`<Link>` のクライアント遷移では露出しない）

8-1 の E2E ①（認証フロー）には、7-1 の申し送りに加えて次を含める。

- `unreachable` からログインし直して復帰できること（`signIn` は `skipAuth: true` なので古いトークンがあっても通る）

## 変更するファイル

| ファイル | 変更 |
|---|---|
| `src/app/layout.tsx` | ヘッダー／フッターの合成、`flex-1` のラッパ |
| `src/app/page.tsx` | 仮トップに差し替え、health パネルを本番で非表示、`<AuthProbe />` 削除 |
| `src/app/globals.css` | デザイントークン、ダーク削除、Arial 上書きの修正 |
| `src/app/(auth)/layout.tsx` | 新規 |
| `src/app/(auth)/login/page.tsx` | 新規 |
| `src/app/(auth)/signup/page.tsx` | 新規 |
| `src/components/layout/site-header.tsx` | 新規 |
| `src/components/layout/site-footer.tsx` | 新規 |
| `src/lib/auth/derive-auth-state.ts` | 新規 |
| `src/lib/auth/error-messages.ts` | 新規 |
| `src/lib/auth/auth-context.tsx` | `deriveAuthState` を使う、`restoreFailed` 廃止、`retryRestore` 追加 |
| `src/lib/auth/require-auth.tsx` | `unreachable` 分岐と再試行ボタン |
| `test/lib/auth/derive-auth-state.test.ts` | 新規（5 件） |
| `test/lib/auth/error-messages.test.ts` | 新規（5 件） |
| `src/app/_components/auth-probe.tsx` | 削除 |
| `src/app/auth-check/page.tsx` | 削除 |

## 完了条件

- 登録・ログイン・ログアウトが画面から一通りできる
- 全ページに共通のヘッダーとフッターが出る
- 7-1 の暫定 UI が本番トップから消えている
- `unreachable` のときヘッダーが「ログイン」ではなく接続エラーを出し、再試行ボタンで復帰できる
- `npm run lint` / `tsc` / `npm run test` が green

## この issue で作らないもの

- ランキングと本来のトップ（7-7）、お題一覧・詳細（7-3）、お題投稿（7-5）、マイページ（7-6）
- `apiRequest` の timeout / `AbortSignal`（7-3。コールドスタートのハングはそちらで扱う）
- パスワードリセット・メール確認（`recoverable` / `confirmable` を入れていない）
- Google ログイン（ブリーフでは「将来用に場所を用意（任意）」。場所も置かない）
- ダークモード
- CSP（8-5）
