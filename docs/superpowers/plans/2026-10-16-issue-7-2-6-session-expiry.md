# セッション失効の通知と再ログイン導線 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** JWT が失効したとき、どのページにいてもトーストで 1 回だけ理由を伝え、ガード付きページからは `/login?reason=expired` へ送ってログイン画面に案内の枠を出す。

**Architecture:** 失効の記録は `tokenStore`（`expire()` / `wasExpired()`）が持ち、api.ts が 401 を受けたときに `expire()` が true を返した 1 回だけ `notifySessionExpired()` でトーストを出す。`deriveAuthState()` は 5 つ目の状態を作らず、`unauthenticated` に `expired` を載せる。`RequireAuth` は `loginPathFor()` で `?reason=expired` 付きの URL を組み立て、ログイン画面はサーバーコンポーネントが `parseLoginReason()` で検証してから、クライアントのフォームに `expired` を渡す。

**Tech Stack:** Next.js 16.2.10（App Router）／ React 19.2.4 ／ TypeScript ／ TailwindCSS 4 ／ Vitest（jsdom）／ Docker Compose。**新しい依存は追加しない。**

**Spec:** `docs/superpowers/specs/2026-10-16-issue-7-2-6-session-expiry-design.md`

**Issue:** GitHub #105（`docs/issues_backlog.md` 7-2.6）

**Branch:** `feat/session-expiry`（作成済み。設計書のコミット `3c03be5` が載っている）

## Global Constraints

このプロジェクト全体の規約。**全タスクの要件に暗黙に含まれる。**

- **依存パッケージを追加しない。** `frontend/package.json` は変更しない。
- **`backend/` のコードは 1 行も変更しない。**
- **`frontend/src/app/globals.css` を変更しない。** 過去の Turbopack stale は、すべてこのファイルの変更で起きている（`frontend/AGENTS.md`）。色は既存のトークン（`bg-accent/10`・`text-ink`・`bg-danger/10`・`text-danger`・`rounded-card` など）だけを使う。
- **`useSearchParams()` を使わない。** Vercel の本番ビルドだけが落ちる（7-2 の規約）。
- **`dangerouslySetInnerHTML` を使わない**（eslint の `react/no-danger` が error）。
- **URL の `?reason=` の値を画面に出さない。** `parseLoginReason()` の結果で、固定の文言を出すかどうかだけを決める（設計書「XSS」）。
- 失効の文言は `SESSION_EXPIRED_MESSAGE`（「セッションの有効期限が切れました。もう一度ログインしてください」）の 1 箇所だけ。文字列を書き写さない。
- **`useEffect` の本体で同期的に `setState` しない**（eslint-plugin-react-hooks 7 の `set-state-in-effect` が error）。
- **`any` を使わない。**
- **文字列はダブルクォート。** コメントは日本語で書き、「何をしているか」ではなく**「なぜそうしたか」**を書く（既存ファイルの書き方に合わせる）。確かめていない「壊れたときの見え方」をコメントに書かない。
- **テストは `frontend/test/` に置き、`src/` の構造を写す。** コンポーネントのテストは書かない（CLAUDE.md のテスト方針。E2E は 8-1）。
- **env ファイルの中身を表示しない。**
- コマンドはリポジトリのルートで実行する。`npm` / `npx` は `docker compose exec frontend <コマンド>` としてコンテナ内で動かす。
- **コンテナ内で `next build` を実行しない。** dev サーバーと同じコンテナで動いている。ビルドの確認は PR の Vercel プレビューに任せる。
- コミットメッセージの末尾は `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` で止める（`Claude-Session:` 行やセッションリンクを書かない）。
- `git checkout` を使わない。ブランチも切り替えない（`feat/session-expiry` の上だけで作業する）。

## Review Focus

どのタスクの単体テストも直接は叩かないが、使う人が最初に踏みそうな入力・条件。それぞれの確認は、そのコードを持つタスクに入れてある。

1. **翌日の再訪で、ガード付きページを直接開く（リロードを含む）。** ハイドレーション → `GET /api/me` が 401 → `expire()` の順で進む。トークンが消えたのと同じ描画で `expired: true` になっていないと、`?reason=` 無しで送られてしまう。→ Task 1 の「通知の時点で `wasExpired()` が true」と、Task 6 の手動確認 1
2. **以前に失効したタブで、あとから別タブでログイン → ログアウトされる。** 失効の記録が残っていると、関係のないログアウトで「期限切れ」と出る。→ Task 1 の storage イベントのテスト
3. **開発時の StrictMode で、起動時の復元の effect が 2 回走る。** `/api/me` が 2 本とも 401 になる。トーストは 1 件でなければならない。→ Task 2 の「並行した 401 が 3 本でも 1 件」
4. **すでにログイン済みで `/login?reason=expired&next=...` を開く**（戻るボタン・ブックマーク）。今までどおり、フォームを見せずに戻り先へ送る。サーバー／クライアントの分割でこの effect を落とさないこと。→ Task 5 の手動確認
5. **`?reason=` の書き換え**（`EXPIRED`、`expired` を 2 つ、`expired%20`、別の値）。どれも枠を出さない。→ Task 4 の `parseLoginReason` のテスト

---

## ファイル構成

| ファイル | 種別 | 責務 |
|---|---|---|
| `frontend/src/lib/auth/token-store.ts` | 変更 | `expire()` / `wasExpired()` と、理由の消去（`set`・`clear`・storage イベント） |
| `frontend/src/lib/auth/session-expiry.ts` | 新規 | `SESSION_EXPIRED_MESSAGE` と `notifySessionExpired()` |
| `frontend/src/lib/api.ts` | 変更 | 401 で `expire()` を呼び、true なら通知。本文を読む途中のタイムアウトを `ApiError(401)` に |
| `frontend/src/lib/auth/error-messages.ts` | 変更 | 文言を `session-expiry.ts` から import |
| `frontend/src/components/posts/favorite-button.tsx` | 変更 | 401 でトーストを出さない |
| `frontend/src/lib/attempts/attempt-messages.ts` | 変更 | `toLikeErrorMessage` が 401 で `null` |
| `frontend/src/components/attempts/like-button.tsx` | 変更 | `null` ならトーストを出さない |
| `frontend/src/components/attempts/attempt-composer.tsx` | 変更 | 失効トースト 2 箇所を削除 |
| `frontend/src/lib/posts/post-messages.ts` | 変更 | `toLeftPageFailureMessage` が失効で `null` |
| `frontend/src/components/posts/post-form.tsx` | 変更 | 失効トースト 2 箇所を削除／`null` ならトーストを出さない |
| `frontend/src/lib/auth/derive-auth-state.ts` | 変更 | `expired` の入出力 |
| `frontend/src/lib/auth/auth-context.tsx` | 変更 | `wasExpired` を購読 |
| `frontend/src/lib/auth/login-reason.ts` | 新規 | `LOGIN_REASON_EXPIRED` / `parseLoginReason()` / `loginPathFor()` |
| `frontend/src/lib/auth/require-auth.tsx` | 変更 | `loginPathFor()` を使う |
| `frontend/src/app/(auth)/login/page.tsx` | 変更 | サーバーコンポーネントに |
| `frontend/src/components/auth/login-form.tsx` | 新規 | 今の `login/page.tsx` の中身 ＋ 案内の枠 |
| `docs/issues_backlog.md` | 変更 | 7-2.6 の決定と 7-3d への引き継ぎ |

