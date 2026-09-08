# issue 7-2 共通レイアウト＋認証画面 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全ページ共通のヘッダー／フッターと `/login`・`/signup` を作り、7-1 の暫定 UI を消して、認証状態モデルの食い違い（`restoreFailed`）を `unreachable` として是正する。

**Architecture:** 認証状態の導出を `AuthProvider` から純粋関数 `deriveAuthState()` へ切り出し、3 状態＋フラグを 4 状態に置き換える。UI は App Router のルートレイアウトにヘッダー／フッターを合成し、`/login`・`/signup` はルートグループ `(auth)` でカードの外枠を共有する。エラー表示はサーバーが返すエラーコードをフロントの辞書で翻訳する 1 本の経路に集約する。

**Tech Stack:** Next.js 16.2.10（App Router）／React 19.2.4／TypeScript／TailwindCSS v4／Vitest 4（jsdom）。**依存の追加は無い。**

**Spec:** `docs/superpowers/specs/2026-09-07-issue-7-2-layout-auth-screens-design.md`

## Global Constraints

すべてのタスクの要件に、暗黙にこのセクションが含まれる。

- **作業ブランチは `feat/issue-7-2-layout-auth-screens`。** main へ直接コミットしない（CLAUDE.md）。
- **変更は `frontend/` に閉じる。** backend は 1 行も触らない。
- **依存を追加しない。** `package.json` の `dependencies` / `devDependencies` を変更しない。
- **コミットメッセージの末尾は `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` の 1 行だけ。** `Claude-Session:` の行は付けない（public リポジトリのため）。
- **文字列はダブルクォート。** 既存のフロントのコードに合わせる。
- **`any` を使わない。** API レスポンスには `src/types/api.ts` の型を使う。
- **`dangerouslySetInnerHTML` を使わない。** eslint（`react/no-danger`）が error で止める。ユーザー由来の値は `{value}` と普通に書く。
- **`href` / `src` にユーザー由来の値を入れるときは検証を挟む。** `?next=` は必ず `safeNextPath()`（`src/lib/auth/safe-next-path.ts`）を通す。
- **`useSearchParams()` を使わない。** `<Suspense>` 境界が必要になり、ローカルでは通るのに Vercel の本番ビルドだけ落ちる。クエリはイベントハンドラ／effect の中で `window.location.search` から読む。
- **ダークモードは対応しない。** `dark:` バリアントを新しく書かない。
- **色は `globals.css` のトークンを使う。** `bg-canvas` / `bg-surface` / `text-ink` / `text-ink-muted` / `border-line` / `text-accent` / `bg-accent` / `text-danger` / `rounded-card`。`zinc-500` のような生の Tailwind パレットを新しく書かない。
- **テストは `frontend/test/` に置き、`src/` の構造を写す。** `src/lib/auth/foo.ts` → `test/lib/auth/foo.test.ts`。
- **検証コマンドはコンテナ内で回す。**
  ```bash
  docker compose exec frontend npm run lint
  docker compose exec frontend npx tsc --noEmit
  docker compose exec frontend npm run test
  ```
  コンテナが動いていない場合は `docker compose up -d frontend` を先に実行する。

## タスクの並びと理由

| # | タスク | なぜこの位置か |
|---|---|---|
| 1 | デザイントークン | 以降の全タスクが `text-ink` 等を使う。先に無いと生のパレットを書くことになる |
| 2 | `deriveAuthState`（純粋関数＋テスト） | 消費側が無いので単独で完結する |
| 3 | `auth-context` / `require-auth` の差し替え | 2 を使う。`restoreFailed` の廃止は 2 ファイル同時でないと型が通らない |
| 4 | `error-messages`（純粋関数＋テスト） | 消費側が無いので単独で完結する |
| 5 | ヘッダー・フッター・ルートレイアウト | 3 の 4 状態を使う |
| 6 | `/login`・`/signup` | 4 の辞書と 5 のレイアウトを使う |
| 7 | 仮トップ ＋ 暫定 UI の削除 | **最後に置く。** タスク 3 の手動確認を、まだ残っている `/auth-check` で行うため（設計書「残る穴」） |

---

### Task 1: デザイントークンを定義し、ダークモードを外す

**Files:**
- Modify: `frontend/src/app/globals.css`（全面書き換え）
- Modify: `frontend/src/app/page.tsx:36, 38, 62`（`dark:` の 3 箇所を削除）

**Interfaces:**
- Consumes: なし
- Produces: Tailwind ユーティリティ `bg-canvas` / `bg-surface` / `text-ink` / `text-ink-muted` / `border-line` / `text-accent` / `bg-accent` / `bg-accent-strong` / `text-danger` / `rounded-card`。以降の全タスクがこれを使う

- [ ] **Step 1: `globals.css` を書き換える**

`frontend/src/app/globals.css` の全内容を次で置き換える。

```css
@import "tailwindcss";

/*
  Kotoe のデザイントークン。デザインブリーフ 0（docs/design_briefs.md）の
  「クリーンで余白広め、画像を引き立てる落ち着いた背景、アクセントカラー 1 色（青緑）、
  カード基調、角丸控えめ」を数値にしたもの。

  ダークモードは対応範囲に入れない（設計書「4. ダークモードは対応範囲に入れない」）。
  中途半端なダーク対応は無対応より悪い（背景だけ暗くなって文字が読めないカードが出る）
  ため、ここでは変数を定義するだけに留め、必要になったら変数の再定義で足りる形にする。
*/
@theme {
  --color-canvas: #fafaf9; /* 背景。白より一段落として画像とカードを浮かせる */
  --color-surface: #ffffff; /* カード面・ヘッダー・フッター */
  --color-ink: #1c1917; /* 本文 */
  --color-ink-muted: #57534e; /* 副次テキスト */
  --color-line: #e7e5e4; /* 境界線 */
  --color-accent: #0d9488; /* ブリーフの「青緑」 */
  --color-accent-strong: #0f766e; /* hover */
  --color-danger: #dc2626; /* バリデーションエラーの文字色 */
  --radius-card: 6px; /* 角丸は控えめ */
}

/*
  inline を付けるのは、値が @theme の外（layout.tsx の next/font）で定義された
  変数を参照しているため。
*/
@theme inline {
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

/*
  font-family に --font-geist-sans を直接書く。以前ここは
  `font-family: Arial, Helvetica, sans-serif;` で、layout.tsx が読み込んでいる
  Geist を上書きしてしまっていた（Next.js の初期テンプレート由来のバグ）。
*/
body {
  background-color: var(--color-canvas);
  color: var(--color-ink);
  font-family: var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif;
}
```

- [ ] **Step 2: `page.tsx` の `dark:` を消す**

`frontend/src/app/page.tsx` の 3 箇所を書き換える（このファイルは Task 7 で全面的に作り直すが、`dark:` を残すとタスク間で背景だけライト・文字だけダークという状態になるため、ここで消す）。

- `className="mt-2 text-zinc-600 dark:text-zinc-400"` → `className="mt-2 text-ink-muted"`
- `className="w-full max-w-md rounded-lg border border-zinc-200 p-6 dark:border-zinc-800"` → `className="w-full max-w-md rounded-card border border-line bg-surface p-6"`
- `className="text-sm text-red-600 dark:text-red-400"` → `className="text-sm text-danger"`

