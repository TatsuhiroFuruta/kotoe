# issue 7-1 APIクライアントと認証プラミング 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Next.js 側に JWT の保存・付与・失効検知とログイン状態の管理を入れ、7-2 以降の全画面が乗る土台を作る。

**Architecture:** トークンは `localStorage` に置き（`token-store.ts`）、`api.ts` が全リクエストに `Authorization` ヘッダを載せる。**トークンを載せたリクエストが 401 を返したときだけ**トークンを破棄する（Rails はパスワード不一致も失効も同じ 401 で返すため）。破棄は `token-store` の購読者へ通知され、`AuthProvider` が `useSyncExternalStore` 経由で状態を落とす。画面遷移を知るのは `RequireAuth` だけ。

**Tech Stack:** Next.js 16.2.10（App Router）/ React 19.2.4 / TypeScript 5 / Vitest + jsdom / Node 24

**Spec:** `docs/superpowers/specs/2026-09-01-issue-7-1-api-client-auth-design.md`

## Global Constraints

- **作業ブランチは `feat/issue-7-1-api-client-auth`。** main へ直接コミットしない。この issue は 1 PR にまとめる。
- **バックエンド（`backend/`）は一切変更しない。** 変更は `frontend/` と `.github/workflows/ci.yml` に閉じる。
- **コマンドはすべてコンテナ内で実行する。** `docker compose exec frontend <cmd>`（リポジトリのルートから）。ホストに `node_modules` は無い（compose の名前付きボリューム `node_modules` に載っている）。
- **文字列はダブルクォート。** バックエンドの規約に合わせ、フロントも統一する。
- **`any` を使わない。** API レスポンスには必ず型を付ける（`frontend/CLAUDE.md` → `AGENTS.md`、ルートの `CLAUDE.md`）。
- **コメントは日本語。** 既存の `frontend/src/lib/api.ts` と `src/app/page.tsx` の密度に合わせる（「なぜそうしたか」を書き、「何をしているか」は書かない）。
- **React Testing Library を入れない。** コンポーネント結合テストは E2E（8-1）と役割が被るため、`CLAUDE.md` が見送っている。テスト対象は `src/lib/` 配下の純粋ロジックのみ。
- **Playwright の E2E は書かない。** 8-1 の担当。
- **テストは合計 22 件になる。** 設計書は必須 17 ケースを挙げているが、この計画はそれに 5 件（`safe-next-path` の外部オリジン絶対 URL と空文字、`token-store` の購読通知と `getServerSnapshot`、`api.ts` の `apiRequest` が `Response` を返すこと）を足している。いずれも既存ケースと矛盾しない追加で、後続タスクが依存するインターフェースを固定するためのもの。
- **API のベース URL は `process.env.NEXT_PUBLIC_API_BASE_URL`。** ローカルは `http://localhost:3000`。`NEXT_PUBLIC_` の付かない秘密情報をフロントに置かない。
- **Next.js 16 は訓練データと違う可能性がある。** 迷ったらコンテナ内の `node_modules/next/dist/docs/` を読む（`frontend/AGENTS.md`）。`useRouter` は `next/navigation` から import する（`next/router` ではない）。

### バックエンドの応答（変更しない前提）

| 経路 | 送るもの | 返るもの |
|---|---|---|
| `POST /api/auth/sign_up` | `{ user: { name, email, password } }` | 201 ＋ `{id, name, email}`、`Authorization: Bearer …` |
| `POST /api/auth/sign_in` | `{ user: { email, password } }` | 200 ＋ `{id, name, email}`、`Authorization: Bearer …` |
| `DELETE /api/auth/sign_out` | Authorization ヘッダ | **200・ボディ空**（204 ではない） |
| `GET /api/me` | Authorization ヘッダ | 200 ＋ `{id, name, email, stats:{posts_count, attempts_count, likes_received_count}}` |
| 認証失敗 | — | 401 `{"error": "invalid_credentials" \| "unauthorized"}` |
| 検証失敗 | — | 422 `{"errors": {"email": ["taken"]}}` |

---

## ファイル構成

| ファイル | 責務 | タスク |
|---|---|---|
| `frontend/vitest.config.ts` | テスト実行の設定（jsdom、`@/` エイリアス、env） | 1 |
| `frontend/src/lib/auth/safe-next-path.ts` | `?next=` の検証。純粋関数。何も知らない | 1 |
| `frontend/src/lib/auth/token-store.ts` | 「トークンは今なにか」だけを知る。React も fetch も知らない | 2 |
| `frontend/src/lib/api.ts` | HTTP を叩き、トークンを載せ、失効を検知して捨てる。React も画面遷移も知らない | 3 |
| `frontend/src/types/api.ts` | API レスポンスの型 | 4 |
| `frontend/src/lib/auth/auth-context.tsx` | 今のログイン状態は何か、どう変えるか。`localStorage` の詳細も画面遷移も知らない | 4 |
| `frontend/src/app/layout.tsx` | `AuthProvider` を全ページに巻く | 4 |
| `frontend/src/app/_components/auth-probe.tsx` | 動作確認用の暫定 UI（7-7 で削除） | 5 |
| `frontend/src/app/page.tsx` | 暫定トップ。確認カードを差し込む（7-7 で差し替え） | 5 |
| `frontend/src/lib/auth/require-auth.tsx` | 未ログインならどこへ飛ばすか。**画面遷移を知るのはここだけ** | 6 |
| `frontend/src/app/auth-check/page.tsx` | ガード動作確認用の暫定ページ（7-2 で削除） | 6 |
| `.github/workflows/ci.yml` | `frontend` ジョブ（lint / typecheck / test） | 7 |

---

## Task 1: Vitest の導入と `safe-next-path`

**Files:**
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/lib/auth/safe-next-path.ts`
- Create: `frontend/src/lib/auth/safe-next-path.test.ts`
- Modify: `frontend/package.json`（`devDependencies` と `scripts.test`）

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces: `safeNextPath(next: string | null | undefined): string` — 安全な同一オリジンの絶対パスか、`"/"` を返す。Task 6 の `RequireAuth` と 7-2 のログイン画面が使う。`npm run test` が動く状態。

テストの足場をここで作るのは、`safe-next-path` が最初のテスト対象だから。設定だけを単独タスクにしても「動いた」と言える成果物にならない。

- [ ] **Step 1: 依存を入れる**

```bash
docker compose exec frontend npm install --save-dev vitest jsdom
```

`package.json` と `package-lock.json` はバインドマウント上なのでホスト側にも反映される。`node_modules` は名前付きボリュームに入る。

- [ ] **Step 2: `package.json` に test スクリプトを足す**

`"scripts"` に 1 行追加する（既存の `dev` / `build` / `start` / `lint` は変えない）。

```json
    "test": "vitest run"