---

### Task 1: tokenStore に失効の記録を足す

**Files:**
- Modify: `frontend/src/lib/auth/token-store.ts`
- Test: `frontend/test/lib/auth/token-store.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `tokenStore.expire(token: string): boolean` … 中身が `token` と一致するときだけ捨てて失効を記録し、購読者へ通知して true。一致しなければ何もせず false
  - `tokenStore.wasExpired(): boolean` … 最後にトークンが消えた理由が `expire()` だったか
  - `set()` / `clear()` / storage イベント（自分のキー、または `key === null`）で `wasExpired()` は false に戻る

- [ ] **Step 1: 失敗するテストを書く**

`frontend/test/lib/auth/token-store.test.ts` の `describe("tokenStore", ...)` の末尾（最後の `it` の後ろ、閉じ括弧の前）に追加する。

```ts
  describe("expire", () => {
    it("中身が同じトークンなら捨てて true を返し、失効として記録する", () => {
      tokenStore.set("jwt-abc");

      expect(tokenStore.expire("jwt-abc")).toBe(true);

      expect(tokenStore.get()).toBeNull();
      expect(tokenStore.wasExpired()).toBe(true);
    });

    // 送信時のトークンと今のトークンが違う＝応答を待つ間に再ログインした。
    // 古い 401 で新しいトークンを消すと、ログイン直後に未ログインへ戻される。
    it("中身が別のトークンなら何もせず false を返す", () => {
      tokenStore.set("jwt-new");

      expect(tokenStore.expire("jwt-old")).toBe(false);

      expect(tokenStore.get()).toBe("jwt-new");
      expect(tokenStore.wasExpired()).toBe(false);
    });

    // 並行した 401 の 2 本目以降。ここで true を返すと、トーストが本数分出る。
    it("すでに捨てられていれば false を返す", () => {
      tokenStore.set("jwt-abc");
      tokenStore.expire("jwt-abc");

      expect(tokenStore.expire("jwt-abc")).toBe(false);
    });

    // AuthProvider は通知を受けて token と wasExpired を読み直す。記録を通知の後に
    // 書くと、「トークンは消えたが失効ではない」描画が 1 回挟まり、その描画で
    // RequireAuth が ?reason= 無しの URL へ送ってしまう。
    it("通知の時点で wasExpired() はすでに true", () => {
      tokenStore.set("jwt-abc");
      let seen: boolean | null = null;
      const unsubscribe = tokenStore.subscribe(() => {
        seen = tokenStore.wasExpired();
      });

      tokenStore.expire("jwt-abc");

      expect(seen).toBe(true);
      unsubscribe();
    });

    it("set（ログイン）で失効の記録を消す", () => {
      tokenStore.set("jwt-abc");
      tokenStore.expire("jwt-abc");

      tokenStore.set("jwt-new");

      expect(tokenStore.wasExpired()).toBe(false);
    });

    it("clear（ログアウト）で失効の記録を消す", () => {
      tokenStore.set("jwt-abc");
      tokenStore.expire("jwt-abc");

      tokenStore.clear();

      expect(tokenStore.wasExpired()).toBe(false);
    });

    // 失効の記録が残ったまま、別タブでログイン → ログアウトされると、
    // こちらのタブは「期限切れ」でログイン画面へ送ってしまう。
    it("ほかのタブがトークンを変えたら（storage イベント）失効の記録を消す", () => {
      const unsubscribe = tokenStore.subscribe(() => {});
      tokenStore.set("jwt-abc");
      tokenStore.expire("jwt-abc");

      window.dispatchEvent(new StorageEvent("storage", { key: "kotoe.auth.token" }));

      expect(tokenStore.wasExpired()).toBe(false);
      unsubscribe();
    });

    it("無関係なキーの storage イベントでは消さない", () => {
      const unsubscribe = tokenStore.subscribe(() => {});
      tokenStore.set("jwt-abc");
      tokenStore.expire("jwt-abc");

      window.dispatchEvent(new StorageEvent("storage", { key: "other.key" }));

      expect(tokenStore.wasExpired()).toBe(true);
      unsubscribe();
    });
  });
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/auth/token-store.test.ts`
Expected: FAIL（`tokenStore.expire is not a function`）

- [ ] **Step 3: 実装する**

`frontend/src/lib/auth/token-store.ts` を次のように変える。

`let storageWritable = true;` の宣言（とそのコメント）の後ろに追加する。

```ts
// 最後にトークンが消えた理由が失効（api.ts が 401 を検知して expire() を呼んだ）か。
// RequireAuth がログイン画面へ ?reason=expired を付けるかどうかを決めるのに使う。
//
// タブごとのメモリにだけ持ち、localStorage には書かない。書くとタブ間で「消えた」と
// 「理由」が別々に届き、順序が保証されない（設計書「既知の制約 1」）。
let expired = false;
```

`tokenStore` の `set` と `clear` を次に置き換え、`clear` の後ろに `expire` と `wasExpired` を足す。

```ts
  set(token: string): void {
    expired = false;
    writeStorage(token);
    notify();
  },

  /** ログアウト。理由は持たない（自分で抜けたので、説明は要らない）。 */
  clear(): void {
    expired = false;
    writeStorage(null);
    notify();
  },

  /**
   * 失効したトークンを捨てる。api.ts が「Authorization を載せたリクエストの 401」で呼ぶ。
   *
   * 中身が token と一致するときだけ捨てる。token は送信時にキャプチャした値で、応答を
   * 待つ間に再ログインで差し替わっていることがある。そのとき古い 401 で新しいトークンを
   * 消すと、ログイン成功直後に未ログインへ戻される（複数の API を並行で叩くページで踏む）。
   *
   * 実際に捨てたときだけ true を返す。並行した 401 が何本返っても true は最初の 1 本だけ
   * なので、呼び出し側はこれを見て通知を 1 回に絞れる。
   */
  expire(token: string): boolean {
    if (readStorage() !== token) return false;

    // 通知より先に書く。購読者は通知の中で wasExpired() を読む。
    expired = true;
    writeStorage(null);
    notify();
    return true;
  },

  wasExpired(): boolean {
    return expired;
  },
```

`subscribe` の `onStorage` を次に置き換える。

```ts
    const onStorage = (event: StorageEvent) => {
      // key が null なのは localStorage.clear() のとき。これも取りこぼさない。
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      // ほかのタブがトークンを変えた。こちらで以前に記録した失効は、もう今の状態の理由ではない。
      // listener を呼ぶ前に消す（React は listener の中で wasExpired() を読み直す）。
      expired = false;
      listener();
    };
```

- [ ] **Step 4: 通ることを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/auth/token-store.test.ts`
Expected: PASS（既存 5 件 ＋ 追加 8 件）

- [ ] **Step 5: ミューテーションで、テストが一致判定と記録の順序を守っていることを確かめる**

1. `expire` の `if (readStorage() !== token) return false;` を一時的に消して Step 4 を実行 → 「中身が別のトークンなら」と「すでに捨てられていれば」が落ちることを確認
2. 戻してから、`expired = true;` を `notify();` の後ろへ一時的に移して Step 4 を実行 → 「通知の時点で」が落ちることを確認
3. どちらも元に戻し、Step 4 が PASS することを確認する

