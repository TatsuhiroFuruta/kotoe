# issue 7-1 APIクライアントと認証プラミング 設計

- 対象 issue：`docs/issues_backlog.md` 7-1
- 依存：2-2（CORS）、0-3（Next.js の初期化）
- 作成日：2026-09-01
- 前提：`docs/superpowers/specs/2026-07-19-issue-2-1-auth-design.md`（JWT の発行・失効。ここで決めた応答の形をフロントが受ける）
- 前提：`docs/superpowers/specs/2026-07-21-issue-2-2-cors-design.md`（`expose: ["Authorization"]`。これが無いとフロントは JWT を受け取れない）

## この issue で作るもの

マイルストーン 7 の全画面が乗る土台。**画面は作らない**（ログイン・新規登録の画面は 7-2）。作るのは配線だけ：

- `apiFetch` へのトークン付与と、失効の検知
- トークンの保存場所（`localStorage`）とその購読
- ログイン状態のコンテキスト（`AuthProvider` / `useAuth`）
- 認証ガード（`RequireAuth`）とリダイレクト先の検証

バックエンドは一切変更しない。この issue の変更はすべて `frontend/` と `.github/workflows/ci.yml` に閉じる。

## バックエンドから来るもの（変更しない前提）

| 経路 | 送るもの | 返るもの |
|---|---|---|
| `POST /api/auth/sign_up` | `{ user: { name, email, password } }` | 201 ＋ `{id, name, email}`、`Authorization: Bearer …` ヘッダ |
| `POST /api/auth/sign_in` | `{ user: { email, password } }` | 200 ＋ `{id, name, email}`、`Authorization: Bearer …` ヘッダ |
| `DELETE /api/auth/sign_out` | Authorization ヘッダ | 200（空ボディ）。トークンは `jwt_denylist` に載る |
| `GET /api/me` | Authorization ヘッダ | 200 ＋ `{id, name, email, stats: {...}}` |

エラーの形は 2 種類しかない。どちらも**文言ではなくコード**を返す（判定はバック、見せ方はフロント）。

- 認証失敗：`401 {"error": "invalid_credentials" | "unauthorized"}`（Warden の `Api::Auth::FailureApp`）
- 検証失敗：`422 {"errors": {"email": ["taken"], "name": ["blank"]}}`

JWT の有効期限は **24 時間固定**（`config/initializers/devise.rb`）。`sign_out` で denylist に載る。**トークンが無効になる状況は毎日必ず起きる**、というのがこの設計の前提。

## 決めたこと

### 1. トークンは `localStorage` に置く

検討したのは3案。

| | 保存先 | ガード | XSS で盗めるか | CSRF |
|---|---|---|---|---|
| A | `localStorage` | クライアント側のガードコンポーネント | 盗める | 成立しない |
| B | JS 読み取り可 cookie | Next の middleware | 盗める | 成立しない |
| C | httpOnly cookie ＋ Next の BFF | middleware | 盗めない | **要対策** |

**A を採る。**

B は httpOnly ではないので `document.cookie` から読める。**XSS 耐性は A と一枚も変わらない**。得られるのは middleware ガードだけで、代わりにサーバー側フェッチ用の API ベース URL を env にもう 1 本（コンテナ名 `backend:3000` ／本番は Render の URL）足すことになる。割に合わない。

C は「Vercel↔Render は cookie 共有ではなく JWT を Authorization ヘッダで運ぶ」という CLAUDE.md / `docs/README.md` の前提を書き換える。全 API 呼び出しが Vercel の関数を経由することになり、MVP のスコープを超える。

なお **CSRF は A でも B でも成立しない**。CSRF が成立するのは「ブラウザが認証情報を自動送信し、サーバーがその自動送信された値で認証を通す」場合だが、A・B はどちらも JS が明示的に `Authorization` ヘッダへ載せるだけで、Rails は cookie を一切見ない。加えて `config/initializers/cors.rb` は `credentials: true` を設定していないため、ブラウザはクロスオリジンに cookie を乗せない。CSRF を考える必要が出るのは C だけである。