なお `src/app/_components/auth-probe.tsx` にも `dark:` が 8 箇所あるが、**このファイルは Task 7 で削除するので触らない**（削除するファイルを 2 回編集しない）。

- [ ] **Step 3: ビルドと lint が通ることを確認する**

```bash
docker compose exec frontend npm run lint
docker compose exec frontend npx tsc --noEmit
```

Expected: どちらもエラー 0 件。

- [ ] **Step 4: ブラウザで目視確認する**

`docker compose up -d` の状態で http://localhost:3001 を開く（ポートは `docker-compose.yml` で確認）。

- 背景が純白ではなく `#FAFAF9` の淡いグレーになっている（devtools で `body` の `background-color` が `rgb(250, 250, 249)`）
- 本文のフォントが Arial ではなく Geist になっている（devtools の Computed で `font-family` の先頭が Geist 系）
- OS をダークモードにしても配色が変わらない

- [ ] **Step 5: コミット**

```bash
git add frontend/src/app/globals.css frontend/src/app/page.tsx
git commit -m "$(cat <<'EOF'
feat(7-2): デザイントークンを定義し、ダークモードを外す

デザインブリーフ 0 の指定（落ち着いた背景・青緑のアクセント 1 色・角丸控えめ）を
CSS 変数にした。ダークモードはブリーフが求めておらず、6 画面ぶんのコストに対して
確認手段が OS 設定の切り替えしか無く実質検証されないため、対応範囲から外す。

あわせて globals.css の `font-family: Arial` を消した。layout.tsx が読み込んでいる
Geist をこれが上書きしていて、フォント指定が効いていなかった。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 認証状態の導出を純粋関数に切り出す

**Files:**
- Create: `frontend/src/lib/auth/derive-auth-state.ts`
- Test: `frontend/test/lib/auth/derive-auth-state.test.ts`

**Interfaces:**
- Consumes: `User`（`@/types/api`）
- Produces:
  - `type AuthState = { status: "loading" } | { status: "authenticated"; user: User } | { status: "unauthenticated" } | { status: "unreachable" }`
  - `type AuthStateInput = { hydrated: boolean; token: string | null; session: { token: string; user: User } | null; restoreFailedFor: string | null }`
  - `function deriveAuthState(input: AuthStateInput): AuthState`

- [ ] **Step 1: 失敗するテストを書く**

`frontend/test/lib/auth/derive-auth-state.test.ts` を新規作成する。

```ts
import { describe, expect, it } from "vitest";

import { deriveAuthState, type AuthStateInput } from "@/lib/auth/derive-auth-state";
import type { User } from "@/types/api";

const user: User = { id: 1, name: "つばき", email: "tsubaki@example.com" };

// 既定は「ハイドレーション済み・トークン無し」。各テストは必要な項目だけ上書きする。
const base: AuthStateInput = {
  hydrated: true,
  token: null,
  session: null,
  restoreFailedFor: null,
};

describe("deriveAuthState", () => {
  it("ハイドレーション前は、トークンがあっても loading を返す", () => {
    // 7-1 で実際に埋め込んだバグ。useSyncExternalStore はハイドレーション中に
    // getServerSnapshot（= null）を返すため、hydrated を先に見ないと、有効な
    // トークンを持つ人を「未ログイン」と誤判定して /login へ飛ばしてしまう。
    expect(deriveAuthState({ ...base, hydrated: false, token: "t1" })).toEqual({
      status: "loading",
    });
  });

  it("トークンが無ければ unauthenticated を返す", () => {
    expect(deriveAuthState({ ...base, token: null })).toEqual({ status: "unauthenticated" });
  });

  it("セッションが現在のトークンのものなら authenticated とユーザーを返す", () => {
    expect(deriveAuthState({ ...base, token: "t1", session: { token: "t1", user } })).toEqual({
      status: "authenticated",
      user,
    });
  });

  it("現在のトークンで復元に失敗していたら unreachable を返す（unauthenticated ではない）", () => {
    // ここを unauthenticated にすると、ヘッダーが「ログイン」を出す一方で
    // tokenStore にはトークンが残り、api.ts は Authorization を載せ続ける。
    expect(deriveAuthState({ ...base, token: "t1", restoreFailedFor: "t1" })).toEqual({
      status: "unreachable",
    });
  });

  it("別のトークンでの復元失敗は引きずらず、loading を返す", () => {
    // 再ログインでトークンが差し替わったケース。restoreFailedFor !== null だけで
    // 判定すると、新しいトークンでの復元が始まる前に unreachable になってしまう。
    expect(deriveAuthState({ ...base, token: "t2", restoreFailedFor: "t1" })).toEqual({
      status: "loading",
    });
  });

  it("別のトークンのセッションは authenticated にせず、loading を返す", () => {
    // session !== null だけで判定すると、トークンが差し替わった直後に
    // 古いユーザーを認証済みとして表示してしまう。
    expect(deriveAuthState({ ...base, token: "t2", session: { token: "t1", user } })).toEqual({
      status: "loading",
    });
  });
});
```

- [ ] **Step 2: テストを走らせて失敗を確認する**

```bash
docker compose exec frontend npm run test -- derive-auth-state
```

Expected: FAIL。`Failed to resolve import "@/lib/auth/derive-auth-state"` のような解決エラーになる。

- [ ] **Step 3: 最小の実装を書く**

`frontend/src/lib/auth/derive-auth-state.ts` を新規作成する。

```ts
import type { User } from "@/types/api";

/**
 * ログイン状態。7-1 では 3 状態 ＋ `restoreFailed: boolean` だったが、
 * 「トークンは残っているが GET /api/me の答えが得られない」を unauthenticated に
 * 混ぜると、ヘッダーが「ログイン」を出す一方で api.ts は Authorization を
 * 載せ続ける、という食い違いが起きる。4 つ目の状態として分ける。
 */
export type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: User }
  /** 未ログインが確定した（トークンが無い、または 401 で破棄された） */
  | { status: "unauthenticated" }
  /** トークンはあるが、有効かどうか確かめられない（通信断・5xx・CORS） */
  | { status: "unreachable" };

export type AuthStateInput = {
  /** ハイドレーションが済んだか */
  hydrated: boolean;
  /** tokenStore の現在値 */
  token: string | null;
  /** どのトークンに対して誰だと分かっているか */
  session: { token: string; user: User } | null;
  /** 復元に失敗したトークン。無限リトライを防ぐために覚えている */
  restoreFailedFor: string | null;
};

/**
 * 4 つの入力から表示すべき状態を決める。**判定の順序そのものが仕様**なので、
 * 行を入れ替えないこと。各行が前の行より先に来られない理由：
 *
 *   1. hydrated … ハイドレーション中は token が必ず null になる。これを先に
 *      見ないと、有効なトークンを持つ人を未ログインと誤判定する（7-1 のバグ）。
 *   2. token === null … トークンが無いなら他を見る必要が無い。
 *   3. session … signIn 直後。GET /api/me を叩き直さずに済ませる。
 *   4. restoreFailedFor … トークンの一致まで見る。再ログインで差し替わったら
 *      古い失敗を引きずらず、loading（= 再試行される）に落とす。
 */