- [ ] **Step 6: コミット**

```bash
git add frontend/src/lib/auth/token-store.ts frontend/test/lib/auth/token-store.test.ts
git commit -F - <<'EOF'
feat: tokenStore に失効の記録（expire / wasExpired）を足す

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: api.ts が失効を 1 回だけ通知する

**Files:**
- Create: `frontend/src/lib/auth/session-expiry.ts`
- Modify: `frontend/src/lib/api.ts:1-3`（import）、`:132-148`（401 の判定）、`:155-177`（catch）
- Modify: `frontend/src/lib/auth/error-messages.ts:17-21`（文言の定義を import に置き換え）
- Modify: `SESSION_EXPIRED_MESSAGE` を `@/lib/auth/error-messages` から import している 5 ファイルと 2 テスト（import 元だけを変える）
- Test: `frontend/test/lib/api.test.ts`

**Interfaces:**
- Consumes: `tokenStore.expire(token): boolean`（Task 1）
- Produces:
  - `SESSION_EXPIRED_MESSAGE: string`（`@/lib/auth/session-expiry`。今後の import 元はここ）
  - `notifySessionExpired(): void`
  - api.ts：Authorization を載せた 401 で、`expire()` が true のときだけトーストが 1 件出る。本文を読む途中のタイムアウトは、このリクエストで失効させていれば `ApiError(401, null)`

- [ ] **Step 1: `session-expiry.ts` を作り、文言を移す**

`frontend/src/lib/auth/session-expiry.ts` を作る。

```ts
/**
 * JWT の失効（Authorization を載せたリクエストの 401）の知らせ方。
 *
 * 文言を error-messages.ts から移したのは、api.ts から使うため。error-messages.ts は
 * api.ts（ApiError）を import しているので、api.ts からあちらを import すると循環する。
 */

import { toast } from "@/lib/toast/toast-store";

/** ログインフォームの 401（unauthorized）とログイン画面の案内の枠でも使う。文言を 2 箇所に書かない。 */
export const SESSION_EXPIRED_MESSAGE = "セッションの有効期限が切れました。もう一度ログインしてください";

/**
 * 失効をトーストで知らせる。api.ts が tokenStore.expire() が true を返したときだけ呼ぶ。
 * 1 回の失効につき 1 回になるのは expire() の側が保証している（並行した 401 の 2 本目以降は false）。
 */
export function notifySessionExpired(): void {
  toast.error(SESSION_EXPIRED_MESSAGE);
}
```

`frontend/src/lib/auth/error-messages.ts` の 17〜21 行目（`SESSION_EXPIRED_MESSAGE` の JSDoc と定義）を消し、import に置き換える。

```ts
import { ApiError, ApiTimeoutError } from "@/lib/api";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/session-expiry";
import { NETWORK_MESSAGE, SERVER_MESSAGE, TIMEOUT_MESSAGE } from "@/lib/request-error-messages";
```

次のファイルの `import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/error-messages";` を `import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/session-expiry";` に置き換える（中身は変えない。Task 3 で大半が消える）。

- `frontend/src/components/posts/post-form.tsx`
- `frontend/src/components/posts/favorite-button.tsx`
- `frontend/src/components/attempts/attempt-composer.tsx`
- `frontend/src/lib/posts/post-messages.ts`
- `frontend/src/lib/attempts/attempt-messages.ts`
- `frontend/test/lib/posts/post-messages.test.ts`
- `frontend/test/lib/attempts/attempt-messages.test.ts`

Run: `grep -rn 'SESSION_EXPIRED_MESSAGE } from "@/lib/auth/error-messages"' frontend/src frontend/test`
Expected: 何も出ない

Run: `docker compose exec frontend npx tsc --noEmit`
Expected: エラー無し

- [ ] **Step 2: 失敗するテストを書く**

`frontend/test/lib/api.test.ts` の import を次に置き換える。

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, ApiTimeoutError, apiFetch, apiRequest } from "@/lib/api";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/session-expiry";
import { tokenStore } from "@/lib/auth/token-store";
import { toast, toastStore } from "@/lib/toast/toast-store";
```

`jsonResponse` の後ろにヘルパーを足す。

```ts
/** 失効のトースト。ほかのトーストと混ざっても数を数えられるよう、文言で絞る。 */
function sessionExpiredToasts() {
  return toastStore.get().filter((item) => item.message === SESSION_EXPIRED_MESSAGE);
}

/** トーストのストアはモジュールスコープでテスト間に持ち越されるので、公開 API で空に戻す。 */
function dismissAllToasts() {
  for (const item of toastStore.get()) toast.dismiss(item.id);
}
```

ファイル内の **2 つの** `beforeEach`（`describe("apiRequest", ...)` と `describe("apiRequest の timeout", ...)`）の本体の末尾に、どちらも `dismissAllToasts();` を足す。

ファイルの末尾に次の `describe` を足す。

```ts
describe("apiRequest の失効の通知", () => {
  beforeEach(() => {
    window.localStorage.clear();
    tokenStore.clear();
    dismissAllToasts();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("Authorization を載せたリクエストの 401 で、失効のトーストを 1 件出して失効を記録する", async () => {
    tokenStore.set("jwt-abc");
    stubFetch(jsonResponse({ error: "unauthorized" }, 401));

    await expect(apiFetch("/api/me")).rejects.toBeInstanceOf(ApiError);

    expect(sessionExpiredToasts()).toHaveLength(1);
    expect(tokenStore.wasExpired()).toBe(true);
  });

  // 起動時の復元が開発時の StrictMode で 2 回走る、マイページが並行で叩く、などで起きる。
  // 本数分出ると、同じ文言のトーストが画面の隅に積み上がる。
  it("並行した 401 が 3 本返っても、トーストは 1 件", async () => {
    tokenStore.set("jwt-abc");
    vi.stubGlobal(
      "fetch",
      // Response の本文は 1 回しか読めないので、呼ばれるたびに作る。
      vi.fn<typeof fetch>(async () => jsonResponse({ error: "unauthorized" }, 401)),
    );

    await Promise.allSettled([
      apiFetch("/api/me"),
      apiFetch("/api/posts/1/favorite", { method: "POST" }),
      apiFetch("/api/attempts/1/like", { method: "POST" }),
    ]);

    expect(sessionExpiredToasts()).toHaveLength(1);
  });

  // パスワードの誤り。失効ではない（ログイン画面の赤い枠が担当）。
  it("Authorization を載せていない 401 では出さない", async () => {
    stubFetch(jsonResponse({ error: "invalid_credentials" }, 401));

    await expect(
      apiFetch("/api/auth/sign_in", { method: "POST", skipAuth: true }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(sessionExpiredToasts()).toHaveLength(0);
    expect(tokenStore.wasExpired()).toBe(false);
  });

  // 再ログインで差し替わったあとに古い 401 が返った。今のセッションは生きているので、
  // 「期限切れ」と出すと、ログインし直したばかりの人に誤った指示を出すことになる。
  it("応答を待つ間に別のトークンへ差し替わっていたら出さない", async () => {
    tokenStore.set("jwt-old");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        tokenStore.set("jwt-new");
        return jsonResponse({ error: "unauthorized" }, 401);
      }),
    );

    await expect(apiFetch("/api/me")).rejects.toBeInstanceOf(ApiError);

    expect(sessionExpiredToasts()).toHaveLength(0);
    expect(tokenStore.get()).toBe("jwt-new");
  });

  // 7-2.7 設計書「後続への申し送り 2」。トークンは捨てたのに「応答がありません」と
  // 言われると、黙ってログアウトされたように見える。
  it("401 の本文を読む途中でタイムアウトしたら、ApiTimeoutError ではなく ApiError(401) を投げる", async () => {
    tokenStore.set("jwt-abc");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_input, init) => {
        // ヘッダまでは届き、本文が届かないまま中断される状況。本物の fetch と同じく、
        // signal が中断されたら本文の読み取りを signal.reason で失敗させる。
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
          },
        });
        return new Response(body, { status: 401 });
      }),
    );

    await expect(apiFetch("/api/me", { timeoutMs: 20 })).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
    });
    expect(sessionExpiredToasts()).toHaveLength(1);
  });

  // 上の変換は「このリクエストで失効させたとき」だけ。401 以外の本文の読み取り中の
  // タイムアウトまで 401 に化けさせてはいけない。
  it("401 以外の本文を読む途中のタイムアウトは ApiTimeoutError のまま", async () => {
    tokenStore.set("jwt-abc");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_input, init) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
          },
        });
        return new Response(body, { status: 200 });
      }),
    );

    await expect(apiFetch("/api/me", { timeoutMs: 20 })).rejects.toBeInstanceOf(ApiTimeoutError);
    expect(tokenStore.get()).toBe("jwt-abc");
  });
});
```