C の利点も正確に書いておく。httpOnly が守るのは**トークンの持ち出し**だけで、「XSS を踏んでも安全」ではない。XSS があれば攻撃スクリプトは被害者のブラウザ内から認証済みリクエストを投げられる（なりすまし投稿・お題削除）。C が買うのは「XSS を塞いだ**後も**なりすましが続く」ことの防止に限られる。

**A のコスト（受け入れる）**：`localStorage` は SSR で読めないため、`/posts/new` と `/mypage` は初回描画で必ず「判定中」を挟む。middleware でリダイレクトできない。

**補足（7-2 以降が誤解しやすい点）**：`AuthProvider` はクライアントコンポーネントだが、これがルートレイアウトに入っても**全ページがクライアントコンポーネントになるわけではない**。サーバーコンポーネントを `children` として渡す限り、それはサーバーで描画されたまま `AuthProvider` の中に収まる。クライアントにする必要があるのは、`useAuth()` を実際に呼ぶコンポーネントだけである。

### 2. 起動時はトークンだけを復元し、ユーザー情報は `GET /api/me` で取る

検討したのは3案。

- **案1（採用）**：トークンだけ保存。マウント時、トークンが無ければ即 `unauthenticated`（リクエストゼロ）。あれば `/api/me` を 1 本だけ叩き、200 で `authenticated` / 401 で破棄して `unauthenticated`。
- **案2**：ユーザー情報も `localStorage` に保存し `/api/me` を叩かない。失効に気づけず、**「ヘッダーはログイン中と表示されているのに、何を押しても 401」が 24 時間ごとに必ず起きる**。単独では採れない。
- **案3**：案2 で即描画し、裏で `/api/me` を叩いて検証。失効時に「ログイン済み表示 → ログアウト表示」のレイアウトシフトが出るうえ、状態遷移が 1 つ増える。

案1 の唯一のコストである「起動時 1 リクエスト」は、**未ログインユーザーには一切かからない**。トップ・お題一覧・お題詳細・ランキングは認証不要なので、初見の訪問者はこの待ちを踏まない。払うのはログイン済みユーザーだけで、その人はどのみち次のクリックで API を叩く。

`AuthProvider` はルートレイアウトに 1 つだけ置く。ページ遷移で `/api/me` を再取得しない。

### 3. トークンを捨てるのは「Authorization を載せた 401」のときだけ

Rails はパスワード不一致も失効トークンも同じ `401` で返す。**ステータスコードでは区別できないが、送信内容では区別できる**。ログイン失敗のリクエストはトークンを載せていない。

```
if (response.status === 401 && 送信時に token を載せていた) {
  tokenStore.clear();
}
```

この 1 行が、「401 を一律トークン失効として扱い、**ログイン失敗のたびに強制ログアウト処理が走る**」というバグを構造的に不可能にする。

`sign_up` / `sign_in` は `skipAuth: true` で呼ぶ。「まだトークンを持っていないはずだから省略できる」ではなく、**ログイン中に再ログインされても上の条件を壊さないため**に明示する。`sign_out` は `skipAuth` を付けない（トークンを載せる必要があり、既に失効していた場合に 401 で破棄されるのが正しい）。

### 4. `api.ts` はリダイレクトしない

`api.ts` は失効を検知したらトークンを捨てるだけで、画面遷移はしない。`tokenStore` の通知を受けた `AuthProvider` が状態を `unauthenticated` に落とし、**`RequireAuth` を敷いたページだけ**が `/login` へ飛ぶ。

これにより、お題一覧のような認証不要ページでトークンが切れても、ユーザーは画面から放り出されない。ヘッダーがログアウト表示に変わるだけになる。画面遷移を知るのは `require-auth.tsx` ただ 1 ファイル。

### 5. `?next=` は必ず検証してから使う

Next のドキュメント（`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-router.md`）に明示された注意：

> You must not send untrusted or unsanitized URLs to `router.push` or `router.replace`, as this can open your site to cross-site scripting (XSS) vulnerabilities. For example, `javascript:` URLs sent to `router.push` or `router.replace` will be executed in the context of your page.