```

- [ ] **Step 3: `frontend/vitest.config.ts` を作る**

```ts
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Vitest は Next.js のビルドを経由しないので、tsconfig.json の paths も
// NEXT_PUBLIC_* の埋め込みも効かない。どちらもここで自前に用意する。
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // token-store と api は localStorage と Response を触るため DOM が要る。
    // window が無い場合（SSR）の検査だけは、ファイル先頭の
    // `// @vitest-environment node` で node に切り替える。
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    env: {
      // api.ts はモジュール読み込み時にこれを読む。未設定だと全テストが落ちる。
      NEXT_PUBLIC_API_BASE_URL: "http://localhost:3000",
    },
  },
});
```

- [ ] **Step 4: 失敗するテストを書く**

`frontend/src/lib/auth/safe-next-path.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/auth/safe-next-path";

describe("safeNextPath", () => {
  it("自サイト内の絶対パスはそのまま通す", () => {
    expect(safeNextPath("/mypage")).toBe("/mypage");
    expect(safeNextPath("/posts/1?sort=likes")).toBe("/posts/1?sort=likes");
  });

  // Next.js のドキュメントいわく、未検証の URL を router.replace に渡すと
  // javascript: がページのコンテキストで実行される。
  it("javascript: スキームは / に落とす", () => {
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
  });

  it("外部オリジンへの絶対 URL は / に落とす", () => {
    expect(safeNextPath("https://evil.example/steal")).toBe("/");
  });

  // 「/」で始まるが別オリジンへ飛ぶ2つの形。ここを見落とすと
  // ホワイトリストが素通しになる。
  it("protocol-relative な //host は / に落とす", () => {
    expect(safeNextPath("//evil.example")).toBe("/");
  });

  it("バックスラッシュの /\\host は / に落とす", () => {
    expect(safeNextPath("/\\evil.example")).toBe("/");
  });

  it("未指定・空文字は / を返す", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });
});
```

- [ ] **Step 5: テストが失敗することを確認する**

```bash
docker compose exec frontend npm run test
```

Expected: FAIL。`Failed to resolve import "@/lib/auth/safe-next-path"`。

- [ ] **Step 6: 実装する**

`frontend/src/lib/auth/safe-next-path.ts`：

```ts
export const DEFAULT_NEXT_PATH = "/";

/**
 * `?next=` に載っていた戻り先を、遷移して安全な形に正規化する。
 *
 * `?next=` は URL に載る＝攻撃者が自由に書ける値なので、そのまま
 * router.replace() へ渡してはいけない。Next.js のドキュメント（use-router.md）に
 * 「未検証の URL を router.push / router.replace に渡すと `javascript:` URL が
 * ページのコンテキストで実行される」と明記されている。外部サイトへの
 * オープンリダイレクトも同じ経路で成立する。
 *
 * 判定に URL パーサを使わず、通す形を列挙するホワイトリスト方式にする。
 * パーサは受理する形が広く実装差もあるため、「拒否したい形」を数え上げる
 * 方式にすると数え漏れがそのまま穴になる。
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next) return DEFAULT_NEXT_PATH;

  // 「/」で始まらないものは全部拒否する（javascript: も https:// もここで落ちる）。
  if (!next.startsWith("/")) return DEFAULT_NEXT_PATH;

  // 「/」で始まるが別オリジンへ飛ぶ2つの形。
  if (next.startsWith("//") || next.startsWith("/\\")) return DEFAULT_NEXT_PATH;

  return next;
}
```

- [ ] **Step 7: テストが通ることを確認する**

```bash
docker compose exec frontend npm run test
```

Expected: PASS（6 テスト）。

- [ ] **Step 8: lint と型検査を通す**

```bash
docker compose exec frontend npm run lint
docker compose exec frontend npx tsc --noEmit
```

Expected: どちらもエラーなし。

- [ ] **Step 9: コミット**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts \
        frontend/src/lib/auth/safe-next-path.ts frontend/src/lib/auth/safe-next-path.test.ts
git commit -m "test: Vitest を導入し ?next= の検証を追加（issue 7-1）"
```

---

## Task 2: `token-store`

**Files:**
- Create: `frontend/src/lib/auth/token-store.ts`
- Create: `frontend/src/lib/auth/token-store.test.ts`
- Create: `frontend/src/lib/auth/token-store.server.test.ts`

**Interfaces:**
- Consumes: Task 1 の Vitest 設定
- Produces: `tokenStore` オブジェクト。
  - `get(): string | null`
  - `set(token: string): void`
  - `clear(): void`
  - `subscribe(listener: () => void): () => void`
  - `getServerSnapshot(): null`

  Task 3（`api.ts` が `get` / `clear`）と Task 4（`AuthProvider` が `subscribe` / `get` / `getServerSnapshot` / `set` / `clear`）が使う。

`get` はキャッシュを持たず、毎回 `localStorage` を読む。`useSyncExternalStore` は `getSnapshot` の戻り値を `Object.is` で比較するが、文字列と `null` は値で比較されるため参照の安定は不要。キャッシュを足すと、テストから「読み出しが例外を投げる環境」を再現できなくなる。

- [ ] **Step 1: 失敗するテストを書く（jsdom 環境）**

`frontend/src/lib/auth/token-store.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tokenStore } from "@/lib/auth/token-store";

describe("tokenStore", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // モジュール内のフォールバック変数も初期化する。
    tokenStore.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("保存したトークンを読み出せる", () => {
    tokenStore.set("jwt-abc");

    expect(tokenStore.get()).toBe("jwt-abc");
  });

  it("clear すると null を返す", () => {
    tokenStore.set("jwt-abc");

    tokenStore.clear();

    expect(tokenStore.get()).toBeNull();
  });

  it("set / clear で購読者に通知する", () => {
    const listener = vi.fn();
    const unsubscribe = tokenStore.subscribe(listener);

    tokenStore.set("jwt-abc");
    tokenStore.clear();

    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    tokenStore.set("jwt-def");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  // プライベートモードや「サイトデータを拒否」設定のブラウザでは
  // localStorage へのアクセス自体が例外を投げる。ここで落とすと、
  // AuthProvider はルートレイアウトに入るのでサイト全体が壊れる。
  it("読み出しが例外を投げる環境でも null を返す", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("access denied");
    });

    expect(() => tokenStore.get()).not.toThrow();
    expect(tokenStore.get()).toBeNull();
  });

  // 書き込めない環境でメモリに退避していないと、ログイン直後に
  // 「トークンが読めない＝未ログイン」に戻り、何度ログインしても入れなくなる。
  it("書き込みが例外を投げる環境でも、同じセッション内では読み出せる", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    tokenStore.set("jwt-abc");

    expect(tokenStore.get()).toBe("jwt-abc");
  });
});
```

- [ ] **Step 2: 失敗するテストを書く（node 環境 ＝ SSR）**

`frontend/src/lib/auth/token-store.server.test.ts`：

```ts
// @vitest-environment node

import { describe, expect, it } from "vitest";

import { tokenStore } from "@/lib/auth/token-store";

// AuthProvider はルートレイアウトに入るため、認証不要ページを含む全ページの
// サーバーレンダリングでここが呼ばれる。落とすとサイト全体が 500 になる。
describe("tokenStore（window が無い環境）", () => {
  it("get は例外を投げず null を返す", () => {
    expect(() => tokenStore.get()).not.toThrow();
    expect(tokenStore.get()).toBeNull();
  });

  it("getServerSnapshot は null を返す", () => {
    expect(tokenStore.getServerSnapshot()).toBeNull();
  });
});
```

- [ ] **Step 3: テストが失敗することを確認する**

```bash
docker compose exec frontend npm run test
```

Expected: FAIL。`Failed to resolve import "@/lib/auth/token-store"`。

- [ ] **Step 4: 実装する**

`frontend/src/lib/auth/token-store.ts`：

```ts
/**
 * JWT の置き場所。localStorage の読み書きと、その変更の購読だけを担う。
 * React も fetch も知らない。
 *
 * localStorage を選んだ理由と、cookie を選ばなかった理由は設計書を参照
 * （httpOnly でない cookie は XSS 耐性が localStorage と変わらないため、
 * middleware ガードのためだけに構成を増やす価値が無い）。
 */