- [ ] **Step 3: 落ちることを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/api.test.ts`
Expected: FAIL。「401 で、失効のトーストを 1 件出して」「並行した 401」「本文を読む途中でタイムアウトしたら」の 3 件が落ちる（トーストが 0 件、`wasExpired()` が false、`ApiTimeoutError` が投げられる）。ほかは PASS

- [ ] **Step 4: 実装する**

`frontend/src/lib/api.ts` の import を次に置き換える。

```ts
import { notifySessionExpired } from "@/lib/auth/session-expiry";
import { tokenStore } from "@/lib/auth/token-store";
```

`const signal = ...` の後ろ、`try {` の直前に足す。

```ts
  // このリクエストの 401 でトークンを失効させたか。本文の読み取り中に timeout が
  // 発火したとき、ApiTimeoutError ではなく 401 として投げ直すのに使う（下の catch）。
  let expiredByThisRequest = false;
```

132〜148 行目（401 の判定のコメントと `if`）を次に置き換える。

```ts
    // Authorization を載せたリクエストが 401 を返した＝そのトークンが失効している。
    // 載せていないリクエストの 401 はログインの失敗（パスワード不一致）なので、
    // トークンを捨ててはいけない。Rails はどちらも 401 で返してくるため、
    // ステータスコードではなく「送信時に載せたか」で分ける。
    //
    // ここではリダイレクトしない。状態を落とすのは AuthProvider、
    // 画面遷移を決めるのは RequireAuth の仕事。認証不要ページで期限が切れても
    // ユーザーを画面から放り出さないため。
    //
    // 「今も同じトークンが入っているか」の比較は expire() の中にある。true が返るのは
    // 実際に捨てた 1 回だけなので、並行した 401 が何本あっても知らせは 1 回になる。
    // 各画面は 401 でトーストを出さない（ここが出す。7-2.6 設計書「決定 5」）。
    if (response.status === 401 && token && tokenStore.expire(token)) {
      expiredByThisRequest = true;
      notifySessionExpired();
    }
```

catch の中の `if (timeoutSignal.aborted && error instanceof Error && error.name === "TimeoutError") {` のブロックを次に置き換える（その上のコメントはそのまま残す）。

```ts
    if (timeoutSignal.aborted && error instanceof Error && error.name === "TimeoutError") {
      // 401 の本文を読んでいる最中に timeout が発火した。トークンはもう捨てて
      // 知らせも出したので、「応答がありません」ではなく 401 として扱わせる
      // （7-2.7 設計書「後続への申し送り 2」）。本文は読めていないので null。
      if (expiredByThisRequest) throw new ApiError(401, null);
      throw new ApiTimeoutError(timeoutMs);
    }
```

- [ ] **Step 5: 通ることを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/api.test.ts`
Expected: PASS（全件）

jsdom 環境で `ReadableStream` が未定義と言われた場合は、ファイル先頭を変えずに `import { ReadableStream } from "node:stream/web";` を足す（Node 側の実装で、`Response` が受け付ける）。

- [ ] **Step 6: ミューテーションで、テストが「1 回だけ」を守っていることを確かめる**

1. `if (response.status === 401 && token && tokenStore.expire(token)) {` を一時的に次の 2 行に変える。
   ```ts
   if (response.status === 401 && token) {
     tokenStore.expire(token);
   ```
   Step 5 を実行 → 「並行した 401 が 3 本返っても」と「差し替わっていたら出さない」が落ちることを確認する
2. 元に戻し、`if (expiredByThisRequest) throw new ApiError(401, null);` を一時的に消して Step 5 を実行 → 「本文を読む途中でタイムアウトしたら」が落ちることを確認する
3. 元に戻し、Step 5 が PASS することを確認する

- [ ] **Step 7: 全体のテストと型を確かめる**

Run: `docker compose exec frontend npm test`
Expected: PASS（この時点では各画面の個別トーストがまだ残っているが、純粋関数のテストは影響を受けない）

Run: `docker compose exec frontend npx tsc --noEmit`
Expected: エラー無し

- [ ] **Step 8: コミット**

```bash
git add frontend/src/lib/auth/session-expiry.ts frontend/src/lib/api.ts frontend/src/lib/auth/error-messages.ts \
  frontend/src/components/posts/post-form.tsx frontend/src/components/posts/favorite-button.tsx \
  frontend/src/components/attempts/attempt-composer.tsx frontend/src/lib/posts/post-messages.ts \
  frontend/src/lib/attempts/attempt-messages.ts frontend/test/lib/api.test.ts \
  frontend/test/lib/posts/post-messages.test.ts frontend/test/lib/attempts/attempt-messages.test.ts
git commit -F - <<'EOF'
feat: 失効を api.ts で 1 回だけトーストで知らせる

本文を読む途中のタイムアウトも 401 として投げ直す（7-2.7 の申し送り 2）。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: 各画面の個別の失効トーストを撤去する

Task 2 のあとは、操作の 401 でトーストが 2 件出る（api.ts と各画面）。ここで各画面の側を消す。

**Files:**
- Modify: `frontend/src/lib/attempts/attempt-messages.ts:168-175`（`toLikeErrorMessage`）
- Modify: `frontend/src/components/attempts/like-button.tsx:52`
- Modify: `frontend/src/components/posts/favorite-button.tsx:17-27`、`:66`
- Modify: `frontend/src/components/attempts/attempt-composer.tsx:28`、`:192-197`、`:285-290`
- Modify: `frontend/src/lib/posts/post-messages.ts:12`、`:175-188`（`toLeftPageFailureMessage`）
- Modify: `frontend/src/components/posts/post-form.tsx:11`、`:172-184`
- Test: `frontend/test/lib/attempts/attempt-messages.test.ts:192-197`、`frontend/test/lib/posts/post-messages.test.ts:188-190`

**Interfaces:**
- Consumes: api.ts が 401 でトーストを出すこと（Task 2）
- Produces:
  - `toLikeErrorMessage(error: unknown): string | null` … 401 は `null`
  - `toLeftPageFailureMessage(errors: PostFormErrors): string | null` … 失効は `null`

- [ ] **Step 1: 失敗するテストに書き換える**

`frontend/test/lib/attempts/attempt-messages.test.ts` の `it("401 は失効の文言", ...)` を次に置き換える。

```ts
  // 失効のトーストは api.ts が 1 回だけ出す（7-2.6）。ここでも文言を返すと 2 件になる。
  it("401 は null（トーストを出さない）", () => {
    expect(toLikeErrorMessage(new ApiError(401, { error: "unauthorized" }))).toBeNull();
  });
```

`frontend/test/lib/posts/post-messages.test.ts` の `it("失効はセッションの文言", ...)` を次に置き換える。

```ts
  // 失効のトーストは api.ts が 1 回だけ出す（7-2.6）。画面を離れたあとでも同じ。
  it("失効は null（トーストを出さない）", () => {
    expect(leave(new ApiError(401, null))).toBeNull();
  });
```

どちらのテストファイルでも `SESSION_EXPIRED_MESSAGE` を使わなくなったら、その import 行を消す（`grep -n SESSION_EXPIRED_MESSAGE <ファイル>` で、ほかに使っていないことを確かめてから）。

- [ ] **Step 2: 落ちることを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/attempts/attempt-messages.test.ts test/lib/posts/post-messages.test.ts`
Expected: FAIL（書き換えた 2 件。文言が返っている）

- [ ] **Step 3: 純粋関数を直す**

`frontend/src/lib/attempts/attempt-messages.ts` の `toLikeErrorMessage` の JSDoc と先頭を次に置き換える（404 以降の行はそのまま）。

```ts
/**
 * いいね（POST / DELETE :like）の失敗を 1 文にする。無言にしない（FavoriteButton と同じ方針）。
 *
 * 401 は失効で、null を返す（呼び出し側はトーストを出さない）。理由のトーストは api.ts が
 * 1 回だけ出し、ボタンはトークンが捨てられたことで「ログインしていいね」に変わる（7-2.6）。
 */
export function toLikeErrorMessage(error: unknown): string | null {
  if (error instanceof ApiError && error.status === 401) return null;
```

このファイルで `SESSION_EXPIRED_MESSAGE` を使わなくなったら import 行を消す。

`frontend/src/lib/posts/post-messages.ts` の `toLeftPageFailureMessage` を次に置き換える。

```ts
/**
 * 送信中に画面を離れたあとの失敗を、トーストの 1 文にする。成功のときはトーストを出すので、
 * 失敗で何も出さないと「投稿された」と受け取られる。
 *
 * - 失効：null（呼び出し側はトーストを出さない）。理由のトーストは api.ts が既に出している（7-2.6）
 * - unconfirmed：画面と同じ文（リンクは無し）
 * - rejected：理由を括弧で添える。欄のエラーがあればそれを優先する（直すべき入力が分かる）
 */
export function toLeftPageFailureMessage(errors: PostFormErrors): string | null {
  if (errors.form?.kind === "session_expired") return null;
  if (errors.form?.kind === "unconfirmed") return unconfirmedMessage(errors.form.reason);

  const reason = errors.image ?? errors.title ?? errors.form?.reason ?? UNKNOWN_FIELD_REASON;
  return `${POST_FAILED_PREFIX}（${reason}）`;
}
```

12 行目の `import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/session-expiry";` を消す（`grep -n SESSION_EXPIRED_MESSAGE frontend/src/lib/posts/post-messages.ts` が 0 件になること）。

- [ ] **Step 4: 通ることを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/attempts/attempt-messages.test.ts test/lib/posts/post-messages.test.ts`
Expected: PASS

- [ ] **Step 5: 呼び出し側を直す**

`frontend/src/components/attempts/like-button.tsx` の catch を次に置き換える。

```ts
    } catch (error: unknown) {
      // 失効（401）は null。理由のトーストは api.ts が出している。
      const message = toLikeErrorMessage(error);
      if (message !== null) toast.error(message);
    } finally {
```

`frontend/src/components/posts/favorite-button.tsx` の `toFavoriteErrorMessage` を次に置き換える。

```ts
/**
 * 失敗を 1 文にする。**無言にしない**のが要点（backlog 7-3b）。
 *
 * 401 は失効で、null を返す（呼び出し側はトーストを出さない）。理由のトーストは api.ts が
 * 1 回だけ出し、ボタンはトークンが捨てられたことで「ログインしてお気に入り」に変わる（7-2.6）。
 */
function toFavoriteErrorMessage(error: unknown): string | null {
  if (error instanceof ApiError && error.status === 401) return null;
  if (error instanceof ApiError && error.status === 404) return POST_GONE_MESSAGE;
  return toRequestErrorMessage(error);
}
```

同じファイルの catch を次に置き換え、`SESSION_EXPIRED_MESSAGE` の import 行を消す。

```ts
    } catch (error: unknown) {
      const message = toFavoriteErrorMessage(error);
      if (message !== null) toast.error(message);
    } finally {
```

`frontend/src/components/attempts/attempt-composer.tsx`：

- `showSaveError` の失効の分岐を次に置き換える。
  ```ts
    // 失効。文面は残す（入力欄は常に表示）。ボタン領域はログイン導線に変わる。
    // 理由のトーストは api.ts が出している（7-2.6）。
    if (isUnauthorized(error)) {
      focusTextareaAfterRender();
      return null;
    }
  ```
- `showGenerateError` の失効の分岐を次に置き換える。
  ```ts
    // 理由のトーストは api.ts が出している（7-2.6）。
    if (isUnauthorized(error)) {
      setPhase({ kind: "idle" });
      focusTextareaAfterRender();
      return;
    }
  ```
- 28 行目の `import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/session-expiry";` を消す。

`frontend/src/components/posts/post-form.tsx`：

- 画面を離れたあとの分岐を次に置き換える。
  ```ts
    // 送信中に画面を離れていたら、フォームはもう無い。成功だけトーストが出て失敗が無言だと、
    // 投稿されたと受け取られるので、失敗もトーストで伝える。失効は null（api.ts が出している）。
    if (!mountedRef.current) {
      const message = toLeftPageFailureMessage(errors);
      if (message !== null) toast.error(message);
      return;
    }
  ```
- 失効の分岐を次に置き換える。
  ```ts
    if (errors.form?.kind === "session_expired") {
      // api.ts がトークンを捨てて理由のトーストも出したので、RequireAuth がこのあと
      // /login?reason=expired へ送る。入力は消える（既知の制約。7-3d で扱う）。
      return;
    }
  ```
- 11 行目の `import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/session-expiry";` を消す。

Run: `grep -rn SESSION_EXPIRED_MESSAGE frontend/src`
Expected: `session-expiry.ts` と `error-messages.ts` だけ（Task 5 で `login-form.tsx` が加わる）

- [ ] **Step 6: 全体を確かめる**

Run: `docker compose exec frontend npm test`
Expected: PASS

Run: `docker compose exec frontend npx tsc --noEmit && docker compose exec frontend npm run lint`
Expected: エラー無し（未使用 import の警告も無い）

- [ ] **Step 7: コミット**

```bash
git add frontend/src/lib/attempts/attempt-messages.ts frontend/src/components/attempts/like-button.tsx \
  frontend/src/components/posts/favorite-button.tsx frontend/src/components/attempts/attempt-composer.tsx \
  frontend/src/lib/posts/post-messages.ts frontend/src/components/posts/post-form.tsx \
  frontend/test/lib/attempts/attempt-messages.test.ts frontend/test/lib/posts/post-messages.test.ts
git commit -F - <<'EOF'
refactor: 各画面の失効トーストを撤去し、api.ts の 1 件に寄せる

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: 認証状態に expired を載せ、RequireAuth が ?reason=expired を付ける

**Files:**
- Create: `frontend/src/lib/auth/login-reason.ts`
- Modify: `frontend/src/lib/auth/derive-auth-state.ts`
- Modify: `frontend/src/lib/auth/auth-context.tsx:34-38`（モジュール直下の関数）、`:62-66`（購読）、`:167-176`（`value`）
- Modify: `frontend/src/lib/auth/require-auth.tsx`
- Test: `frontend/test/lib/auth/login-reason.test.ts`（新規）、`frontend/test/lib/auth/derive-auth-state.test.ts`

**Interfaces:**
- Consumes: `tokenStore.wasExpired()`（Task 1）
- Produces:
  - `AuthState` の `unauthenticated` が `{ status: "unauthenticated"; expired: boolean }` になる
  - `AuthStateInput` に `expired: boolean`
  - `LOGIN_REASON_EXPIRED = "expired"`
  - `parseLoginReason(raw: string | string[] | undefined): "expired" | null`
  - `loginPathFor(current: string, expired: boolean): string`

- [ ] **Step 1: 失敗するテストを書く（login-reason）**

`frontend/test/lib/auth/login-reason.test.ts` を作る。

```ts
import { describe, expect, it } from "vitest";

import { LOGIN_REASON_EXPIRED, loginPathFor, parseLoginReason } from "@/lib/auth/login-reason";

describe("parseLoginReason", () => {
  it('"expired" だけを通す', () => {
    expect(parseLoginReason("expired")).toBe("expired");
  });

  // ?reason= は誰でも書ける。完全に一致しないものは、それらしく見えても通さない。
  it.each([
    ["未指定", undefined],
    ["空文字", ""],
    ["大文字", "EXPIRED"],
    ["前後の空白", " expired "],
    ["別の値", "foo"],
    ["同じキーが 2 つ（配列で来る）", ["expired", "expired"]],
  ])("%s は null", (_label, raw) => {
    expect(parseLoginReason(raw)).toBeNull();
  });
});

describe("loginPathFor", () => {
  it("失効でなければ next だけを付ける（今までの URL と同じ）", () => {
    expect(loginPathFor("/posts/new", false)).toBe("/login?next=%2Fposts%2Fnew");
  });

  it("失効なら reason=expired を付ける", () => {
    expect(loginPathFor("/posts/new", true)).toBe("/login?reason=expired&next=%2Fposts%2Fnew");
  });

  // 戻り先のクエリが /login のクエリに混ざると、next が途中で切れ、reason を上書きされる。
  it("戻り先のクエリはエンコードして next の中に閉じ込める", () => {
    const path = loginPathFor("/posts/1?sort=likes&reason=x", true);
    const params = new URLSearchParams(path.split("?")[1]);

    expect(params.get("next")).toBe("/posts/1?sort=likes&reason=x");
    expect(params.getAll("reason")).toEqual([LOGIN_REASON_EXPIRED]);
  });

  // 送る側（RequireAuth）と受ける側（ログイン画面）の文字列が食い違うと、枠が二度と出ない。
  it("組み立てた URL の reason は parseLoginReason を通る", () => {
    const params = new URLSearchParams(loginPathFor("/posts/new", true).split("?")[1]);

    expect(parseLoginReason(params.get("reason") ?? undefined)).toBe("expired");
  });
});
```

- [ ] **Step 2: 失敗するテストに書き換える（derive-auth-state）**

`frontend/test/lib/auth/derive-auth-state.test.ts` の `base` を次に置き換える。

```ts
const base: AuthStateInput = {
  hydrated: true,
  token: null,
  session: null,
  restoreFailedFor: null,
  expired: false,
};
```

`it("トークンが無ければ unauthenticated を返す", ...)` を次に置き換え、その後ろに 2 件足す。

```ts
  it("トークンが無ければ unauthenticated を返す", () => {
    expect(deriveAuthState({ ...base, token: null })).toEqual({
      status: "unauthenticated",
      expired: false,
    });
  });

  it("失効でトークンが消えたなら、unauthenticated に expired: true を載せる", () => {
    expect(deriveAuthState({ ...base, token: null, expired: true })).toEqual({
      status: "unauthenticated",
      expired: true,
    });
  });

  // 判定の順序は変えない。ハイドレーション前は、失効の記録があっても loading。
  it("ハイドレーション前は、失効の記録があっても loading を返す", () => {
    expect(deriveAuthState({ ...base, hydrated: false, token: null, expired: true })).toEqual({
      status: "loading",
    });
  });
```

- [ ] **Step 3: 落ちることを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/auth/login-reason.test.ts test/lib/auth/derive-auth-state.test.ts`
Expected: FAIL（`login-reason` が解決できない。derive-auth-state は `expired` が出力に無い）

- [ ] **Step 4: login-reason.ts を作る**

`frontend/src/lib/auth/login-reason.ts` を作る。

```ts
/**
 * ログイン画面へ送るときの「なぜ送ったか」（?reason=）の組み立てと検証。
 *
 * 送る側（RequireAuth）と受ける側（ログイン画面）を同じファイルに置くのは、
 * 文字列が食い違うと枠が二度と出ず、しかもどちらのテストも green のままになるため。
 */

export const LOGIN_REASON_EXPIRED = "expired";

export type LoginReason = typeof LOGIN_REASON_EXPIRED;

/**
 * `?reason=` を検証する。完全に一致したときだけ通し、それ以外はすべて null。
 *
 * `?reason=` は URL に載る＝誰でも書ける値（safeNextPath の ?next= と同じ）。
 * ただし値そのものは画面に出さず、固定の文言を出すかどうかを決めるだけに使う。
 * 外部から ?reason=expired 付きのリンクを踏まされても、出るのはこちらが決めた 1 文だけ。
 *
 * 同じキーが重なると Next の searchParams は配列で渡す。どちらを採るか迷う値は通さない。
 */
export function parseLoginReason(raw: string | string[] | undefined): LoginReason | null {
  return raw === LOGIN_REASON_EXPIRED ? LOGIN_REASON_EXPIRED : null;
}

/**
 * RequireAuth がログイン画面へ送るときの URL。current はクエリを含む今の場所。
 * 失効でなければ今までと同じ /login?next=... を返す。
 */
export function loginPathFor(current: string, expired: boolean): string {
  const next = `next=${encodeURIComponent(current)}`;
  return expired ? `/login?reason=${LOGIN_REASON_EXPIRED}&${next}` : `/login?${next}`;
}
```

- [ ] **Step 5: deriveAuthState を直す**

`frontend/src/lib/auth/derive-auth-state.ts` の `AuthState` の `unauthenticated` の行を次に置き換える。

```ts
  /**
   * 未ログインが確定した（トークンが無い、または 401 で破棄された）。
   * expired は「401 で破棄された」とき true。5 つ目の状態にしないのは、未ログインと同じ表示で
   * よい分岐が 7 箇所あり、状態を分けると 1 箇所の漏れでそこだけ何も出なくなるため（7-2.6 決定 2）。
   * 見るのは RequireAuth だけ。
   */
  | { status: "unauthenticated"; expired: boolean }
```

`AuthStateInput` の `restoreFailedFor` の後ろに足す。

```ts
  /** 最後にトークンが消えた理由が失効か（tokenStore.wasExpired()） */
  expired: boolean;
```

`deriveAuthState` の引数の分割代入に `expired` を足し、`token === null` の行を次に置き換える。

```ts
  if (token === null) return { status: "unauthenticated", expired };
```

コメントの「4 つの入力から」を「5 つの入力から」に直す。判定の順序とその説明は変えない。

- [ ] **Step 6: テストが通ることを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/auth/login-reason.test.ts test/lib/auth/derive-auth-state.test.ts`
Expected: PASS

- [ ] **Step 7: AuthProvider で wasExpired を購読する**

`frontend/src/lib/auth/auth-context.tsx` の `const notHydratedOnServer = () => false;` の後ろに足す。

```ts
// サーバーはトークンを持たないので、失効もしていない。
const notExpiredOnServer = () => false;
```

`const token = useSyncExternalStore(...)` の後ろに足す。

```ts
  // 最後にトークンが消えた理由が失効か。expire() は記録してから通知するので、
  // token が null になった描画では、こちらも同じ描画で true になっている。
  const expired = useSyncExternalStore(
    tokenStore.subscribe,
    tokenStore.wasExpired,
    notExpiredOnServer,
  );
```

`value` の `useMemo` を次に置き換える。

```ts
  const value = useMemo<AuthContextValue>(
    () => ({
      ...deriveAuthState({ hydrated, token, session, restoreFailedFor, expired }),
      signUp,
      signIn,
      signOut,
      retryRestore,
    }),
    [hydrated, token, session, restoreFailedFor, expired, signUp, signIn, signOut, retryRestore],
  );
```

- [ ] **Step 8: RequireAuth で loginPathFor を使う**

`frontend/src/lib/auth/require-auth.tsx` の import に足す。

```ts
import { loginPathFor } from "@/lib/auth/login-reason";
```

`const router = useRouter();` の後ろに足す。

```ts
  // 失効でログイン画面へ送るときは、理由を ?reason=expired で運ぶ（7-2.6 決定 3）。
  // effect の依存に入れるため、narrowing した結果を外で取り出しておく。
  const expired = auth.status === "unauthenticated" && auth.expired;
```

effect の中の `router.replace(...)` の行を次に置き換え、依存配列に `expired` を足す。

```ts
    router.replace(loginPathFor(current, expired));
    // pathname を依存に残すのは、クライアント遷移でここが再評価されるようにするため。
  }, [auth.status, expired, pathname, router]);