`?next=` は URL に載る＝攻撃者が自由に書ける値である。ログイン後にこれを `router.replace(next)` へ渡す時点で、`/login?next=javascript:...` が XSS に、`/login?next=https://evil.example` がオープンリダイレクトになる。

`lib/auth/safe-next-path.ts` にホワイトリスト方式の検証を置く：**`/` で始まり、`//` や `/\` で始まらない文字列だけを通し、それ以外は `/` を返す**。

書くのは 7-1、使うのは 7-2 だが、**危険な値を URL に載せる側が 7-1（`RequireAuth`）**なので、対の検証もここに置く。

## 実装の構え

### ファイル配置

```
frontend/src/
  lib/
    api.ts                      … apiRequest / apiFetch / ApiError（既存を拡張）
    auth/
      token-store.ts            … localStorage の読み書き ＋ 購読（新規）
      auth-context.tsx          … AuthProvider / useAuth（新規）
      require-auth.tsx          … RequireAuth（新規）
      safe-next-path.ts         … ?next= の検証（新規）
  types/
    api.ts                      … User / 認証エラーコード（既存に追加）
  app/
    layout.tsx                  … AuthProvider を巻く（既存を変更）
    page.tsx                    … 認証疎通確認カードを追加（暫定・7-7 で消える）
    auth-check/page.tsx         … ガード動作確認（暫定・7-2 到達後に削除）
```

各ユニットの責務：

- `token-store.ts` … 「トークンは今なにか」だけを知る。React も `fetch` も知らない。
- `api.ts` … 「HTTP を叩き、トークンがあれば載せ、失効を検知したら捨てる」。React も画面遷移も知らない。
- `auth-context.tsx` … 「今のログイン状態は何か、どう変えるか」。`localStorage` の詳細も画面遷移も知らない。
- `require-auth.tsx` … 「未ログインならどこへ飛ばすか」。画面遷移を知るのはここだけ。
- `safe-next-path.ts` … 純粋関数。何も知らない。

### `api.ts` を 2 層に割る

現在の `apiFetch` はボディしか返さないが、ログインでは**レスポンスヘッダ**からトークンを取る必要がある。戻り値を `{ data, headers }` に変えると全呼び出し側が冗長になるので、低レベル層を 1 枚足す。

```ts
type ApiRequestInit = RequestInit & { skipAuth?: boolean };

// 低レベル。Response ごと返す。認証まわりだけが使う。
export async function apiRequest<T>(
  path: string, init?: ApiRequestInit,
): Promise<{ data: T; response: Response }>;