const STORAGE_KEY = "kotoe.auth.token";

// 自タブ用の購読者。window の storage イベントは他タブでしか発火しないため、
// 自分で set / clear したときの通知は自前で配る必要がある。
const listeners = new Set<() => void>();

// localStorage へ書き込めない環境（プライベートモード等）のフォールバック。
// タブを閉じると消えるが、その 1 セッションは成立する。これが無いと、
// そういうブラウザではログイン直後に未ログインへ戻り、何度でも弾かれる。
let fallbackToken: string | null = null;

function readStorage(): string | null {
  // SSR では window が無い。サイトデータを拒否している環境では
  // localStorage へのアクセス自体が例外を投げる。どちらも落とさない。
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return fallbackToken;
  }
}

function writeStorage(token: string | null): void {
  fallbackToken = token;

  if (typeof window === "undefined") return;

  try {
    if (token === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, token);
    }
  } catch {
    // 書けない環境。fallbackToken だけで動く。
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

export const tokenStore = {
  // キャッシュを持たず毎回読む。useSyncExternalStore は戻り値を Object.is で
  // 比較するが、文字列と null は値で比較されるため参照の安定は要らない。
  get(): string | null {
    return readStorage();
  },

  set(token: string): void {
    writeStorage(token);
    notify();
  },

  clear(): void {
    writeStorage(null);
    notify();
  },

  /**
   * useSyncExternalStore 用。自タブの set / clear と、他タブの storage イベントを
   * 購読する。React は subscribe を effect の中でしか呼ばないため、
   * ここでは window があることを前提にしてよい。
   */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);

    const onStorage = (event: StorageEvent) => {
      // key が null なのは localStorage.clear() のとき。これも取りこぼさない。
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      listener();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  },

  /** SSR 時のスナップショット。サーバーはトークンを持ち得ない。 */
  getServerSnapshot(): null {
    return null;
  },
};
```

- [ ] **Step 5: テストが通ることを確認する**

```bash
docker compose exec frontend npm run test
```

Expected: PASS（Task 1 の 6 ＋ jsdom 5 ＋ node 2 ＝ 13 テスト）。

- [ ] **Step 6: lint と型検査を通す**

```bash
docker compose exec frontend npm run lint
docker compose exec frontend npx tsc --noEmit
```

- [ ] **Step 7: コミット**

```bash
git add frontend/src/lib/auth/token-store.ts \
        frontend/src/lib/auth/token-store.test.ts \
        frontend/src/lib/auth/token-store.server.test.ts
git commit -m "feat: JWT の置き場所（token-store）を追加（issue 7-1）"
```

---

## Task 3: `api.ts` のトークン付与と失効検知

**Files:**
- Modify: `frontend/src/lib/api.ts`（全面的に書き換える。`ApiError` と `apiFetch` のシグネチャは保つ）
- Create: `frontend/src/lib/api.test.ts`

**Interfaces:**
- Consumes: `tokenStore.get()` / `tokenStore.clear()`（Task 2）
- Produces:
  - `type ApiRequestInit = RequestInit & { skipAuth?: boolean }`
  - `apiRequest<T>(path: string, init?: ApiRequestInit): Promise<{ data: T; response: Response }>`
  - `apiFetch<T>(path: string, init?: ApiRequestInit): Promise<T>`（既存呼び出しと互換）
  - `class ApiError { status: number; body: unknown }`（既存のまま）

  Task 4 が `apiRequest`（レスポンスヘッダから JWT を取るため）と `apiFetch` を使う。

**このタスクの肝**：401 でトークンを捨てる条件を「**Authorization を載せたリクエストが 401 を返したとき、かつそのときだけ**」に限る。Rails はパスワード不一致（`invalid_credentials`）も失効トークン（`unauthorized`）も同じ 401 で返すため、ステータスコードでは区別できない。区別できるのは「送信時にトークンを載せたか」だけ。

- [ ] **Step 1: 失敗するテストを書く**

`frontend/src/lib/api.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch, apiRequest } from "@/lib/api";
import { tokenStore } from "@/lib/auth/token-store";

/**
 * fetch を差し替え、渡された引数を検査できるようにする。
 *
 * vi.fn に `typeof fetch` を渡すのは、省くと mock.calls が空タプル型になり、
 * calls[0][1] の参照が `npx tsc --noEmit` で型エラーになるため。
 */