```

- [ ] **Step 9: 全体を確かめる**

Run: `docker compose exec frontend npm test`
Expected: PASS

Run: `docker compose exec frontend npx tsc --noEmit && docker compose exec frontend npm run lint`
Expected: エラー無し

- [ ] **Step 10: コミット**

```bash
git add frontend/src/lib/auth/login-reason.ts frontend/src/lib/auth/derive-auth-state.ts \
  frontend/src/lib/auth/auth-context.tsx frontend/src/lib/auth/require-auth.tsx \
  frontend/test/lib/auth/login-reason.test.ts frontend/test/lib/auth/derive-auth-state.test.ts
git commit -F - <<'EOF'
feat: 失効でログイン画面へ送るときに ?reason=expired を付ける

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: ログイン画面に案内の枠を出す

**Files:**
- Create: `frontend/src/components/auth/login-form.tsx`
- Modify: `frontend/src/app/(auth)/login/page.tsx`（全体を置き換え）

**Interfaces:**
- Consumes: `parseLoginReason()`（Task 4）、`SESSION_EXPIRED_MESSAGE`（Task 2）、`RawSearchParams`（既存 `@/lib/search-params`）
- Produces: `LoginForm({ expired }: { expired: boolean })`

このタスクはコンポーネントだけなので単体テストは書かない（CLAUDE.md のテスト方針）。検証は Step 3 の手動確認。