// 既存の呼び出し側はこちら。data だけ返す。
export async function apiFetch<T>(path: string, init?: ApiRequestInit): Promise<T>;
```

`apiFetch` は `apiRequest` の `data` を返すだけになる。既存の `page.tsx` の `apiFetch<HealthResponse>("/api/health")` は無変更で通る。401 の判定とトークン破棄は `apiRequest` に置くので、`apiFetch` 経由の呼び出しにも等しく効く。

### ボディのパースは「204 かどうか」ではなく「空かどうか」で判断する

既存の `apiFetch` は `response.status === 204` のときだけボディを読まない。これでは足りない。**`DELETE /api/auth/sign_out` は 204 ではなく「ボディが空の 200」を返す**（`head :ok, content_type: "application/json"`）ため、`response.json()` が空文字列をパースして `SyntaxError` になる。ログアウトが必ず失敗する。

`response.text()` を読み、**空文字列なら `null`、それ以外は `JSON.parse`** に変える。さらに `JSON.parse` の失敗も握って生の文字列を `body` に載せる。Render のプロキシや Vercel のエラーページは HTML を返すことがあり、ここで例外にすると本当のステータスコード（502 など）が失われて切り分けができなくなるため。

### トークンの取り出し

Rails は `Authorization: Bearer eyJ…` の形で返す。CORS の `expose: ["Authorization"]` が効いているので JS から読める。`"Bearer "` を剥がして保存し、送信時に付け直す。

**ヘッダが無い／形が違う場合は握り潰さず、`signIn` / `signUp` を失敗扱いにする。** CORS 設定の事故（`expose` の消滅、オリジンの打ち間違い）はここでしか表面化しないため。

### `token-store.ts`

`localStorage` が使えない状況は 2 つある。**SSR（`window` が無い）** と、**サイトデータを拒否している環境（アクセス自体が例外を投げる）**。読み書きを `try`/`catch` で包み、失敗時は「トークン無し」として振る舞う。

これは机上の話ではない。`AuthProvider` はルートレイアウトに入るので、**認証不要ページを含む全ページのサーバーレンダリングで必ず `getServerSnapshot` が呼ばれる**。ここで落とすとサイト全体が 500 になる。

書き込みが例外を投げる環境では、**モジュール内の変数にトークンを保持して読み出しのフォールバックにする**。これが無いと、そういうブラウザではログインが成功した直後に「トークンが読み出せない＝未ログイン」に戻り、ユーザーは何度ログインしても入れない。フォールバックはタブを閉じると消えるが、その 1 セッションは成立する。

購読は `useSyncExternalStore` に合わせて `subscribe` / `getSnapshot` / `getServerSnapshot` を提供する。`subscribe` では自前の購読者集合に加えて `window` の `storage` イベントも購読する（`storage` は他タブでしか発火しないため、自タブ用の通知は自前で持つ必要がある）。結果として**別タブでログアウトすると全タブが同期して落ちる**。

### `auth-context.tsx`

既存の `page.tsx` の `HealthState` に倣い、判別可能ユニオンにする。「`loading`」と「ログイン済みだが `user` が null」を型で区別できない状態を作らないため。

```ts
type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: User }
  | { status: "unauthenticated" };