export function deriveAuthState({
  hydrated,
  token,
  session,
  restoreFailedFor,
}: AuthStateInput): AuthState {
  if (!hydrated) return { status: "loading" };
  if (token === null) return { status: "unauthenticated" };
  if (session?.token === token) return { status: "authenticated", user: session.user };
  if (restoreFailedFor === token) return { status: "unreachable" };
  return { status: "loading" };
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
docker compose exec frontend npm run test -- derive-auth-state
docker compose exec frontend npm run lint
docker compose exec frontend npx tsc --noEmit
```

Expected: 6 件 PASS。lint / tsc ともエラー 0 件。

- [ ] **Step 5: コミット**

```bash
git add frontend/src/lib/auth/derive-auth-state.ts frontend/test/lib/auth/derive-auth-state.test.ts
git commit -m "$(cat <<'EOF'
feat(7-2): 認証状態の導出を純粋関数に切り出し、unreachable を足す

AuthProvider の useMemo にあった判定を deriveAuthState() として独立させた。
7-1 の申し送り 6 への対応で、「トークンは残っているが /api/me の答えが得られない」
状態を unauthenticated から分ける。

判定の順序そのものが仕様なので、順序を守らせるテストを 6 件書いた。トークンの
一致まで見る 2 つの比較（session / restoreFailedFor）は、それぞれ独立に落ちるよう
別のテストにしてある。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `AuthProvider` を差し替え、`retryRestore()` を足す

**Files:**
- Modify: `frontend/src/lib/auth/auth-context.tsx:18-35`（型定義）、`:120-180`（`retryRestore` 追加と `useMemo` の差し替え）
- Modify: `frontend/src/lib/auth/require-auth.tsx`（全面）

**Interfaces:**
- Consumes: `deriveAuthState` / `AuthState` / `AuthStateInput`（Task 2）
- Produces:
  - `useAuth()` の戻り値が `AuthState & { signUp; signIn; signOut; retryRestore(): void }` になる
  - **`restoreFailed: boolean` は無くなる。** 以降のタスクは `auth.status === "unreachable"` を見る

- [ ] **Step 1: `auth-context.tsx` の型定義を差し替える**

18-33 行目の `AuthState` の宣言と `AuthContextValue` を、次で置き換える（`AuthState` はローカル定義をやめて Task 2 から import する）。

```tsx
type AuthContextValue = AuthState & {
  signUp(params: { name: string; email: string; password: string }): Promise<void>;
  signIn(params: { email: string; password: string }): Promise<void>;
  signOut(): Promise<void>;
  /**
   * unreachable からの再試行。復元に失敗したトークンの記録を捨てて
   * GET /api/me をやり直す。7-1 は 401 以外の失敗でトークンを捨てずに
   * 未ログイン表示にしていたが、restoreFailedFor が同じトークンでの再試行を
   * 恒久的に塞ぐため、回復手段がリロードしか無かった。
   */
  retryRestore(): void;
};
```

あわせて import 文に次を足す。

```tsx
import { deriveAuthState, type AuthState } from "@/lib/auth/derive-auth-state";
```

- [ ] **Step 2: `retryRestore` を足し、`useMemo` を差し替える**

`signOut` の `useCallback` の直後に足す。

```tsx
  // 復元の useEffect は依存配列に restoreFailedFor を持っている（上の効果）ので、
  // null に戻すだけで GET /api/me が再実行される。新しい仕組みは要らない。
  const retryRestore = useCallback(() => setRestoreFailedFor(null), []);
```

166-180 行目の `useMemo` を、次で置き換える。

```tsx
  const value = useMemo<AuthContextValue>(
    () => ({
      ...deriveAuthState({ hydrated, token, session, restoreFailedFor }),
      signUp,
      signIn,
      signOut,
      retryRestore,
    }),
    [hydrated, token, session, restoreFailedFor, signUp, signIn, signOut, retryRestore],
  );
```

- [ ] **Step 3: `require-auth.tsx` を書き換える**

`frontend/src/lib/auth/require-auth.tsx` の全内容を次で置き換える。

```tsx
"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "@/lib/auth/auth-context";

/**
 * 認証必須ページのガード。画面遷移を知るのはこのファイルだけ。
 *
 * api.ts は失効を検知してもリダイレクトしない。認証不要ページ（お題一覧など）で
 * 期限が切れたときにユーザーを画面から放り出さないため、飛ばすかどうかは
 * ガードを敷いたページだけが決める。
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    // 飛ばすのは「未ログインが確定した」ときだけ。unreachable では飛ばさない
    // （トークンはまだ残っており、飛ばすと有効な JWT を持ったままログイン画面へ
    // 追い出される）。7-1 では restoreFailed フラグを併せて見る必要があったが、
    // 状態が分かれたので status だけで判断できる。
    if (auth.status !== "unauthenticated") return;

    // usePathname はクエリを含まない。/posts/1?sort=likes でガードに掛かると
    // ログイン後に並び順が失われるので、location から組み立てる。
    // useSearchParams を使わないのは、静的ページで Suspense 境界を要求し、
    // ローカルでは通るのに本番ビルドだけ落ちるため（設計書の申し送り）。
    const current = `${window.location.pathname}${window.location.search}`;

    // push ではなく replace。push だと、ログイン後に戻るボタンでここへ戻り、
    // また /login へ飛ばされるループができる。
    router.replace(`/login?next=${encodeURIComponent(current)}`);
    // pathname を依存に残すのは、クライアント遷移でここが再評価されるようにするため。
  }, [auth.status, pathname, router]);

  if (auth.status === "unreachable") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <p className="text-ink-muted">サーバーに接続できませんでした。</p>
        <button
          type="button"
          onClick={auth.retryRestore}
          className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong"
        >
          再試行
        </button>
      </div>
    );
  }

  if (auth.status !== "authenticated") {
    // レンダリング中に遷移してはいけないので、判定が付くまでは待つ表示を出す。
    // localStorage は SSR で読めないため、この一瞬は localStorage を選んだ
    // 時点で避けられない（7-1 設計書「A のコスト」）。
    return <p className="p-8 text-ink-muted">読み込み中…</p>;
  }

  return <>{children}</>;
}
```

- [ ] **Step 4: 型・lint・既存テストが通ることを確認する**

```bash
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run lint
docker compose exec frontend npm run test
```

Expected: すべてエラー 0 件。既存テスト（`api` / `token-store` / `safe-next-path`）＋ Task 2 の 6 件がすべて PASS。`restoreFailed` の参照がどこかに残っていれば tsc がここで落ちる。

- [ ] **Step 5: `/auth-check` で `unreachable` を手動確認する**

**このタスクでしかできない確認**である。`/auth-check` は Task 7 で削除するため、`RequireAuth` を使うページはこの後リポジトリから無くなる（次に使うのは 7-5）。

1. http://localhost:3001/ で `AuthProbe` からログインする
2. http://localhost:3001/auth-check を開き、認証済みの表示になることを確認する
3. devtools の Network タブで「Offline」を選ぶ
4. `/auth-check` を**リロード**する
5. 「サーバーに接続できませんでした。」と「再試行」ボタンが出ること、**`/login` へ飛ばされないこと**を確認する
6. Network を「No throttling」に戻し、「再試行」を押す
7. 「読み込み中…」を経て認証済みの表示に戻ることを確認する

- [ ] **Step 6: コミット**

```bash
git add frontend/src/lib/auth/auth-context.tsx frontend/src/lib/auth/require-auth.tsx
git commit -m "$(cat <<'EOF'
feat(7-2): AuthProvider を 4 状態に移し、retryRestore を足す

restoreFailed フラグを廃止し、deriveAuthState() の結果をそのまま公開する。
消費側は status だけを見れば済み、片方の見落としを型が防ぐ。

retryRestore() は restoreFailedFor を null に戻すだけ。復元の useEffect が
これを依存に持っているので、それだけで GET /api/me が再実行される。RequireAuth は
unreachable のときリダイレクトせず、再試行ボタンを出す。

devtools のオフラインで /auth-check をリロードし、/login へ飛ばされないことと、
再試行ボタンで復帰することを確認した。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: エラーコードの辞書

**Files:**
- Create: `frontend/src/lib/auth/error-messages.ts`
- Test: `frontend/test/lib/auth/error-messages.test.ts`

**Interfaces:**
- Consumes: `ApiError`（`@/lib/api`）
- Produces:
  - `type AuthFormErrors = { formError: string | null; fieldErrors: Record<string, string> }`
  - `function toAuthFormErrors(error: unknown): AuthFormErrors`

- [ ] **Step 1: 失敗するテストを書く**

`frontend/test/lib/auth/error-messages.test.ts` を新規作成する。

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { toAuthFormErrors } from "@/lib/auth/error-messages";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toAuthFormErrors", () => {
  it("401 invalid_credentials をフォーム全体のエラーに翻訳する", () => {
    const result = toAuthFormErrors(new ApiError(401, { error: "invalid_credentials" }));

    expect(result.formError).toBe("メールアドレスまたはパスワードが正しくありません");
    expect(result.fieldErrors).toEqual({});
  });

  it("422 のフィールド別エラーコードを翻訳する", () => {
    const result = toAuthFormErrors(new ApiError(422, { errors: { email: ["taken"] } }));

    expect(result.formError).toBeNull();
    expect(result.fieldErrors).toEqual({
      email: "このメールアドレスは既に登録されています",
    });
  });

  it("未知のエラーコードでも、空文字ではなくコードが分かる文言を返す", () => {
    // Rails 側にバリデーションが増えたとき、画面から何も出ない
    //（「押しても何も起きない」）状態にしないための保険。
    const result = toAuthFormErrors(new ApiError(422, { errors: { password: ["too_weak"] } }));

    expect(result.fieldErrors.password).toContain("password");
    expect(result.fieldErrors.password).toContain("too_weak");
  });

  it("fetch 自体の失敗（TypeError）を通信エラーとして扱う", () => {
    const result = toAuthFormErrors(new TypeError("Failed to fetch"));

    expect(result.formError).toBe("サーバーに接続できませんでした。通信環境を確認してください");
    expect(result.fieldErrors).toEqual({});
  });

  it("500 で JSON でないボディが返ってもサーバーエラーとして扱う", () => {
    // Render のプロキシや Vercel のエラーページは HTML を返す。
    // api.ts はそれを生の文字列のまま body に入れる（parseBody）。
    const result = toAuthFormErrors(new ApiError(500, "<html>Internal Server Error</html>"));

    expect(result.formError).toBe(
      "サーバーでエラーが発生しました。時間をおいて再度お試しください",
    );
  });

  it("想定外の例外は文言を返しつつ、原文を console.error に残す", () => {
    // extractToken が投げる Error（CORS の expose 設定が壊れている）がここに来る。
    // 握り潰すと「ログインは成功しているのに入れない」の原因が追えなくなる。
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("Authorization ヘッダから JWT を取得できませんでした");

    const result = toAuthFormErrors(error);

    expect(result.formError).toBe("認証に失敗しました。時間をおいて再度お試しください");
    expect(spy).toHaveBeenCalledWith(expect.any(String), error);
  });
});
```

- [ ] **Step 2: テストを走らせて失敗を確認する**

```bash
docker compose exec frontend npm run test -- error-messages
```

Expected: FAIL。`Failed to resolve import "@/lib/auth/error-messages"`。

- [ ] **Step 3: 実装を書く**

`frontend/src/lib/auth/error-messages.ts` を新規作成する。

```ts
// サーバーが返すエラーコードを画面の文言に翻訳する。
//
// CLAUDE.md の分担：ルールの判定はバック、見せ方（文言・i18n）はフロント。
// バックは invalid_credentials / {"errors":{"email":["taken"]}} のように
// コードだけを返し、日本語をここ 1 箇所に集約する。

import { ApiError } from "@/lib/api";

export type AuthFormErrors = {
  /** フォーム全体に出すエラー。フィールドに紐づかないもの */
  formError: string | null;
  /** フィールド名 → 文言 */
  fieldErrors: Record<string, string>;
};

/** 401 のボディ（Warden の FailureApp）のコード */
const FORM_MESSAGES: Record<string, string> = {
  invalid_credentials: "メールアドレスまたはパスワードが正しくありません",
  unauthorized: "セッションの有効期限が切れました。もう一度ログインしてください",
};

/**
 * 422 のフィールド別コード。Rails 側の実体に対応させる：
 * name は User の presence、email と password は devise validatable と
 * config.password_length = 6..128。
 */
const FIELD_MESSAGES: Record<string, Record<string, string>> = {
  name: { blank: "名前を入力してください" },
  email: {
    blank: "メールアドレスを入力してください",
    invalid: "メールアドレスの形式が正しくありません",
    taken: "このメールアドレスは既に登録されています",
  },
  password: {
    blank: "パスワードを入力してください",
    too_short: "パスワードは6文字以上で入力してください",
    too_long: "パスワードは128文字以下で入力してください",
  },
};

const NETWORK_MESSAGE = "サーバーに接続できませんでした。通信環境を確認してください";
const SERVER_MESSAGE = "サーバーでエラーが発生しました。時間をおいて再度お試しください";
const UNEXPECTED_MESSAGE = "認証に失敗しました。時間をおいて再度お試しください";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 未知のコードでも空文字を返さない。Rails 側にバリデーションが増えたとき、
 * 「送信しても画面に何も出ない」という原因の分からない状態になるのを防ぐ。
 */
function toFieldErrors(errors: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [field, codes] of Object.entries(errors)) {
    if (!Array.isArray(codes)) continue;

    const code = codes.find((candidate): candidate is string => typeof candidate === "string");
    if (code === undefined) continue;

    result[field] =
      FIELD_MESSAGES[field]?.[code] ?? `入力内容を確認してください（${field}: ${code}）`;
  }

  return result;
}

export function toAuthFormErrors(error: unknown): AuthFormErrors {
  if (error instanceof ApiError) {
    const body = error.body;

    if (error.status === 401 && isRecord(body) && typeof body.error === "string") {
      return { formError: FORM_MESSAGES[body.error] ?? SERVER_MESSAGE, fieldErrors: {} };
    }

    if (error.status === 422 && isRecord(body) && isRecord(body.errors)) {
      const fieldErrors = toFieldErrors(body.errors);

      // 422 なのに 1 件も翻訳できなかったときに無言で終わらせない。
      if (Object.keys(fieldErrors).length > 0) {
        return { formError: null, fieldErrors };
      }
    }

    // JSON でないボディ（Render のプロキシや Vercel の HTML エラーページ）も
    // ここに落ちる。api.ts が生の文字列のまま body に入れている。
    return { formError: SERVER_MESSAGE, fieldErrors: {} };
  }

  // fetch 自体が失敗すると TypeError になる（通信断・CORS・名前解決の失敗）。
  if (error instanceof TypeError) {
    return { formError: NETWORK_MESSAGE, fieldErrors: {} };
  }

  // extractToken が投げる Error がここに来る。CORS の expose 設定が壊れている
  // ときで、握り潰すと「ログインは成功しているのに入れない」という原因の
  // 分からない症状になる。文言はユーザー向けに丸め、原文はコンソールに残す。
  console.error("認証処理で想定外のエラーが発生しました", error);
  return { formError: UNEXPECTED_MESSAGE, fieldErrors: {} };
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
docker compose exec frontend npm run test -- error-messages
docker compose exec frontend npm run lint
docker compose exec frontend npx tsc --noEmit
```

Expected: 6 件 PASS。lint / tsc ともエラー 0 件。

- [ ] **Step 5: コミット**

```bash
git add frontend/src/lib/auth/error-messages.ts frontend/test/lib/auth/error-messages.test.ts
git commit -m "$(cat <<'EOF'
feat(7-2): エラーコードを画面の文言に翻訳する辞書

判定はバック・見せ方はフロント（CLAUDE.md）の分担に沿って、日本語をここ 1 箇所に
集約する。辞書が持つコードは Rails 側の実体（User の presence、devise validatable、
config.password_length = 6..128）に対応させた。

未知のコードで空文字を返さないのが要点。Rails 側にバリデーションが増えたときに
「送信しても画面に何も出ない」状態になるのを防ぐ。extractToken が投げる例外は
文言を丸めつつ原文を console.error に残す（CORS の expose 設定の切り分けに要る）。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: ヘッダー・フッターと、それを合成するルートレイアウト

**Files:**
- Create: `frontend/src/components/layout/site-header.tsx`
- Create: `frontend/src/components/layout/site-footer.tsx`
- Modify: `frontend/src/app/layout.tsx:38-42`（`<body>` の中身）

**Interfaces:**
- Consumes: `useAuth()` の 4 状態と `retryRestore`（Task 3）、デザイントークン（Task 1）
- Produces: `SiteHeader` / `SiteFooter`（名前付き export）。全ページに適用される

- [ ] **Step 1: フッターを書く**

`frontend/src/components/layout/site-footer.tsx` を新規作成する。`useAuth()` を呼ばないので `"use client"` は付けない（サーバーコンポーネントのままにする）。

```tsx
export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 px-4 py-6 text-xs text-ink-muted sm:flex-row sm:items-center sm:justify-between">
        <span>Kotoe（言絵）</span>
        <span>画像を言葉だけで描写し、その言葉から AI が再現する</span>
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: ヘッダーを書く**

`frontend/src/components/layout/site-header.tsx` を新規作成する。

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth/auth-context";

export function SiteHeader() {
  const auth = useAuth();
  const router = useRouter();

  async function handleSignOut() {
    await auth.signOut();

    // signOut() だけだと、ガード付きページ（7-5 以降の /posts/new・/mypage）からは
    // RequireAuth によって /login?next=... へ送られる。「抜ける」という意思表示に
    // 対してログインを促す画面を出すことになるので、認証不要なトップへ明示的に戻す。
    // replace ではなく push なのは、戻るボタンで直前のページに戻れてよいため
    //（ログアウト済みなので、そこで見えて困るものは無い）。
    router.push("/");
  }

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4">
        <Link href="/" className="text-lg font-semibold tracking-tight text-ink">
          Kotoe
        </Link>

        {/*
          中央のリンクは、そのルートを作る issue がここに足す。
          7-3: 「探す」→ /posts ／ 7-5:「お題を投稿」→ /posts/new ／
          7-6: アバター → /mypage ／ 7-7:「ランキング」→ /rankings。
          main は Vercel の本番を追跡するので、存在しないルートへのリンクは置かない
          （置いた瞬間に本番で 404 になる）。
        */}

        <nav className="flex items-center gap-3 text-sm">
          {/*
            loading のあいだはスケルトンを出す。SSR と初回クライアント描画は
            どちらも loading なので、ここで描くものが食い違うことはない。
          */}
          {auth.status === "loading" && (
            <span className="h-4 w-24 rounded bg-line" aria-hidden="true" />
          )}

          {auth.status === "unauthenticated" && (
            <>
              <Link href="/login" className="text-ink-muted hover:text-ink">
                ログイン
              </Link>
              <Link
                href="/signup"
                className="rounded-card bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent-strong"
              >
                新規登録
              </Link>
            </>
          )}

          {auth.status === "authenticated" && (
            <>
              {/* 公開 UGC。React が自動でエスケープするので、そのまま置いてよい */}
              <span className="text-ink-muted">{auth.user.name}</span>
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-card border border-line px-3 py-1.5 text-ink-muted hover:text-ink"
              >
                ログアウト
              </button>
            </>
          )}

          {/*
            unreachable で「ログイン」を出さないのが要点。この状態では
            tokenStore にトークンが残っており api.ts は Authorization を載せ続けるので、
            「ログイン」を出すと表示と実際の通信が食い違う。
          */}
          {auth.status === "unreachable" && (
            <>
              <span className="text-ink-muted">サーバーに接続できません</span>
              <button
                type="button"
                onClick={auth.retryRestore}
                className="rounded-card border border-line px-3 py-1.5 text-ink-muted hover:text-ink"
              >
                再試行
              </button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
```

- [ ] **Step 3: ルートレイアウトで合成する**

`frontend/src/app/layout.tsx` の import に足す。

```tsx
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
```

`<body>` のブロック（33-41 行目のコメントを含む範囲）を次で置き換える。

```tsx
      {/*
        AuthProvider はクライアントコンポーネントだが、children として渡された
        サーバーコンポーネントはサーバー描画のままこの中に収まる。全ページが
        クライアントコンポーネントになるわけではない（useAuth を呼ぶものだけ）。
      */}
      <body className="flex min-h-full flex-col">
        <AuthProvider>
          <SiteHeader />
          {/*
            children を flex-1 で包むのは、各ページが flex-1 を付け忘れても
            フッターが最下部に留まるようにするため。ページごとに忘れうる。
          */}
          <div className="flex flex-1 flex-col">{children}</div>
          <SiteFooter />
        </AuthProvider>
      </body>
```

- [ ] **Step 4: 型・lint が通ることを確認する**

```bash
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run lint
docker compose exec frontend npm run test
```

Expected: すべてエラー 0 件。テストは 12 件 + 既存が PASS。

- [ ] **Step 5: ブラウザで 4 状態を目視確認する**

http://localhost:3001/ を開く。**この時点では `/login` `/signup` がまだ無いので、ヘッダーのリンクは 404 になる**（Task 6 で解消する）。

- 未ログイン：ヘッダー右に「ログイン」「新規登録」、フッターが最下部に出る
- ログイン：`AuthProbe` からログインし、ヘッダー右がユーザー名＋「ログアウト」に変わる
- ログアウト：「ログアウト」を押すと `/` に留まり、「ログイン」「新規登録」に戻る
- `unreachable`：ログインした状態で devtools の Network を「Offline」にし、`/` をリロードする。ヘッダー右が「サーバーに接続できません」＋「再試行」になり、**「ログイン」が出ないこと**を確認する。オンラインに戻して「再試行」を押すと、ユーザー名に戻る

- [ ] **Step 6: コミット**

```bash
git add frontend/src/components/layout/site-header.tsx frontend/src/components/layout/site-footer.tsx frontend/src/app/layout.tsx
git commit -m "$(cat <<'EOF'
feat(7-2): 共通のヘッダーとフッターをルートレイアウトに合成する

ヘッダーは認証状態の 4 つすべてに表示を割り当てる。unreachable で「ログイン」を
出さないのが要点で、この状態では api.ts が Authorization を載せ続けるため、
出すと表示と実際の通信が食い違う。

ナビの中央リンクは置かない。main は Vercel の本番を追跡するので、まだ無いルートへの
リンクは本番で 404 になる。/posts は 7-3、/posts/new は 7-5、/mypage は 7-6 が足す。

ログアウトは signOut() のあとに / へ push する。signOut() だけだとガード付きページ
からは /login?next=... へ送られ、「抜ける」意思表示に対してログインを促す画面が出る。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `/login` と `/signup`

**Files:**
- Create: `frontend/src/components/ui/text-field.tsx`
- Create: `frontend/src/app/(auth)/layout.tsx`
- Create: `frontend/src/app/(auth)/login/page.tsx`
- Create: `frontend/src/app/(auth)/signup/page.tsx`

**Interfaces:**
- Consumes: `toAuthFormErrors` / `AuthFormErrors`（Task 4）、`safeNextPath`（既存）、`useAuth()`（Task 3）
- Produces: ルート `/login`・`/signup`（`(auth)` はルートグループなので URL には現れない）

- [ ] **Step 1: 入力欄のプリミティブを書く**

`frontend/src/components/ui/text-field.tsx` を新規作成する。

```tsx
type TextFieldProps = {
  id: string;
  label: string;
  type: "text" | "email" | "password";
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  /** サーバーが返したこのフィールドのエラー文言 */
  error?: string;
  minLength?: number;
};

/**
 * ラベル＋入力欄＋エラー表示。
 *
 * クライアント側の検証はブラウザ標準の属性（required / type / minLength）だけに
 * 留める。ルールの正は Rails が持っており（設計書「5.」）、ここで JS の検証を
 * 足すと同じルールを 2 箇所に持つことになる。標準の属性はサーバーの規則より
 * 緩いので、サーバーが受け付ける入力を弾いてしまうことがない。
 */
export function TextField({
  id,
  label,
  type,
  value,
  onChange,
  autoComplete,
  error,
  minLength,
}: TextFieldProps) {
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        minLength={minLength}
        required
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : errorId}
        className="rounded-card border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
      />
      {error !== undefined && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: `(auth)` のレイアウトを書く**

`frontend/src/app/(auth)/layout.tsx` を新規作成する。`(auth)` は**ルートグループ**なので URL には現れず、`/login` は `/login` のままになる。

```tsx
import type { ReactNode } from "react";

/**
 * /login と /signup が共有するカードの外枠。
 * ヘッダーとフッターはルートレイアウトが出すので、ここは本文だけを持つ。
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm rounded-card border border-line bg-surface p-6 shadow-sm">
        {children}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: `/login` を書く**

`frontend/src/app/(auth)/login/page.tsx` を新規作成する。

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { TextField } from "@/components/ui/text-field";
import { useAuth } from "@/lib/auth/auth-context";
import { toAuthFormErrors, type AuthFormErrors } from "@/lib/auth/error-messages";
import { safeNextPath } from "@/lib/auth/safe-next-path";

const NO_ERRORS: AuthFormErrors = { formError: null, fieldErrors: {} };

/**
 * 戻り先を決める。**描画中に呼んではいけない**（イベントハンドラと effect の中だけ）。
 *
 * useSearchParams() を使わずに window.location から読むのは、あちらが静的ページで
 * <Suspense> 境界を要求し、ローカルでは通るのに Vercel の本番ビルドだけ落ちるため
 *（7-1 の申し送り 3）。描画中に読まないので、ハイドレーションの不一致も起きない。
 *
 * safeNextPath() は不正な値に対して "/" を返すので、呼び出し側でフォールバックを
 * 書かない。書くと「検査した対象」と「実際に遷移する対象」が食い違う余地ができる。
 */
function resolveNextPath(): string {
  return safeNextPath(new URLSearchParams(window.location.search).get("next"));
}

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<AuthFormErrors>(NO_ERRORS);
  const [submitting, setSubmitting] = useState(false);

  // 認証済みでこの画面に来た場合（別タブでログインした、戻るボタンで戻ったなど）は
  // フォームを見せずに戻り先へ送る。unreachable のときは送らない：ログインし直せば
  // 新しいトークンが取れるので、この画面自体が回復手段のひとつになる。
  useEffect(() => {
    if (auth.status !== "authenticated") return;
    router.replace(resolveNextPath());
  }, [auth.status, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors(NO_ERRORS);
    setSubmitting(true);

    try {
      await auth.signIn({ email, password });
      // 成功時は submitting を false に戻さない。遷移が終わるまでのあいだに
      // 二重送信されるのを防ぐ。
      router.replace(resolveNextPath());
    } catch (error) {
      setErrors(toAuthFormErrors(error));
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-ink">ログイン</h1>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        {errors.formError !== null && (
          <p role="alert" className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">
            {errors.formError}
          </p>
        )}

        <TextField
          id="email"
          label="メールアドレス"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          error={errors.fieldErrors.email}
        />

        <TextField
          id="password"
          label="パスワード"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          error={errors.fieldErrors.password}
        />

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 rounded-card bg-accent px-4 py-2 font-medium text-white hover:bg-accent-strong disabled:opacity-60"
        >
          {submitting ? "送信中…" : "ログイン"}
        </button>
      </form>

      <p className="mt-6 text-sm text-ink-muted">
        アカウントをお持ちでない方は{" "}
        <Link href="/signup" className="text-accent hover:text-accent-strong">
          新規登録
        </Link>
      </p>
    </>
  );
}
```

- [ ] **Step 4: `/signup` を書く**

`frontend/src/app/(auth)/signup/page.tsx` を新規作成する。

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { TextField } from "@/components/ui/text-field";
import { useAuth } from "@/lib/auth/auth-context";
import { toAuthFormErrors, type AuthFormErrors } from "@/lib/auth/error-messages";
import { safeNextPath } from "@/lib/auth/safe-next-path";

const NO_ERRORS: AuthFormErrors = { formError: null, fieldErrors: {} };

/**
 * 戻り先を決める。**描画中に呼んではいけない**（イベントハンドラと effect の中だけ）。
 * 理由は /login と同じ：useSearchParams() は <Suspense> 境界を要求し、ローカルでは
 * 通るのに Vercel の本番ビルドだけ落ちる（7-1 の申し送り 3）。
 */
function resolveNextPath(): string {
  return safeNextPath(new URLSearchParams(window.location.search).get("next"));
}

export default function SignUpPage() {
  const auth = useAuth();
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<AuthFormErrors>(NO_ERRORS);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (auth.status !== "authenticated") return;
    router.replace(resolveNextPath());
  }, [auth.status, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors(NO_ERRORS);
    setSubmitting(true);

    try {
      await auth.signUp({ name, email, password });
      // 成功時は submitting を戻さない（二重送信の防止）。
      router.replace(resolveNextPath());
    } catch (error) {
      setErrors(toAuthFormErrors(error));
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-ink">新規登録</h1>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        {errors.formError !== null && (
          <p role="alert" className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">
            {errors.formError}
          </p>
        )}

        <TextField
          id="name"
          label="名前"
          type="text"
          value={name}
          onChange={setName}
          autoComplete="nickname"
          error={errors.fieldErrors.name}
        />

        <TextField
          id="email"
          label="メールアドレス"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          error={errors.fieldErrors.email}
        />

        {/*
          minLength は Rails の config.password_length = 6..128 に合わせた入力制約。
          ルールの再実装ではなく、往復を 1 回減らすためのもの。破られてもサーバーが
          必ず弾き、返ってきた too_short を辞書が翻訳する。
        */}
        <TextField
          id="password"
          label="パスワード（6文字以上）"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={6}
          error={errors.fieldErrors.password}
        />

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 rounded-card bg-accent px-4 py-2 font-medium text-white hover:bg-accent-strong disabled:opacity-60"
        >
          {submitting ? "送信中…" : "登録する"}
        </button>
      </form>

      <p className="mt-6 text-sm text-ink-muted">
        既にアカウントをお持ちの方は{" "}
        <Link href="/login" className="text-accent hover:text-accent-strong">
          ログイン
        </Link>
      </p>
    </>
  );
}
```

- [ ] **Step 5: 型・lint・テストが通ることを確認する**

```bash
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run lint
docker compose exec frontend npm run test
```

Expected: すべてエラー 0 件。

- [ ] **Step 6: ブラウザで一通り確認する**

1. http://localhost:3001/signup で新規登録する → ヘッダーがユーザー名に変わり、`/` へ移動する
2. ヘッダーの「ログアウト」→ `/` に留まり、未ログイン表示に戻る
3. http://localhost:3001/login でログインする → `/` へ移動する
4. **エラー表示**：`/login` でパスワードを間違える → 「メールアドレスまたはパスワードが正しくありません」がフォーム上部に出る
5. **フィールド別エラー**：`/signup` で既に登録済みのメールアドレスを使う → メールアドレス欄の下に「このメールアドレスは既に登録されています」が出る
6. **通信エラー**：devtools を Offline にして `/login` から送信 → 「サーバーに接続できませんでした。通信環境を確認してください」が出る
7. **`?next=` の正常系**：`/login?next=/auth-check` を開いてログイン → `/auth-check` へ移動する（`/auth-check` は Task 7 で削除するので、この確認はこのタスクの時点でしかできない）
8. **`?next=` の防御**（`safeNextPath` が効いていること）：次の 3 つを開いてログインし、いずれも `/` に着地することを確認する
   - `/login?next=//evil.example`
   - `/login?next=%2F%09%2Fevil.example`（デコードすると `/\t/evil.example`）
   - `/login?next=javascript:alert(1)`
9. **認証済みで `/login`**：ログインしたまま `/login` を開く → フォームが出ずに `/` へ移動する

- [ ] **Step 7: コミット**

```bash
git add "frontend/src/app/(auth)" frontend/src/components/ui/text-field.tsx
git commit -m "$(cat <<'EOF'
feat(7-2): ログインと新規登録の画面を足す

ルートグループ (auth) でカードの外枠を共有し、フォーム本体は各ページが持つ。
2〜3 項目のフォーム 2 つに対して共通の AuthForm を作ると、フィールドを配列で
定義する設定駆動フォームになって読みにくくなるだけなので作らない。

?next= は window.location.search から、描画中ではなくイベントハンドラと effect の
中だけで読む。useSearchParams() を使うと <Suspense> 境界が必要になり、ローカルでは
通るのに Vercel の本番ビルドだけ落ちる。値は必ず safeNextPath() を通す。

クライアント側の検証はブラウザ標準の属性だけ。ルールの正は Rails が持ち、返って
きたエラーコードを辞書が翻訳する。//evil.example・%2F%09%2Fevil.example・
javascript: が / に落ちることを確認した。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 仮トップに差し替え、7-1 の暫定 UI を削除する

**Files:**
- Create: `frontend/src/components/dev/health-panel.tsx`
- Modify: `frontend/src/app/page.tsx`（全面書き換え）
- Delete: `frontend/src/app/_components/auth-probe.tsx`
- Delete: `frontend/src/app/auth-check/page.tsx`

**Interfaces:**
- Consumes: `useAuth()`（Task 3）、`apiFetch` / `HealthResponse`（既存）
- Produces: なし（このタスクで完結する）

- [ ] **Step 1: health パネルを切り出す**

`frontend/src/components/dev/health-panel.tsx` を新規作成する。現在の `page.tsx` にある疎通確認 UI をそのまま移す。

```tsx
"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";
import type { HealthResponse } from "@/types/api";

type HealthState =
  | { kind: "loading" }
  | { kind: "success"; health: HealthResponse }
  | { kind: "failure" };

/**
 * Rails API への疎通確認パネル。**本番では描画しない**（page.tsx が出し分ける）。
 *
 * コンポーネントごと切り出しているのは、GET /api/health を叩く useEffect を
 * 条件分岐の中に置けないため。出し分けをコンポーネント単位にすれば、本番では
 * effect も動かない。
 *
 * 消さずに残すのは、CLAUDE.md の「PR を出すたび Vercel のプレビュー URL で確認する」
 * を実際に支えているのがこれだから。CORS の許可オリジンや NEXT_PUBLIC_API_BASE_URL
 * の設定ミスは、まずここで見つかる。
 */
export function HealthPanel() {
  const [state, setState] = useState<HealthState>({ kind: "loading" });

  useEffect(() => {
    apiFetch<HealthResponse>("/api/health")
      .then((health) => setState({ kind: "success", health }))
      .catch(() => setState({ kind: "failure" }));
  }, []);

  return (
    <section className="w-full max-w-md rounded-card border border-line bg-surface p-6">
      <h2 className="mb-4 text-sm font-semibold text-ink-muted">Rails API 疎通確認</h2>

      {state.kind === "loading" && <p className="text-ink-muted">確認中…</p>}

      {state.kind === "success" && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          <dt className="text-ink-muted">API</dt>
          <dd className="font-mono">{state.health.status}</dd>
          <dt className="text-ink-muted">データベース</dt>
          <dd className="font-mono">{state.health.database}</dd>
        </dl>
      )}

      {/*
        原因をローカル前提で断定しない。ここはプレビューでも表示され、そこでの
        失敗理由はたいてい CORS の許可オリジンか NEXT_PUBLIC_API_BASE_URL であって、
        backend が起動していないことではない。7-1 のプレビュー確認で実際に
        「docker compose up を確認してください」と案内し、切り分けを遅らせた。
      */}
      {state.kind === "failure" && (
        <p className="text-sm text-danger">
          Rails API に接続できませんでした。ブラウザの Console と Network を確認してください
          （ローカルなら backend の起動、別オリジンなら CORS の許可オリジンと
          NEXT_PUBLIC_API_BASE_URL が主な原因です）。
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 2: トップページを書き換える**

`frontend/src/app/page.tsx` の全内容を次で置き換える。

```tsx
"use client";

import Link from "next/link";

import { HealthPanel } from "@/components/dev/health-panel";
import { useAuth } from "@/lib/auth/auth-context";

/**
 * 疎通確認パネルを出すかどうか。
 *
 * NEXT_PUBLIC_VERCEL_ENV は Vercel が自動で入れる変数で、本番のビルドでは
 * "production"、プレビューのビルドでは "preview"、ローカルでは未定義になる。
 * つまりローカルとプレビューでは今まで通り表示され、本番でだけ消える。
 * NEXT_PUBLIC_* はビルド時に値が埋め込まれるので、この条件は定数に畳まれる。
 *
 * 本来のトップ（ヒーロー＋遊び方＋新着/人気）は 7-7。それまでこのページが
 * 本番のトップになるため、デバッグ用のパネルを出しっぱなしにしない。
 */
const SHOW_HEALTH_PANEL = process.env.NEXT_PUBLIC_VERCEL_ENV !== "production";

export default function Home() {
  const auth = useAuth();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-10 p-8">
      <div className="max-w-xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          言葉だけで、その絵を伝えられますか。
        </h1>
        <p className="mt-3 text-ink-muted">
          画像を言葉で描写すると、その言葉から AI が画像を再現します。どれだけ近づけるかを競うゲームです。
        </p>

        {/*
          CTA もナビと同じ方針で、実在するルートだけを出す。「お題を探す」→ /posts は
          7-3 が、「お題を投稿」→ /posts/new は 7-5 がここに足す。
        */}
        {auth.status === "unauthenticated" && (
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              href="/signup"
              className="rounded-card bg-accent px-5 py-2.5 font-medium text-white hover:bg-accent-strong"
            >
              新規登録
            </Link>
            <Link
              href="/login"
              className="rounded-card border border-line px-5 py-2.5 font-medium text-ink-muted hover:text-ink"
            >
              ログイン
            </Link>
          </div>
        )}
      </div>

      {SHOW_HEALTH_PANEL && <HealthPanel />}
    </main>
  );
}
```

- [ ] **Step 3: 暫定 UI を削除する**

```bash
git rm frontend/src/app/_components/auth-probe.tsx frontend/src/app/auth-check/page.tsx
```

`frontend/src/app/_components/` と `frontend/src/app/auth-check/` が空になり、git から消えることを確認する。

```bash
ls frontend/src/app
```

Expected: `_components` と `auth-check` が無く、`(auth)` / `favicon.ico` / `globals.css` / `layout.tsx` / `page.tsx` が残っている。

- [ ] **Step 4: 型・lint・テスト・本番ビルドを確認する**

```bash
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run lint
docker compose exec frontend npm run test
docker compose exec frontend npm run build
```

Expected: すべて成功。`npm run build` を回すのは、`(auth)` のルートグループと `useSearchParams` 不使用が本番ビルドでも問題ないことを、Vercel に出す前に確認するため。

- [ ] **Step 5: health パネルの出し分けを確認する**

ローカル（未定義）で出ることを確認する。

```bash
# http://localhost:3001/ を開き、「Rails API 疎通確認」が出ていること
```

本番相当のビルドで消えることを確認する。

```bash
docker compose exec -e NEXT_PUBLIC_VERCEL_ENV=production frontend npm run build
docker compose exec frontend sh -c 'grep -rl "Rails API 疎通確認" .next/static 2>/dev/null || echo "本番ビルドの静的チャンクに文言が無い"'
```

Expected: 「本番ビルドの静的チャンクに文言が無い」と表示される。文言を含むチャンクが見つかった場合は、条件が定数に畳まれていないので `SHOW_HEALTH_PANEL` の定義位置（モジュールトップレベルであること）を見直す。

確認後、ローカル用にビルドし直す。

```bash
docker compose exec frontend npm run build
```

- [ ] **Step 6: 全体を通しで手動確認する**

1. `/` → ヒーローと CTA、疎通確認パネルが出る
2. `/signup` から登録 → ヘッダーがユーザー名になり `/` へ戻る。CTA が消える
3. ヘッダーの「ログアウト」→ `/` で未ログイン表示、CTA が戻る
4. `/login` からログイン
5. `/auth-check` が **404 になる**こと（削除済み）

- [ ] **Step 7: コミット**

```bash
git add frontend/src/app/page.tsx frontend/src/components/dev/health-panel.tsx
git commit -m "$(cat <<'EOF'
feat(7-2): 仮トップに差し替え、7-1 の暫定 UI を削除する

7-1 の申し送り 1 への対応。auth-probe.tsx と auth-check/ を消す。main は Vercel の
本番を追跡するので、これは「パスワードが初期値で入った認証パネル」として本番トップに
公開されていた。

疎通確認パネルは残すが、NEXT_PUBLIC_VERCEL_ENV で本番だけ隠す。プレビュー URL での
確認（CLAUDE.md の運用）を支えているのがこれで、消すと CORS や API ベース URL の
設定ミスの切り分け手段を失う。effect を条件分岐に置けないので、コンポーネントごと
切り出して出し分ける。

本来のトップ（ヒーロー＋遊び方＋新着/人気）は 7-7。それまで本番のトップになるため、
デバッグ画面のままにはしない。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## 完了後の確認

すべてのタスクが終わったら、PR を出す前に次を確認する。

- [ ] `docker compose exec frontend npm run lint` / `npx tsc --noEmit` / `npm run test` / `npm run build` がすべて成功する
- [ ] `git grep -n "restoreFailed" frontend/src` が **0 件**（フラグが残っていない。`restoreFailedFor` は `auth-context.tsx` の内部状態なのでヒットしてよい）
- [ ] `git grep -n "dark:" frontend/src` が **0 件**
- [ ] `git grep -n "useSearchParams" frontend/src` が **0 件**
- [ ] `git grep -rn "AuthProbe\|auth-check" frontend/src` が **0 件**
- [ ] `/code-review` を通す（CLAUDE.md 由来の運用。プッシュ前に独立レビューを挟む）
- [ ] PR 本文に **`Closes #NN`** を書く（issue 番号は GitHub で 7-2 の issue を確認する）
- [ ] PR 本文にセッションリンクを載せない（public リポジトリ）
- [ ] Vercel のプレビュー URL で、疎通確認パネルが表示され、`/login` `/signup` が動くことを確認する

## この計画で作らないもの

- ナビの「探す」「ランキング」「お題を投稿」リンク（7-3 / 7-5 / 7-7）
- `apiRequest` の timeout / `AbortSignal`（7-3）
- `RequireAuth` を使うページ（7-5 が最初）
- パスワードリセット・メール確認・Google ログイン
- ダークモード、CSP（8-5）