- [ ] **Step 1: 今の login/page.tsx の中身を login-form.tsx へ移す**

`frontend/src/components/auth/login-form.tsx` を作る。中身は今の `frontend/src/app/(auth)/login/page.tsx` を基に、次の 4 点だけを変える。

1. 関数名を `export function LoginForm({ expired }: { expired: boolean })` にする（`export default` にしない）
2. import に `import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/session-expiry";` を足す
3. `<form>` の最初の子として、赤いエラー枠の**前に**案内の枠を置く
4. ファイル先頭に、移した理由のコメントを置く

出来上がりは次のとおり（`resolveNextPath` とそのコメント、`handleSubmit`、`useEffect` は今のまま）。

```tsx
"use client";

// ログイン画面の本体。page.tsx（サーバーコンポーネント）が ?reason= を検証して expired を渡す。
// ページ側で読むのは、useSearchParams() が <Suspense> を要求して本番ビルドだけ落ちるのと、
// 枠をサーバーが返す HTML の時点で入れておき、表示後に差し込まれて入力欄がずれるのを避けるため
// （7-2.6 決定 4）。

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { buttonClasses } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { useAuth } from "@/lib/auth/auth-context";
import { toAuthFormErrors, type AuthFormErrors } from "@/lib/auth/error-messages";
import { safeNextPath } from "@/lib/auth/safe-next-path";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/session-expiry";

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

export function LoginForm({ expired }: { expired: boolean }) {
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
        {/*
          失効でここへ送られたときの案内。エラーではないので赤にしない。
          role="status"（alert ではない）：着いた時点から出ている説明で、割り込んで読み上げるものではない。
          ログインに失敗しても消さず、赤い枠はこの下に出る。
        */}
        {expired && (
          <p role="status" className="rounded-card bg-accent/10 px-3 py-2 text-sm text-ink">
            {SESSION_EXPIRED_MESSAGE}
          </p>
        )}

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
          className={`mt-2 ${buttonClasses()}`}
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

`frontend/src/app/(auth)/login/page.tsx` を次で置き換える。

```tsx
import { LoginForm } from "@/components/auth/login-form";
import { parseLoginReason } from "@/lib/auth/login-reason";
import type { RawSearchParams } from "@/lib/search-params";