function stubFetch(response: Response) {
  const fetchMock = vi.fn<typeof fetch>(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** fetch に渡された Authorization ヘッダを取り出す。 */
function sentAuthorization(fetchMock: ReturnType<typeof stubFetch>): string | null {
  const init = fetchMock.mock.calls[0]?.[1];
  // new Headers(undefined) は空のヘッダになるので、呼ばれていない場合も落ちない。
  return new Headers(init?.headers).get("Authorization");
}

describe("apiRequest", () => {
  beforeEach(() => {
    window.localStorage.clear();
    tokenStore.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("トークンがあれば Authorization ヘッダを載せる", async () => {
    tokenStore.set("jwt-abc");
    const fetchMock = stubFetch(jsonResponse({ id: 1 }));

    await apiFetch("/api/me");

    expect(sentAuthorization(fetchMock)).toBe("Bearer jwt-abc");
  });

  it("トークンが無ければ Authorization ヘッダを載せない", async () => {
    const fetchMock = stubFetch(jsonResponse({ posts: [] }));

    await apiFetch("/api/posts");

    expect(sentAuthorization(fetchMock)).toBeNull();
  });

  // sign_up / sign_in はログイン中に叩かれても Authorization を載せてはいけない。
  // 載せると、下の「載せた 401 だけ破棄する」判定が崩れる。
  it("skipAuth: true ならトークンがあっても載せない", async () => {
    tokenStore.set("jwt-abc");
    const fetchMock = stubFetch(jsonResponse({ id: 1 }));

    await apiFetch("/api/auth/sign_in", { method: "POST", skipAuth: true });

    expect(sentAuthorization(fetchMock)).toBeNull();
  });

  it("Authorization を載せたリクエストが 401 を返すとトークンを破棄する", async () => {
    tokenStore.set("jwt-abc");
    stubFetch(jsonResponse({ error: "unauthorized" }, 401));

    await expect(apiFetch("/api/me")).rejects.toBeInstanceOf(ApiError);

    expect(tokenStore.get()).toBeNull();
  });

  // ログインのパスワード間違いも Rails は 401 で返す。ここで破棄すると、
  // ログインに失敗するたびに強制ログアウト処理が走る。
  it("Authorization を載せていないリクエストが 401 を返してもトークンを破棄しない", async () => {
    tokenStore.set("jwt-abc");
    stubFetch(jsonResponse({ error: "invalid_credentials" }, 401));

    await expect(
      apiFetch("/api/auth/sign_in", { method: "POST", skipAuth: true }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(tokenStore.get()).toBe("jwt-abc");
  });

  it("204 の空ボディで例外にならない", async () => {
    stubFetch(new Response(null, { status: 204 }));

    await expect(apiFetch("/api/posts/1/favorite", { method: "DELETE" })).resolves.toBeNull();
  });

  // DELETE /api/auth/sign_out は 204 ではなく「ボディが空の 200」を返す
  // （head :ok, content_type: "application/json"）。status === 204 だけを見ていると
  // 空文字列を JSON.parse して SyntaxError になり、ログアウトが必ず失敗する。
  it("ボディが空の 200 で例外にならない", async () => {
    tokenStore.set("jwt-abc");
    stubFetch(new Response(null, { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(apiFetch("/api/auth/sign_out", { method: "DELETE" })).resolves.toBeNull();
  });

  it("2xx 以外では status と body を持つ ApiError を投げる", async () => {
    stubFetch(jsonResponse({ errors: { email: ["taken"] } }, 422));

    await expect(apiFetch("/api/auth/sign_up", { method: "POST", skipAuth: true }))
      .rejects.toMatchObject({
        name: "ApiError",
        status: 422,
        body: { errors: { email: ["taken"] } },
      });
  });

  it("apiRequest は Response も返す（JWT はヘッダに載って来る）", async () => {
    stubFetch(
      new Response(JSON.stringify({ id: 1, name: "太郎", email: "a@example.com" }), {
        status: 200,
        headers: { "Content-Type": "application/json", Authorization: "Bearer jwt-abc" },
      }),
    );

    const { data, response } = await apiRequest<{ id: number }>("/api/auth/sign_in", {
      method: "POST",
      skipAuth: true,
    });

    expect(data.id).toBe(1);
    expect(response.headers.get("Authorization")).toBe("Bearer jwt-abc");
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

```bash
docker compose exec frontend npm run test src/lib/api.test.ts
```

Expected: FAIL。`apiRequest` が export されていない／`skipAuth` が型に無い。

- [ ] **Step 3: 実装する**

`frontend/src/lib/api.ts` を次の内容にする：

```ts
// Rails API を叩く共通クライアント。個別コンポーネントで直接 fetch しない。

import { tokenStore } from "@/lib/auth/token-store";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

/** API が 2xx 以外を返したときのエラー。文言は呼び出し側（UI）が決める。 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
  }
}

export type ApiRequestInit = RequestInit & {
  /**
   * true なら Authorization ヘッダを載せない。sign_up / sign_in で使う。
   * 「まだトークンを持っていないはずだから省略できる」ではなく、
   * ログイン中に再ログインされても下の 401 判定を壊さないために明示する。
   */
  skipAuth?: boolean;
};

/**
 * ボディの取り出し。status ではなく「中身が空かどうか」で判断する。
 *
 * 204 だけを特別扱いすると DELETE /api/auth/sign_out で落ちる。あちらは
 * `head :ok` なので 204 ではなく「ボディが空の 200」で返って来る。
 *
 * JSON でない応答も握り潰さず生の文字列で返す。Render のプロキシや
 * Vercel のエラーページは HTML を返すことがあり、ここで例外にすると
 * 本当のステータスコード（502 など）が失われて切り分けができなくなる。
 */
async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** 低レベル。Response ごと返す。レスポンスヘッダから JWT を取る認証まわりが使う。 */
export async function apiRequest<T>(
  path: string,
  init?: ApiRequestInit,
): Promise<{ data: T; response: Response }> {
  if (!API_BASE_URL) {
    throw new Error("NEXT_PUBLIC_API_BASE_URL が設定されていません");
  }

  const { skipAuth, ...requestInit } = init ?? {};
  const token = skipAuth ? null : tokenStore.get();

  const headers = new Headers(requestInit.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_BASE_URL}${path}`, { ...requestInit, headers });

  // Authorization を載せたリクエストが 401 を返した＝そのトークンが失効している。
  // 載せていないリクエストの 401 はログインの失敗（パスワード不一致）なので、
  // トークンを捨ててはいけない。Rails はどちらも 401 で返してくるため、
  // ステータスコードではなく「送信時に載せたか」で分ける。
  //
  // ここではリダイレクトしない。状態を落とすのは AuthProvider、
  // 画面遷移を決めるのは RequireAuth の仕事。認証不要ページで期限が切れても
  // ユーザーを画面から放り出さないため。
  if (response.status === 401 && token) {
    tokenStore.clear();
  }

  const data = await parseBody(response);

  if (!response.ok) throw new ApiError(response.status, data);

  return { data: data as T, response };
}

export async function apiFetch<T>(path: string, init?: ApiRequestInit): Promise<T> {
  const { data } = await apiRequest<T>(path, init);
  return data;
}
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
docker compose exec frontend npm run test
```

Expected: PASS（合計 22 テスト）。

- [ ] **Step 5: ミューテーションで 401 の 2 件を検査する**

green なのに何も守っていないテストを避けるため、実装をわざと壊して落ちることを確認する。

1. `if (response.status === 401 && token)` を `if (response.status === 401)` に書き換える
   → `npm run test` を実行。**「載せていない 401 でも破棄しない」の 1 件だけが落ちる**ことを確認する
2. 同じ行を `if (false)` に書き換える
   → **「載せた 401 で破棄する」の 1 件だけが落ちる**ことを確認する
3. 元の `if (response.status === 401 && token)` に戻し、`npm run test` が全部通ることを確認する

どちらの書き換えでも全部 green のままなら、テストが条件を検査できていない。その場合は先へ進まず、テストを直す。

- [ ] **Step 6: 既存の呼び出しが壊れていないことを確認する**

`src/app/page.tsx` の `apiFetch<HealthResponse>("/api/health")` は無変更で通るはず（`ApiRequestInit` は `RequestInit` を拡張しているため）。

```bash
docker compose exec frontend npm run lint
docker compose exec frontend npx tsc --noEmit
```

Expected: どちらもエラーなし。

- [ ] **Step 7: ブラウザで疎通が壊れていないことを確認する**

http://localhost:3001 を開き、「Rails API 疎通確認」カードが `ok` / `ok` を表示することを確認する（トークン無しのリクエストが今までどおり通る）。

- [ ] **Step 8: コミット**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/api.test.ts
git commit -m "feat: API クライアントに JWT の付与と失効検知を入れる（issue 7-1）"
```

---

## Task 4: `AuthProvider` / `useAuth` と型

**Files:**
- Modify: `frontend/src/types/api.ts`（`User` / `MeResponse` / エラーボディの型を追加）
- Create: `frontend/src/lib/auth/auth-context.tsx`
- Modify: `frontend/src/app/layout.tsx`（`AuthProvider` を巻く）

**Interfaces:**
- Consumes: `apiRequest` / `apiFetch` / `ApiError`（Task 3）、`tokenStore`（Task 2）
- Produces:
  - `type User = { id: number; name: string; email: string }`
  - `type MeResponse = User & { stats: { posts_count: number; attempts_count: number; likes_received_count: number } }`
  - `type AuthErrorBody = { error: "invalid_credentials" | "unauthorized" }`
  - `type ValidationErrorBody = { errors: Record<string, string[]> }`
  - `<AuthProvider>` — ルートレイアウトに 1 つだけ置く
  - `useAuth(): AuthContextValue` — `{ status: "loading" } | { status: "authenticated"; user: User } | { status: "unauthenticated" }` に `signUp` / `signIn` / `signOut` が付いたもの

  Task 5・Task 6 と、7-2 以降の全画面が `useAuth` を使う。

**単体テストは書かない**（RTL を入れない方針）。このタスクの検証は型検査と lint、実際の動作確認は Task 5 のブラウザ確認で行う。

- [ ] **Step 1: 型を足す**

`frontend/src/types/api.ts` に追記する（既存の `HealthResponse` は残す）：

```ts
/** 認証系 API とユーザー表現。POST /api/auth/sign_in などが返す形。 */
export type User = {
  id: number;
  name: string;
  email: string;
};

/**
 * GET /api/me。User に統計が付く。
 * stats は AuthProvider では保持しない。ログイン時点のスナップショットにすぎず、
 * お題を投稿しても挑戦されても更新されないため、認証コンテキストに置くと
 * 7-6 のマイページヘッダーが必ず古い値を表示することになる。7-6 が自分で取る。
 */
export type MeResponse = User & {
  stats: {
    posts_count: number;
    attempts_count: number;
    likes_received_count: number;
  };
};

/** 401 のボディ（Warden の FailureApp）。文言ではなくコードが来る。 */
export type AuthErrorBody = {
  error: "invalid_credentials" | "unauthorized";
};

/** 422 のボディ。値は属性ごとのエラーコードの配列（"taken" / "blank" など）。 */
export type ValidationErrorBody = {
  errors: Record<string, string[]>;
};
```

- [ ] **Step 2: `auth-context.tsx` を書く**

`frontend/src/lib/auth/auth-context.tsx`：

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { apiFetch, apiRequest } from "@/lib/api";
import { tokenStore } from "@/lib/auth/token-store";
import type { MeResponse, User } from "@/types/api";

type AuthState =
  | { status: "loading" }
  | { status: "authenticated"; user: User }
  | { status: "unauthenticated" };

type AuthContextValue = AuthState & {
  signUp(params: { name: string; email: string; password: string }): Promise<void>;
  signIn(params: { email: string; password: string }): Promise<void>;
  signOut(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * レスポンスヘッダから JWT を取り出す。
 *
 * 取れなかったときに握り潰さないのが要点。CORS の expose 設定が壊れると
 * 必ずここに来るが、黙って未ログインのままにすると「ログインは成功して
 * いるのに入れない」という原因の分からない症状になる。
 */
function extractToken(response: Response): string {
  const header = response.headers.get("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

  if (!token) {
    throw new Error(
      "Authorization ヘッダから JWT を取得できませんでした（CORS の expose 設定を確認）",
    );
  }
  return token;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // トークンの変更を購読する。api.ts が失効を検知して捨てたときも、
  // 別タブでログアウトしたときも、ここに通知が来る。
  const token = useSyncExternalStore(
    tokenStore.subscribe,
    tokenStore.get,
    tokenStore.getServerSnapshot,
  );

  // 「どのトークンに対して誰だと分かっているか」を持つ。トークンと一緒に
  // 持つのは、signIn 直後にもう一度 /api/me を叩かずに済ませるため。
  const [session, setSession] = useState<{ token: string; user: User } | null>(null);
  // 復元に失敗したトークン。無限リトライを防ぐ。
  const [restoreFailedFor, setRestoreFailedFor] = useState<string | null>(null);

  // 起動時の復元。トークンが無ければリクエストを一切出さない（未ログインの
  // 訪問者にコストを掛けない）。あるときだけ /api/me を 1 本だけ叩く。
  useEffect(() => {
    if (token === null) return;
    if (session?.token === token) return; // signIn 直後。もう誰か分かっている
    if (restoreFailedFor === token) return;

    let cancelled = false;

    apiFetch<MeResponse>("/api/me")
      .then((me) => {
        if (cancelled) return;
        setSession({ token, user: { id: me.id, name: me.name, email: me.email } });
      })
      .catch(() => {
        if (cancelled) return;
        // 401 なら api.ts が既にトークンを捨てている。その通知で token が
        // null になり、この効果は再実行されて上の早期 return に落ちる。
        //
        // 401 以外（ネットワーク断など）ではトークンを残したまま未ログイン
        // 表示にする。捨てると、通信が戻ったときにログインし直しになるため。
        // リロードで再試行される。
        setRestoreFailedFor(token);
      });

    return () => {
      cancelled = true;
    };
  }, [token, session, restoreFailedFor]);

  const signUp = useCallback(
    async (params: { name: string; email: string; password: string }) => {
      const { data, response } = await apiRequest<User>("/api/auth/sign_up", {
        method: "POST",
        body: JSON.stringify({ user: params }),
        skipAuth: true,
      });
      const newToken = extractToken(response);

      // set より先に session を入れる。逆にすると、通知を受けた再レンダリングが
      // 一瞬 loading になる。同じイベントハンドラ内なので React がまとめる。
      setSession({ token: newToken, user: data });
      setRestoreFailedFor(null);
      tokenStore.set(newToken);
    },
    [],
  );

  const signIn = useCallback(async (params: { email: string; password: string }) => {
    const { data, response } = await apiRequest<User>("/api/auth/sign_in", {
      method: "POST",
      body: JSON.stringify({ user: params }),
      skipAuth: true,
    });
    const newToken = extractToken(response);

    setSession({ token: newToken, user: data });
    setRestoreFailedFor(null);
    tokenStore.set(newToken);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await apiFetch<null>("/api/auth/sign_out", { method: "DELETE" });
    } catch {
      // サーバー側の失効に失敗しても、ローカルのトークンは必ず捨てる。
      // ここで投げると「ログアウトを押したのにログイン状態のまま」になり、
      // ユーザーが自力で抜け出せない。失効し損ねたトークンは 24 時間で切れる。
    } finally {
      setSession(null);
      setRestoreFailedFor(null);
      tokenStore.clear();
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const state: AuthState =
      token === null
        ? { status: "unauthenticated" }
        : session?.token === token
          ? { status: "authenticated", user: session.user }
          : restoreFailedFor === token
            ? { status: "unauthenticated" }
            : { status: "loading" };

    return { ...state, signUp, signIn, signOut };
  }, [token, session, restoreFailedFor, signUp, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth は AuthProvider の内側で呼ぶこと");
  }
  return value;
}
```

- [ ] **Step 3: ルートレイアウトに巻く**

`frontend/src/app/layout.tsx` の `<body>` の中身を `AuthProvider` で包む。import を 1 行足す。

```tsx
import { AuthProvider } from "@/lib/auth/auth-context";
```

```tsx
      <body className="min-h-full flex flex-col">
        <AuthProvider>{children}</AuthProvider>
      </body>
```

`layout.tsx` はサーバーコンポーネントのままでよい。`AuthProvider` がクライアントコンポーネントでも、`children` として渡されたサーバーコンポーネントはサーバーで描画されたままその中に収まる。**全ページがクライアントコンポーネントになるわけではない**（クライアントにする必要があるのは `useAuth()` を実際に呼ぶコンポーネントだけ）。

- [ ] **Step 4: 型検査と lint を通す**

```bash
docker compose exec frontend npm run lint
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run test
```

Expected: すべてエラーなし（テストは 22 件のまま）。

- [ ] **Step 5: 既存ページが壊れていないことを確認する**

http://localhost:3001 を開き、「Rails API 疎通確認」カードが今までどおり表示されることを確認する（`AuthProvider` を挟んだことでハイドレーションエラーが出ていないか、ブラウザのコンソールも見る）。

- [ ] **Step 6: コミット**

```bash
git add frontend/src/types/api.ts frontend/src/lib/auth/auth-context.tsx frontend/src/app/layout.tsx
git commit -m "feat: ログイン状態のコンテキスト（AuthProvider / useAuth）を追加（issue 7-1）"
```

---

## Task 5: 動作確認用の暫定 UI と、つなぎ目の確認

**Files:**
- Create: `frontend/src/app/_components/auth-probe.tsx`
- Modify: `frontend/src/app/page.tsx`（確認カードを差し込む）

**Interfaces:**
- Consumes: `useAuth()`（Task 4）、`apiFetch`（Task 3）
- Produces: `<AuthProbe />` — 7-7 で削除する暫定コンポーネント

**このタスクの目的**は UI を作ることではなく、**jsdom では原理的に検証できないつなぎ目**を実物のブラウザと実物の Rails で 1 度通すこと。具体的には ①CORS 越しに `Authorization` レスポンスヘッダを JS が読めるか ②リロード後に `/api/me` で復元されるか ③ログアウト後に同じトークンが denylist で 401 になり自動破棄されるか ④別タブ同期。

`_components`（アンダースコア始まり）は Next.js の private folder で、ルーティングの対象にならない（`node_modules/next/dist/docs/01-app/01-getting-started/02-project-structure.md`）。7-7 でフォルダごと消す。

- [ ] **Step 1: `auth-probe.tsx` を書く**

`frontend/src/app/_components/auth-probe.tsx`：

```tsx
"use client";

import { useState } from "react";

import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import type { MeResponse } from "@/types/api";

// 7-1 の動作確認用の暫定 UI。ログイン画面は 7-2 が作るので、それまでの
// つなぎとしてここに最小のフォームを置く。7-7 でこのフォルダごと削除する。

export function AuthProbe() {
  const auth = useAuth();
  const [name, setName] = useState("テスト太郎");
  const [email, setEmail] = useState("probe@example.com");
  const [password, setPassword] = useState("password123");
  const [message, setMessage] = useState<string | null>(null);
  const [me, setMe] = useState<MeResponse | null>(null);

  const run = async (label: string, action: () => Promise<void>) => {
    setMessage(`${label}…`);
    try {
      await action();
      setMessage(`${label}: OK`);
    } catch (error) {
      // 文言は本来フロントの辞書が持つ（7-2）。ここは確認用なので生で出す。
      setMessage(
        error instanceof ApiError
          ? `${label}: ${error.status} ${JSON.stringify(error.body)}`
          : `${label}: ${String(error)}`,
      );
    }
  };

  return (
    <section className="w-full max-w-md rounded-lg border border-zinc-200 p-6 dark:border-zinc-800">
      <h2 className="mb-4 text-sm font-semibold text-zinc-500">認証疎通確認（暫定）</h2>

      <p className="mb-4 text-sm">
        状態: <span className="font-mono">{auth.status}</span>
        {auth.status === "authenticated" && (
          <span className="font-mono"> / {auth.user.name}（{auth.user.email}）</span>
        )}
      </p>

      {auth.status === "unauthenticated" && (
        <div className="flex flex-col gap-2">
          <input
            className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="名前"
          />
          <input
            className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="メールアドレス"
          />
          <input
            className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="パスワード"
          />
          <div className="flex gap-2">
            <button
              className="rounded bg-zinc-900 px-3 py-1 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900"
              onClick={() => run("新規登録", () => auth.signUp({ name, email, password }))}
            >
              新規登録
            </button>
            <button
              className="rounded border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
              onClick={() => run("ログイン", () => auth.signIn({ email, password }))}
            >
              ログイン
            </button>
          </div>
        </div>
      )}

      {auth.status === "authenticated" && (
        <div className="flex gap-2">
          <button
            className="rounded border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
            onClick={() =>
              run("GET /api/me", async () => {
                setMe(await apiFetch<MeResponse>("/api/me"));
              })
            }
          >
            /api/me を叩く
          </button>
          <button
            className="rounded border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
            onClick={() => run("ログアウト", () => auth.signOut())}
          >
            ログアウト
          </button>
        </div>
      )}

      {message && <p className="mt-4 font-mono text-xs break-all">{message}</p>}
      {me && <pre className="mt-2 overflow-x-auto text-xs">{JSON.stringify(me, null, 2)}</pre>}

      <a className="mt-4 block text-sm underline" href="/auth-check">
        /auth-check（ガードの確認・Task 6 で作る）
      </a>
    </section>
  );
}
```

- [ ] **Step 2: `page.tsx` に差し込む**

`frontend/src/app/page.tsx` に import を足し、既存の「Rails API 疎通確認」セクションの直後に `<AuthProbe />` を置く。

```tsx
import { AuthProbe } from "@/app/_components/auth-probe";
```

```tsx
      </section>

      <AuthProbe />
    </main>
```

- [ ] **Step 3: lint と型検査を通す**

```bash
docker compose exec frontend npm run lint
docker compose exec frontend npx tsc --noEmit
```

- [ ] **Step 4: ブラウザで「登録 → ログイン」を確認する**

前提：`docker compose up` で backend / frontend が動いていること。

1. http://localhost:3001 を開く
2. 状態が `unauthenticated` であることを確認
3. 「新規登録」を押す → 状態が `authenticated` になり、名前とメールが出る

**ここが通れば、CORS 越しに `Authorization` レスポンスヘッダを読めている**（`expose: ["Authorization"]` が効いている）。`Authorization ヘッダから JWT を取得できませんでした` が出たら、`backend/config/initializers/cors.rb` の `expose` を確認する。

- [ ] **Step 5: リロードで状態が復元されることを確認する**

ページをリロードする → 状態が `authenticated` に戻り、名前が出ることを確認する。

DevTools の Network を開き、リロード時に **`/api/me` が 1 回だけ**呼ばれていることを確認する（案1 の意図どおり）。Application → Local Storage に `kotoe.auth.token` があることも確認する。

- [ ] **Step 6: `/api/me` の呼び出しを確認する**

「/api/me を叩く」を押す → `stats` を含む JSON が出ることを確認する。認証必須 API が Authorization ヘッダで通っている。

- [ ] **Step 7: ログアウトと失効の自動検知を確認する**

1. 「ログアウト」を押す → 状態が `unauthenticated` に戻り、Local Storage からトークンが消えることを確認
2. DevTools の Console で、失効済みトークンを手で書き戻して失効検知を試す：

```js
localStorage.setItem("kotoe.auth.token", "<ログアウト前のトークン>");
location.reload();
```

（トークンは Step 5 で Local Storage から控えておく）

リロード後、`/api/me` が 401 を返し、**トークンが自動で消えて `unauthenticated` になる**ことを確認する。ここが `api.ts` の失効検知。

- [ ] **Step 8: 別タブ同期を確認する**

1. ログインし直す
2. http://localhost:3001 をもう 1 つのタブで開く（両方 `authenticated`）
3. 片方でログアウトする → **もう一方のタブも `unauthenticated` に変わる**ことを確認する（`storage` イベントの購読）

- [ ] **Step 9: ログイン失敗でログアウトされないことを確認する**

1. ログイン状態から「ログアウト」を押して未ログインに戻る
2. わざと間違ったパスワード（例：`wrong`）で「ログイン」を押す
3. `401 {"error":"invalid_credentials"}` がメッセージに出て、状態が `unauthenticated` のままであることを確認する（例外も画面遷移も起きない）

これが `api.ts` の「載せていない 401 では破棄しない」分岐の実物での確認になる。ここで強制ログアウト的な挙動が起きるなら、`skipAuth` が効いていない。

- [ ] **Step 10: コミット**

```bash
git add frontend/src/app/_components/auth-probe.tsx frontend/src/app/page.tsx
git commit -m "chore: 認証の疎通確認用の暫定 UI を追加（issue 7-1、7-7 で削除）"
```

---

## Task 6: `RequireAuth` と `/auth-check`

**Files:**
- Create: `frontend/src/lib/auth/require-auth.tsx`
- Create: `frontend/src/app/auth-check/page.tsx`

**Interfaces:**
- Consumes: `useAuth()`（Task 4）、`safeNextPath`（Task 1 — ここでは使わないが対になる。使うのは 7-2）
- Produces: `<RequireAuth>{children}</RequireAuth>` — 7-5（`/posts/new`）と 7-6（`/mypage`）が使う

- [ ] **Step 1: `require-auth.tsx` を書く**

`frontend/src/lib/auth/require-auth.tsx`：

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
    if (auth.status !== "unauthenticated") return;

    // push ではなく replace。push だと、ログイン後に戻るボタンでここへ戻り、
    // また /login へ飛ばされるループができる。
    router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [auth.status, pathname, router]);

  // レンダリング中に遷移してはいけないので、判定が付くまでは待つ表示を出す。
  // localStorage は SSR で読めないため、この一瞬は localStorage を選んだ
  // 時点で避けられない（設計書「A のコスト」）。
  if (auth.status !== "authenticated") {
    return <p className="p-8 text-zinc-500">読み込み中…</p>;
  }

  return <>{children}</>;
}
```

- [ ] **Step 2: `/auth-check` を書く**

`frontend/src/app/auth-check/page.tsx`：

```tsx
"use client";

import { RequireAuth } from "@/lib/auth/require-auth";
import { useAuth } from "@/lib/auth/auth-context";

// 7-1 のガード動作確認用の暫定ページ。7-2 で /login を作ったら削除する。

function AuthCheckContent() {
  const auth = useAuth();

  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold">認証ガードの確認</h1>
      <p className="mt-4 font-mono text-sm">
        {auth.status === "authenticated"
          ? `${auth.user.name}（${auth.user.email}）としてログイン中`
          : auth.status}
      </p>
      <a className="mt-6 block text-sm underline" href="/">
        トップへ戻る
      </a>
    </main>
  );
}

export default function AuthCheckPage() {
  return (
    <RequireAuth>
      <AuthCheckContent />
    </RequireAuth>
  );
}
```

- [ ] **Step 3: lint と型検査を通す**

```bash
docker compose exec frontend npm run lint
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run test
```

- [ ] **Step 4: ログイン状態でガードを通り抜けられることを確認する**

1. http://localhost:3001 でログインする
2. 「/auth-check」のリンクを押す → ページが表示され、自分の名前が出ることを確認する

- [ ] **Step 5: 未ログインでリダイレクトされることを確認する**

1. トップに戻ってログアウトする
2. http://localhost:3001/auth-check を直接開く
3. **URL が `/login?next=%2Fauth-check` に変わる**ことを確認する

7-2 が未着なので `/login` は 404 になる。それでよい。**確認したいのはリダイレクトが起きることと、`next` に元のパスがエンコードされて載ること**。

- [ ] **Step 6: 戻るボタンでループしないことを確認する**

Step 5 の直後にブラウザの戻るボタンを押す → `/auth-check` に戻って再び `/login?next=…` へ飛ぶ**無限ループにならない**ことを確認する（`replace` を使っているため、履歴に `/auth-check` が積まれていない）。

- [ ] **Step 7: コミット**

```bash
git add frontend/src/lib/auth/require-auth.tsx frontend/src/app/auth-check/page.tsx
git commit -m "feat: 認証ガード（RequireAuth）を追加（issue 7-1）"
```

---

## Task 7: CI に frontend ジョブを足す

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `npm run lint` / `npx tsc --noEmit` / `npm run test`（Task 1〜6）
- Produces: なし（CI 設定）

`npm run lint` と `npx tsc --noEmit` も回す。`package.json` に `lint` があるのに誰も回しておらず、`CLAUDE.md` の「`any` を避け、API レスポンスに型を付ける」が現状どこでも機械的に検査されていないため。ジョブの新設費用は既に払うので、フロントが 7-2 以降で一気に増える直前が最も安い。

- [ ] **Step 1: ジョブを追加する**

`.github/workflows/ci.yml` の `jobs:` に、既存の `backend` / `security` と並べて追加する（インデントは既存ジョブに合わせる）。

```yaml
  frontend:
    name: frontend (lint / typecheck / test)
    runs-on: ubuntu-latest

    defaults:
      run:
        working-directory: frontend

    steps:
      - uses: actions/checkout@v7

      - name: Node のセットアップ（npm のキャッシュを使う）
        uses: actions/setup-node@v4
        with:
          # ローカルの開発コンテナ（node:24-slim）と揃える。
          node-version: "24"
          cache: npm
          cache-dependency-path: frontend/package-lock.json

      - name: 依存のインストール
        run: npm ci

      - name: eslint
        run: npm run lint

      # CLAUDE.md の「any を避け、API レスポンスに型を付ける」を機械的に検査する。
      # next build でも型は見られるが、ビルドは Vercel が回すため CI では型検査だけを回す。
      - name: 型検査
        run: npx tsc --noEmit

      - name: vitest
        run: npm run test
```

- [ ] **Step 2: YAML が壊れていないことを確認する**

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('YAML OK')"
```

Expected: `YAML OK`

- [ ] **Step 3: ローカルで CI と同じ 3 本を通す**

```bash
docker compose exec frontend npm run lint
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run test
```

Expected: すべて green。

- [ ] **Step 4: コミット**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: frontend の lint / 型検査 / vitest を回す（issue 7-1）"
```

---

## 仕上げ

- [ ] **Step 1: 全部まとめて通す**

```bash
docker compose exec frontend npm run lint
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run test
```

- [ ] **Step 2: バックエンドに手を入れていないことを確認する**

```bash
git diff main --stat -- backend/
```

Expected: 出力が空。

- [ ] **Step 3: `/code-review` を回す**

プッシュ前に必ず挟む。書いた本人は自分の前提を疑えない。

- [ ] **Step 4: プッシュして PR を出す**

PR 本文の冒頭に **`Closes #22`** を書く（issue テンプレに明記があるのに過去 2 回忘れて手動クローズになっている）。あわせて設計書へのリンクと、動作確認した項目（Task 5・6 のブラウザ確認）を書く。末尾に付けてよいのは `Generated with Claude Code` の 1 行までで、**セッションのリンクは載せない**（public リポジトリのため）。

---

## 完了条件

- ローカルのブラウザで、登録 → ログイン → リロードで復元 → `/api/me` が通る → ログアウト → 失効トークンの自動破棄、が一通り動く
- `/auth-check` に未ログインでアクセスすると `/login?next=%2Fauth-check` へ遷移する（戻るボタンでループしない）
- 別タブでログアウトすると、もう一方のタブも `unauthenticated` になる
- 間違ったパスワードでのログイン失敗が、ログイン中のトークンを破棄しない
- `npm run lint` / `npx tsc --noEmit` / `npm run test`（22 テスト）が green
- CI の `frontend` ジョブが green
- `backend/` に差分が無い

## この issue で作らないもの

- ログイン・新規登録の**画面**（7-2）。`_components/auth-probe.tsx` は暫定であって画面ではない
- グローバルナビのログイン状態表示（7-2）
- エラーコードの日本語辞書（7-2 以降。文言を持つのはフォーム側）
- React Testing Library によるコンポーネントテスト（`CLAUDE.md` が見送り）
- Playwright の E2E（8-1）
- middleware によるガード（`localStorage` からは読めないため、設計の案 A を採った時点で選択肢に無い）