type AuthContextValue = AuthState & {
  signUp(params: { name: string; email: string; password: string }): Promise<void>;
  signIn(params: { email: string; password: string }): Promise<void>;
  signOut(): Promise<void>;
};
```

`user` を読めるのは `status === "authenticated"` に絞ったときだけになる。

**`signUp` / `signIn` は失敗時に `ApiError` を投げる。** 文言もトーストも出さない。`{"error":"invalid_credentials"}` や `{"errors":{"email":["taken"]}}` をそのまま 7-2 のフォームへ渡し、辞書で日本語にするのはフォーム側の責務（CLAUDE.md「判定はバック、見せ方はフロント」）。

**`signOut` だけは例外を握り潰す。** `DELETE /api/auth/sign_out` がネットワーク断や 401 で失敗しても、ローカルのトークン破棄は必ず実行する。ここで投げると「ログアウトを押したのにログイン状態のまま」という、ユーザーが自力で抜け出せない状態が残る。サーバー側の失効に失敗したトークンは 24 時間で自然に切れる。

### `User` 型は `stats` を持たない

`POST /api/auth/sign_in` と `GET /api/me` は返す形が違う。前者は `{id, name, email}`（`UserSerializer.private_profile`）、後者はそこに `stats`（`posts_count` / `attempts_count` / `likes_received_count`）が付く（`private_profile_with_stats`）。型を 2 つに分ける。

```ts
export type User = { id: number; name: string; email: string };
export type MeResponse = User & {
  stats: { posts_count: number; attempts_count: number; likes_received_count: number };
};
```

**`AuthProvider` が保持するのは `User` だけ**とし、`/api/me` から復元するときも `stats` は捨てる。`stats` はログイン時点のスナップショットにすぎず、お題を投稿しても挑戦されても更新されない。認証コンテキストに置くと、7-6 のマイページヘッダーが**必ず古い値を表示する**。`stats` は 7-6 が `/api/me` を自分で叩いて取る。

### `require-auth.tsx`

```tsx
"use client";
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const pathname = usePathname();
  const router = useRouter();               // next/navigation

  useEffect(() => {
    if (auth.status === "unauthenticated") {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [auth.status, pathname, router]);

  if (auth.status !== "authenticated") return <p>読み込み中…</p>;
  return <>{children}</>;
}
```

- **`push` ではなく `replace`**。`push` だとログイン後に戻るボタンでガード付きページへ戻り、また `/login` へ飛ばされるループができる。
- リダイレクトは `useEffect` の中で行う（レンダリング中のナビゲーションは React の規約違反）。
- `useRouter` は `next/navigation` から import する（App Router では `next/router` ではない）。

## 動作確認（暫定 UI）

`/` の疎通確認カードの隣に「認証疎通確認」カードを足し、`/auth-check` を 1 枚作る。狙いは**ユニットテストでは原理的に嘘をつける箇所**を、実物のブラウザと実物の Rails で 1 度だけ通すこと。

| 確認項目 | jsdom で検証できるか |
|---|---|
| CORS 越しに `Authorization` レスポンスヘッダを JS が読める（`expose` が効いている） | ❌ モックが返す値を見るだけ |
| リロード後に `/api/me` で状態が復元される | ❌ 同上 |
| ログアウト後、同じトークンが denylist で 401 になり、自動で破棄される | ❌ 同上 |
| `RequireAuth` が未ログインを `/login` へ飛ばす | ❌ RTL を入れない方針のため |
| 別タブでのログアウトが同期する | ❌ 同上 |

- `/` のカード：未ログイン時は登録・ログインの最小フォーム、ログイン済み時は `useAuth().user` の表示と「`/api/me` を叩く」「ログアウト」。
- `/auth-check`：`RequireAuth` で包むだけのページ。`GET /api/me` の結果を表示する。

7-2 が未着なので `/login` は 404 になるが、**URL が `/login?next=%2Fauth-check` に変わること自体が確認したい挙動**である。

**どちらも捨て札。** `/` は 7-7 で本来のトップに差し替え、`/auth-check` は 7-2 到達後に削除する。既存の `src/app/page.tsx` は自身のコメントで「疎通確認用の暫定トップページ。issue 7-7 で本来のトップに差し替える」と宣言しており、そこに 1 枚足す形になる。

## テスト

CLAUDE.md は「フロント単体テストは MVP では導入しない。ただし、UIから切り出せる純粋なロジックが生まれたら、その部分にだけ Vitest を後付けする」としている。7-1 はその純粋ロジックを 3 つ生むため、ここで Vitest を導入する。

- 追加する依存：`vitest`、`jsdom`
- `vitest.config.ts` で `@/` エイリアスを解決する
- `package.json` に `"test": "vitest run"` を追加
- **React Testing Library は入れない**（コンポーネント結合テストは E2E と役割が被るとして CLAUDE.md が見送っている）。`AuthProvider` / `RequireAuth` はテスト対象外

### 対象 3 ファイル・17 ケース

**`token-store.ts`（5）**
- 保存したトークンを読み出せる
- 削除すると `null` を返す
- `window` が無い環境で `null` を返す（例外を投げない）
- `localStorage` の読み出しが例外を投げる環境で `null` を返す（例外を投げない）
- `localStorage` の書き込みが例外を投げる環境でも、同じセッション内では読み出せる（メモリのフォールバック）

**`api.ts`（8）**
- トークンがあれば `Authorization: Bearer …` が載る
- トークンが無ければ載らない
- `skipAuth: true` なら、トークンがあっても載らない
- **Authorization を載せたリクエストが 401 を返すとトークンを破棄する**
- **Authorization を載せていないリクエストが 401 を返してもトークンを破棄しない**
- 204 の空ボディで例外にならない
- **ボディが空の 200 で例外にならない**（`sign_out` の応答。これが無いとログアウトが必ず失敗する）
- 2xx 以外で `ApiError` を投げ、`status` と `body` を持つ

**`safe-next-path.ts`（4）**
- `/mypage` はそのまま通る
- `javascript:alert(1)` は `/` に落ちる
- `//evil.example` は `/` に落ちる
- `/\evil.example` は `/` に落ちる

太字の 2 件が対になっていることが要点。片方だけでは、`api.ts` の 401 分岐を「常に破棄」に書き換えても green のままになる。

**実装後、この 2 件は実際にミューテーションで検査する。** 401 の破棄条件を「常に破棄」「一度も破棄しない」に書き換え、**それぞれ 1 件ずつ落ちる**ことを確認してから元に戻す。6-1 では、この検査を怠って「green なのに何も守っていない」spec を 4 件作っている。

### 8-1（E2E）との境界

`RequireAuth` の実際の遷移、ログイン→コアループの通し、生成のポーリングは Playwright（8-1）の担当。7-1 では書かない。

## CI

`.github/workflows/ci.yml` に `frontend` ジョブを 1 つ足す（既存の `backend` / `security` と並列）。`actions/setup-node` ＋ `npm ci`（キャッシュ有効）、`working-directory: frontend`。

回すのは 3 本：

1. `npm run lint`（eslint）
2. `npx tsc --noEmit`（型検査）
3. `npm run test`（vitest）

1 と 2 は issue の文字通りのスコープを少し超える。それでも入れるのは、CLAUDE.md の「`any` を避け、API レスポンスに型を付ける」が**現状どこでも機械的に検査されていない**ため。`npm run lint` は `package.json` に既にあるのに誰も回していない。ジョブを新設する以上セットアップ費用は既に払うので、フロントが 7-2 以降で一気に増える直前がこの 2 行を入れる最も安いタイミングになる。

## 7-2 への申し送り

`?next=` の読み取りに `useSearchParams()` を使う場合、**`<Suspense>` 境界が必須**。Next のドキュメント（`use-search-params.md`）いわく：

> In development, routes are rendered on-demand, so `useSearchParams` doesn't suspend and things may appear to work without `Suspense`. During production builds, a static page that calls `useSearchParams` from a Client Component must be wrapped in a `Suspense` boundary, otherwise the build fails.

**ローカルで通って Vercel のビルドだけが落ちる**典型なので、7-2 の実装時に必ず確認すること。

あわせて、7-2 は `/login` を実装したら `src/app/auth-check/page.tsx` を削除し、`/` の認証疎通確認カードからログインフォーム部分を取り除くこと。

## 変更するファイル

| ファイル | 変更 |
|---|---|
| `frontend/src/lib/api.ts` | `apiRequest` の追加、トークン付与、401 でのトークン破棄 |
| `frontend/src/lib/auth/token-store.ts` | 新規 |
| `frontend/src/lib/auth/auth-context.tsx` | 新規 |
| `frontend/src/lib/auth/require-auth.tsx` | 新規 |
| `frontend/src/lib/auth/safe-next-path.ts` | 新規 |
| `frontend/src/types/api.ts` | `User`・認証エラーコードの型を追加 |
| `frontend/src/app/layout.tsx` | `AuthProvider` を巻く |
| `frontend/src/app/page.tsx` | 認証疎通確認カードを追加（暫定） |
| `frontend/src/app/auth-check/page.tsx` | 新規（暫定） |
| `frontend/vitest.config.ts` | 新規 |
| `frontend/package.json` | `vitest` / `jsdom` の追加、`test` スクリプト |
| `frontend/src/lib/**/*.test.ts` | 新規（17 ケース） |
| `.github/workflows/ci.yml` | `frontend` ジョブの追加 |

バックエンドは変更しない。

## 完了条件

- ローカルのブラウザで、登録 → ログイン → リロードしても状態が残る → `/api/me` が通る → ログアウト → 同じトークンが 401 で自動破棄、までが一通り動く
- `/auth-check` に未ログインでアクセスすると `/login?next=%2Fauth-check` へ遷移する
- 別タブでログアウトすると、もう一方のタブもログアウト状態になる
- `npm run lint` / `npx tsc --noEmit` / `npm run test` が green
- CI の `frontend` ジョブが green

## この issue で作らないもの

- ログイン・新規登録の**画面**（7-2）
- グローバルナビのログイン状態表示（7-2）
- エラーコードの日本語辞書（7-2 以降。文言を持つのはフォーム側）
- React Testing Library によるコンポーネントテスト（CLAUDE.md が見送り）
- Playwright の E2E（8-1）
- middleware によるガード（`localStorage` からは読めないため、A を採った時点で選択肢に無い）