/**
 * サーバーコンポーネントのまま、?reason= を検証して LoginForm に渡すだけにする（/posts と同じ形）。
 *
 * searchParams を読むので、このページは静的ではなくリクエストごとに描画される。描画は
 * Vercel 側で行い Render は叩かないので、スリープの影響は受けない（7-2.6 決定 4）。
 * ?next= はここでは読まない。LoginForm がイベントハンドラの中で window.location から読む。
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const reason = parseLoginReason((await searchParams).reason);

  return <LoginForm expired={reason === "expired"} />;
}
```

- [ ] **Step 2: 型・lint・テストを確かめる**

Run: `docker compose exec frontend npx tsc --noEmit && docker compose exec frontend npm run lint && docker compose exec frontend npm test`
Expected: すべてエラー無し・PASS

- [ ] **Step 3: ログイン画面を手で確かめる**

`docker compose up -d` の状態で、ログアウトした状態のブラウザから確かめる（`http://localhost:3001`）。

1. `/login` … 枠は出ない。ログインできて `/` へ戻る（分割で既存の動きが壊れていない）
2. `/login?reason=expired` … フォームの上に枠（薄い緑の背景・黒い文字）が出る。**リロードしても出たまま**
3. `/login?reason=expired` で誤ったパスワードを送る … 枠の下に赤いエラー枠が出て、枠は残る
4. `/login?reason=EXPIRED`、`/login?reason=expired&reason=expired`、`/login?reason=foo` … どれも枠は出ない
5. ログインした状態で `/login?reason=expired&next=%2Fposts` を開く … フォームを見せずに `/posts` へ移る（Review Focus 4）
6. ページのソースを表示（`view-source:`）して、`/login?reason=expired` の HTML に文言が入っていることを確かめる（サーバーで描画されている）

- [ ] **Step 4: コミット**

```bash
git add frontend/src/components/auth/login-form.tsx "frontend/src/app/(auth)/login/page.tsx"
git commit -F - <<'EOF'
feat: 失効で送られたログイン画面に案内の枠を出す

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: backlog への反映と、通しの手動確認

**Files:**
- Modify: `docs/issues_backlog.md`（7-2.6 の節と 7-3d の節）

**Interfaces:**
- Consumes: Task 1〜5 のすべて
- Produces: なし

- [ ] **Step 1: 7-2.6 の節に決めたことを書く**

`docs/issues_backlog.md` の `### 🟢 7-2.6. セッション失効の通知と再ログイン導線` の節で、`- 依存：7-2.5 ...` の行の直後に次の 2 行を足す。

```markdown
- GitHub：#105
- 設計書：`docs/superpowers/specs/2026-10-16-issue-7-2-6-session-expiry-design.md`
```

同じ節の `- 完了条件：...` の行の直前に、次を足す。

```markdown
- **7-2.6 で決めたこと（後続が乗る前提）**：
  - 失効の記録は `tokenStore.expire()` / `wasExpired()`。**失効の知らせ（トースト）は api.ts が 1 回だけ出す**。
    各画面は 401 でトーストを出さないこと（出すと 2 件になる）。トースト以外の後処理（フォーカスなど）は各画面で行う
  - `AuthState` は 4 状態のまま。`unauthenticated` に `expired: boolean` が付く（見るのは `RequireAuth` だけ）
  - ガード付きページからは `loginPathFor()` が `/login?reason=expired&next=...` を組み立て、ログイン画面は
    `parseLoginReason()` で `"expired"` と完全に一致したときだけ案内の枠を出す
  - `SESSION_EXPIRED_MESSAGE` の置き場所は `lib/auth/session-expiry.ts`
  - 既知の制約：失効を最初に見つけたタブ以外では理由が出ない。画面を開いたまま 24 時間が過ぎても、操作するまで
    気づかない（認証不要の取得は失効したトークンでも 200 を返す）
  - 入力を守る件（先に決めること 3）は **7-3d に引き継いだ**
```

- [ ] **Step 2: 7-3d の節に引き継ぎを書く**

`### 🔵 7-3d. お題詳細の書きかけの描写を、画面を離れても失わない` の節で、`- 先に決めること：` の行の直前に次を足す。

```markdown
- **7-2.6 から引き継いだこと**：失効でログイン画面へ移るときも、同じ理由で書きかけが消える。
  対象はお題詳細の描写文に加えて、**お題投稿（`/posts/new`）の画像とタイトル**。
  `/posts/new` はガード付きなので、失効すると `RequireAuth` が `/login?reason=expired` へ送り、入力は必ず消える。
  画像は `File` なので `localStorage`・`sessionStorage` には残せない（Base64 にすると 1 枚で上限の約 5MB を超える）。
  残すなら保存先の候補に IndexedDB が入る
```

- [ ] **Step 3: 通しの手動確認**

`docker compose up -d` の状態で、ログインしてから確かめる（`http://localhost:3001`）。失効は、ブラウザの開発者ツールのコンソールで次を実行して再現する（壊れたトークンも失効したトークンも、Rails からは同じ 401 が返る。設計書「調べて分かったこと」）。

```js
localStorage.setItem("kotoe.auth.token", "broken.token.value")
```

同じタブで `setItem` しても storage イベントは発火しないので、画面は次の操作かリロードまで変わらない。

1. `/posts/new` を開いた状態で上を実行し、**リロード**する … トーストが 1 件、`/login?reason=expired&next=%2Fposts%2Fnew` へ移り、枠が出る。ログインすると `/posts/new` へ戻る（Review Focus 1）
2. トップで上を実行してリロード … トーストが 1 件出て、ヘッダーが「ログイン」になる。ページはそのまま。続けてヘッダーの「お題を投稿」を押す … `/login?reason=expired&next=%2Fposts%2Fnew` へ移り、枠が出る（クライアント遷移の経路）
3. お題詳細で上を実行（リロードしない）→ お気に入りを押す … トーストが **1 件だけ**。ボタンが「ログインしてお気に入り」に変わる
4. 挑戦詳細で同じことをいいねで行う … 同上（「ログインしていいね」）
5. お題詳細で描写を書き、上を実行してから「保存」 … トーストが 1 件、文面は残り、入力欄にフォーカスが戻る。「画像を生成」でも同じ
6. `/posts/new` で画像とタイトルを入れ、上を実行してから「投稿」 … トーストが 1 件、`/login?reason=expired&next=%2Fposts%2Fnew` へ移る（入力は消える。既知の制約）
7. ログアウトしてからヘッダーの「ログイン」を押す … 枠は出ない
8. 開発時（StrictMode）に 1 のリロードを行ったとき、トーストが 2 件にならない（Review Focus 3）

既知の制約 1（ほかのタブには理由が出ない）は、この方法では再現できないので確かめない。`setItem` 自体がほかのタブに storage イベントを送り、ほかのタブも壊れたトークンで `/api/me` を叩いて自分で 401 を受け取るため。

1〜8 のどれかで期待と違ったら、ここで止めて原因を調べる（superpowers:systematic-debugging）。

- [ ] **Step 4: 全体の最終確認**

Run: `docker compose exec frontend npx tsc --noEmit && docker compose exec frontend npm run lint && docker compose exec frontend npm test`
Expected: すべてエラー無し・PASS

- [ ] **Step 5: コミット**

```bash
git add docs/issues_backlog.md
git commit -F - <<'EOF'
docs: 7-2.6 の決定を backlog に書き、入力を守る件を 7-3d へ引き継ぐ

Refs #127

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## このあと（計画の範囲外。手順だけ記す）

- プッシュ前に `/code-review high` を通す（superpowers の最終レビューとは別に両方）。指摘を直したコミットにも再度かける
- PR 本文は `Closes #105`。7-3d（#127）は `Refs #127`（`Closes` にしない）
- Vercel のプレビュー URL で、Task 6 Step 3 の 1・2・7 と Task 5 Step 3 の 2・4 を確かめる
