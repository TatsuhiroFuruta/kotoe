# 挑戦詳細・比較ビュー 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/attempts/[id]` で公開済みの挑戦を元画像と並べて見せ、いいね・リンクのコピー・本人だけのダウンロードができるようにする。お題詳細のカードと生成直後の結果パネルから、そこへ移れるようにする。

**Architecture:** `page.tsx` はサーバーコンポーネントのまま id を検証するだけにし、取得はクライアントコンポーネント `AttemptDetail` が `GET /api/attempts/:id` を 1 本だけ呼ぶ（7-3b の `PostDetail` と同じ形）。比較表示・いいね・リンクのコピーは小さな部品に分け、いいねの応答は `AttemptDetail` が上書きとして持つ。純粋関数（id の解釈・URL・いいねの失敗文言）だけを切り出して Vitest で守る。

**Tech Stack:** Next.js 16.2.10（App Router）／ React 19.2.4 ／ TypeScript ／ TailwindCSS 4 ／ Vitest（jsdom）／ Docker Compose。**新しい依存は追加しない。**

**Spec:** `docs/superpowers/specs/2026-10-03-issue-7-4-attempt-detail-design.md`

**Issue:** GitHub #25（`docs/issues_backlog.md` 7-4）

**Branch:** `feat/attempt-detail`（作成済み。設計書のコミット `0556407` が載っている）

## Global Constraints

このプロジェクト全体の規約。**全タスクの要件に暗黙に含まれる。**

- **依存パッケージを追加しない。** `frontend/package.json` は変更しない。
- **`backend/` のコードは 1 行も変更しない。** API は 4-2・5-1 のものをそのまま使う。
- **`frontend/src/app/globals.css` を変更しない。** 過去 4 回の Turbopack stale は、すべてこのファイルの変更で起きている（`frontend/AGENTS.md`）。色は既存のトークン（`bg-canvas` / `bg-surface` / `text-ink` / `text-ink-muted` / `border-line` / `bg-line` / `bg-accent` / `text-accent` / `text-accent-strong` / `border-accent` / `outline-accent` / `rounded-card`）だけを使う。`zinc-500` のような生のパレットと `dark:` は書かない。
- **`useSearchParams()` を使わない。** Vercel の本番ビルドだけが落ちる（7-2 の規約）。
- **`dangerouslySetInnerHTML` を使わない**（eslint の `react/no-danger` が error）。描写文・タイトル・ユーザー名は `{value}` で出し、改行は `whitespace-pre-wrap` で反映する。
- **`<img src>` に入れてよいのは `cloudinaryUrlOrNull()` の戻り値だけ。ダウンロードの `<a href>` は `cloudinaryDownloadUrlOrNull()` の戻り値だけ。`<Link href>` は `attemptDetailHref(数値)` / `postDetailHref(数値)` / `postsHref()` と、`/login?next=` に `encodeURIComponent(attemptDetailHref(数値))` を付けたものだけ。** `next/image` は使わない（7-3a 決定 4）。
- **文字列はダブルクォート。** コメントは日本語で書き、「何をしているか」ではなく**「なぜそうしたか」**を書く。確かめていない「壊れたときの見え方」をコメントに書かない（メモリの規約）。
- **`any` を使わない。** API のレスポンスには型を付ける。
- **テストは `frontend/test/` に置き、`src/` の構造を写す。** コンポーネントのテストは書かない（CLAUDE.md のテスト方針。E2E は 8-1）。
- **env ファイルの中身を表示しない。**
- コマンドはリポジトリのルートで実行する。`npm` / `npx` は `docker compose exec frontend <コマンド>` としてコンテナ内で動かす。
- コミットメッセージの末尾は `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` で止める（セッションリンクを書かない）。PR 本文も同様。
- `git checkout` を使わない。ブランチも切り替えない（`feat/attempt-detail` の上だけで作業する）。

## Review Focus

どのタスクの単体テストも直接は叩かないが、使う人が最初に踏みそうな入力・条件。それぞれの確認は、そのコードを持つタスクに入れてある。

1. **ログイン済みで比較ビューを直接ロード・リロードしても、いいねの状態（押されているか）と「自分の挑戦ならボタンが無い」が正しい**（Link 遷移だけだとハイドレーションの経路が試されない）→ Task 4 の手動確認 6
2. **いいねの連打で 2 回トグルしない**（押して戻る、が 1 クリックで起きない）→ Task 2 の `pending` による disabled、Task 4 の手動確認 5
3. **空白の無い長い英数字の描写文・お題タイトル・ユーザー名が、スマホ幅で横スクロールを出さない** → Task 2 の `wrap-break-word`、Task 4 の手動確認 15・16
4. **期限切れのトークンを持ったまま開いても、公開済みの挑戦が見られる**（共有リンクを踏んだ久しぶりのユーザー）→ Task 4 の手動確認 3
5. **横長・縦長の元画像でも、再現画像と同じ大きさの枠に収まり、どちらも切り抜かれない** → Task 2 の `object-contain` / `object-cover`、Task 4 の手動確認 14

## ファイル構成

| ファイル | 責務 | タスク |
|---|---|---|
| `frontend/src/lib/attempts/attempt-detail-query.ts` | 新規。`parseAttemptId` / `attemptDetailHref` | 1 |
| `frontend/src/lib/attempts/attempt-messages.ts` | `toLikeErrorMessage` と文言 2 つを追加 | 1 |
| `frontend/src/types/api.ts` | `LikeResponse` を追加。`Attempt.liked` のコメントを直す | 1 |
| `frontend/test/lib/attempts/attempt-detail-query.test.ts` | 新規 | 1 |
| `frontend/test/lib/attempts/attempt-messages.test.ts` | `toLikeErrorMessage` のテストを追加 | 1 |
| `frontend/src/app/attempts/[id]/page.tsx` | 新規。id の検証だけ | 2 |
| `frontend/src/components/attempts/attempt-detail.tsx` | 新規（client）。取得・状態の出し分け・本体の配置 | 2 |
| `frontend/src/components/attempts/attempt-comparison.tsx` | 新規。2 つの `<figure>` | 2 |
| `frontend/src/components/attempts/like-button.tsx` | 新規（client）。いいねのトグル | 2 |
| `frontend/src/components/attempts/copy-link-button.tsx` | 新規（client）。リンクのコピー | 2 |
| `frontend/src/components/attempts/attempt-card.tsx` | `<Link>` で包む | 3 |
| `frontend/src/components/attempts/generation-panel.tsx` | `PublishedResult` に比較ビューへのリンク | 3 |
| `docs/issues_backlog.md` | 7-4 の節を完了の形に直す | 4 |

Task 3 を Task 2 の後に置くのは、**存在しないルートへリンクを置かない**ため（main は Vercel 本番を追跡している。7-3b の規約）。

---

### Task 1: 純粋関数と型

**Files:**
- Create: `frontend/src/lib/attempts/attempt-detail-query.ts`
- Modify: `frontend/src/lib/attempts/attempt-messages.ts`
- Modify: `frontend/src/types/api.ts`
- Test: `frontend/test/lib/attempts/attempt-detail-query.test.ts`（新規）
- Test: `frontend/test/lib/attempts/attempt-messages.test.ts`（追加）

**Interfaces:**
- Consumes: `parsePositiveInt(raw: string | undefined): number | null`（`@/lib/search-params`）、`apiErrorCode(error: unknown): string | null` と `fallbackErrorMessage(error: unknown): string`（同じファイル内）、`SESSION_EXPIRED_MESSAGE`（`@/lib/auth/error-messages`）
- Produces:
  - `parseAttemptId(raw: string): number | null`
  - `attemptDetailHref(id: number): string` → `/attempts/${id}`
  - `toLikeErrorMessage(error: unknown): string`
  - `ATTEMPT_GONE_MESSAGE = "この挑戦は削除されました"`、`CANNOT_LIKE_OWN_MESSAGE = "自分の挑戦にはいいねできません"`
  - `type LikeResponse = { attempt: Attempt }`

- [ ] **Step 1: id と URL の失敗するテストを書く**

`frontend/test/lib/attempts/attempt-detail-query.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import { attemptDetailHref, parseAttemptId } from "@/lib/attempts/attempt-detail-query";

describe("parseAttemptId", () => {
  it.each([
    ["1", 1],
    ["9", 9],
    ["007", 7],
  ])("%j は %d", (raw, expected) => {
    expect(parseAttemptId(raw)).toBe(expected);
  });

  it.each(["0", "-1", "1.5", "abc", "", "1e3", "99999999999999999999"])("%j は null", (raw) => {
    expect(parseAttemptId(raw)).toBeNull();
  });
});

describe("attemptDetailHref", () => {
  it("挑戦詳細のパスを返す", () => {
    expect(attemptDetailHref(12)).toBe("/attempts/12");
  });
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/attempts/attempt-detail-query.test.ts`
Expected: FAIL。`Failed to resolve import "@/lib/attempts/attempt-detail-query"`

- [ ] **Step 3: 実装する**

`frontend/src/lib/attempts/attempt-detail-query.ts`：

```ts
/**
 * 挑戦詳細（/attempts/[id]）の URL。カード・結果パネル・ログイン導線・リンクのコピーが
 * 同じ関数から作る（別々に組み立てると、片方だけ形が変わったときに気づけない）。
 */

import { parsePositiveInt } from "@/lib/search-params";

/**
 * URL の [id]。正の安全な整数の文字列だけを受け付ける。
 * それ以外は null を返し、page.tsx が API を呼ばずに notFound() にする（parsePostId と同じ）。
 */
export function parseAttemptId(raw: string): number | null {
  return parsePositiveInt(raw);
}

export function attemptDetailHref(id: number): string {
  return `/attempts/${id}`;
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/attempts/attempt-detail-query.test.ts`
Expected: PASS（11 件）

- [ ] **Step 5: いいねの文言の失敗するテストを書く**

`frontend/test/lib/attempts/attempt-messages.test.ts` の import を次に変える（`toLikeErrorMessage` と文言 2 つ、`SESSION_EXPIRED_MESSAGE` を足す）：

```ts
import { ApiError, ApiTimeoutError } from "@/lib/api";
import {
  ATTEMPT_GONE_MESSAGE,
  CANNOT_LIKE_OWN_MESSAGE,
  apiErrorCode,
  descriptionFieldError,
  fallbackErrorMessage,
  failureReasonMessage,
  generationErrorMessage,
  resetsInText,
  toLikeErrorMessage,
} from "@/lib/attempts/attempt-messages";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/error-messages";
import { NETWORK_MESSAGE, SERVER_MESSAGE, TIMEOUT_MESSAGE } from "@/lib/request-error-messages";
```

ファイルの末尾に足す：

```ts
describe("toLikeErrorMessage", () => {
  it("401 は失効の文言", () => {
    expect(toLikeErrorMessage(new ApiError(401, { error: "unauthorized" }))).toBe(
      SESSION_EXPIRED_MESSAGE,
    );
  });

  it("404 は挑戦が削除された文言（挑戦・お題のどちらが削除されても 404）", () => {
    expect(toLikeErrorMessage(new ApiError(404, { error: "not_found" }))).toBe(ATTEMPT_GONE_MESSAGE);
  });

  it("422 cannot_like_own_attempt は自分の挑戦の文言", () => {
    expect(toLikeErrorMessage(new ApiError(422, { error: "cannot_like_own_attempt" }))).toBe(
      CANNOT_LIKE_OWN_MESSAGE,
    );
  });

  it.each([
    ["422 で別のコード", new ApiError(422, { error: "something_else" })],
    ["JSON でないボディの 422", new ApiError(422, "<html>")],
    ["500", new ApiError(500, null)],
    ["timeout", new ApiTimeoutError(15_000)],
    ["通信断", new TypeError("Failed to fetch")],
  ])("%s は fallbackErrorMessage と同じ", (_label, error) => {
    expect(toLikeErrorMessage(error)).toBe(fallbackErrorMessage(error));
  });

  it("cannot_like_own_attempt でも 422 以外なら自分の挑戦の文言にしない", () => {
    expect(toLikeErrorMessage(new ApiError(400, { error: "cannot_like_own_attempt" }))).not.toBe(
      CANNOT_LIKE_OWN_MESSAGE,
    );
  });

  it("fallback に回った 422 はコードを含める（無言にしない）", () => {
    expect(toLikeErrorMessage(new ApiError(422, { error: "something_else" }))).toContain(
      "something_else",
    );
  });

  it("5xx・timeout・通信断は通信エラーの文言", () => {
    expect(toLikeErrorMessage(new ApiError(500, null))).toBe(SERVER_MESSAGE);
    expect(toLikeErrorMessage(new ApiTimeoutError(15_000))).toBe(TIMEOUT_MESSAGE);
    expect(toLikeErrorMessage(new TypeError("Failed to fetch"))).toBe(NETWORK_MESSAGE);
  });
});
```

- [ ] **Step 6: 失敗を確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/attempts/attempt-messages.test.ts`
Expected: FAIL。`toLikeErrorMessage is not a function`（既存のテストは PASS のまま）

- [ ] **Step 7: 実装する**

`frontend/src/lib/attempts/attempt-messages.ts`：

import に 1 行足す（`@/lib/api` の行の直後）：

```ts
import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/error-messages";
```

`QUOTA_USED_NOTE` の定義の直後に文言を足す：

```ts
/** いいねの 404。挑戦の削除だけでなく、お題の削除でも返る（5-1）。 */
export const ATTEMPT_GONE_MESSAGE = "この挑戦は削除されました";
/**
 * いいねの 422 cannot_like_own_attempt。比較ビューは自分の挑戦にボタンを出さないので、
 * 届くのは画面を開いた後に別タブで別アカウントへ切り替えたときなど。
 */
export const CANNOT_LIKE_OWN_MESSAGE = "自分の挑戦にはいいねできません";
```

ファイルの末尾に関数を足す：

```ts
/**
 * いいね（POST / DELETE :like）の失敗を 1 文にする。無言にしない（FavoriteButton と同じ方針）。
 *
 * 401 は失効。api.ts がトークンを捨てるので、ボタンはすぐ「ログインしていいね」に変わる。
 * 理由を伝えないと、押したら別のボタンに化けたようにしか見えない。
 */
export function toLikeErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return SESSION_EXPIRED_MESSAGE;
  if (error instanceof ApiError && error.status === 404) return ATTEMPT_GONE_MESSAGE;
  if (
    error instanceof ApiError &&
    error.status === 422 &&
    apiErrorCode(error) === "cannot_like_own_attempt"
  ) {
    return CANNOT_LIKE_OWN_MESSAGE;
  }
  return fallbackErrorMessage(error);
}
```

- [ ] **Step 8: 通ることを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/attempts`
Expected: PASS（既存を含めて全件）

- [ ] **Step 9: 型を足す**

`frontend/src/types/api.ts`：

`Attempt` の `liked` のコメントを変える：

```ts
  /** リクエストした本人がいいね済みか。未ログインなら常に false。描画するのは比較ビューだけ */
  liked: boolean;
```

`AttemptShowResponse` の定義の直後に足す：

```ts
/** POST / DELETE /api/attempts/:id/like。どちらも冪等で、更新後の liked と likes_count を含む。 */
export type LikeResponse = {
  attempt: Attempt;
};
```

- [ ] **Step 10: ミューテーションで確かめる（一時的に壊して戻す。コミットしない）**

1 つずつ壊し、`docker compose exec frontend npx vitest run test/lib/attempts` が **FAIL** することを確かめてから戻す。

1. `toLikeErrorMessage` の `error.status === 422 &&` を消す → 「422 以外なら自分の挑戦の文言にしない」が FAIL する
2. `return fallbackErrorMessage(error);` を `return toRequestErrorMessage(error);` に変える → 「コードを含める」のテストが FAIL する
3. 404 の分岐を消す → 404 のテストが FAIL する

全部戻したら `git diff --stat` で `attempt-messages.ts` の差分が Step 7 の内容だけであることを確かめる。

- [ ] **Step 11: 型・lint・全テスト**

```bash
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run lint
docker compose exec frontend npm test
```

Expected：エラー 0・全件 PASS

- [ ] **Step 12: コミット**

```bash
git add frontend/src/lib/attempts/attempt-detail-query.ts frontend/src/lib/attempts/attempt-messages.ts frontend/src/types/api.ts frontend/test/lib/attempts/attempt-detail-query.test.ts frontend/test/lib/attempts/attempt-messages.test.ts
git commit -m "feat: 挑戦詳細の URL といいねの失敗文言を足す

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```


---

### Task 2: 比較ビュー（`/attempts/[id]`）

**Files:**
- Create: `frontend/src/app/attempts/[id]/page.tsx`
- Create: `frontend/src/components/attempts/attempt-detail.tsx`
- Create: `frontend/src/components/attempts/attempt-comparison.tsx`
- Create: `frontend/src/components/attempts/like-button.tsx`
- Create: `frontend/src/components/attempts/copy-link-button.tsx`

**Interfaces:**
- Consumes: Task 1 の `parseAttemptId` / `attemptDetailHref` / `toLikeErrorMessage` / `LikeResponse`。既存の `apiFetch<T>(path, init)`・`ApiError`（`@/lib/api`）、`useAuth()`（`@/lib/auth/auth-context`。`status` が `"authenticated"` のときだけ `user: User` を持つ）、`toast.success / toast.error`（`@/lib/toast/toast-store`）、`toRequestErrorMessage`、`cloudinaryUrlOrNull(publicId, { width, aspect? })`、`cloudinaryDownloadUrlOrNull(publicId, { filename })`、`postDetailHref(id)`、`postsHref()`、`buttonClasses({ variant, size })`、型 `Attempt` / `AttemptShowResponse` / `PostSummary`
- Produces:
  - `AttemptDetail({ attemptId }: { attemptId: number })`
  - `AttemptComparison({ post, attempt }: { post: PostSummary; attempt: Attempt })`
  - `LikeButton({ attempt, onChange }: { attempt: Attempt; onChange: (attempt: Attempt) => void })`
  - `CopyLinkButton({ href }: { href: string })`（`href` はパス。`/attempts/12` の形）

コンポーネントのテストは書かない（CLAUDE.md）。確認は型・lint と、Task 4 の手動確認で行う。

- [ ] **Step 1: 比較表示を書く**

`frontend/src/components/attempts/attempt-comparison.tsx`：

```tsx
import { cloudinaryUrlOrNull } from "@/lib/cloudinary";
import type { Attempt, PostSummary } from "@/types/api";

// 再現画像はカード・結果パネルと同じ変換にし、Cloudinary の派生画像を共有する（7-3b 設計書「決定 4」）。
// 元画像も同じ幅にそろえる（枠の大きさが同じなので、片方だけ細かくしても見比べる役に立たない）。
const IMAGE_WIDTH = 640;

/**
 * 元画像と再現画像を、同じ幅の正方形枠 2 つで並べる（7-4 設計書「決定 4」）。
 * 順番は元画像 → 再現画像（お題 → 再現の時系列。お題詳細と同じ並び）。
 *
 * 元画像は縦横比が自由で、切り抜かない（描写の対象そのもののため。7-3b 決定 4）。
 * 枠に object-contain で収め、余白は bg-line の帯になる。再現画像は 1:1 なので枠いっぱいになる。
 */
export function AttemptComparison({ post, attempt }: { post: PostSummary; attempt: Attempt }) {
  const originalSrc = cloudinaryUrlOrNull(post.image_public_id, { width: IMAGE_WIDTH });
  const publicId = attempt.generated_image_public_id;
  const generatedSrc =
    publicId === null ? null : cloudinaryUrlOrNull(publicId, { width: IMAGE_WIDTH, aspect: "1:1" });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <ComparisonFigure caption="お題" src={originalSrc} alt={post.title} fit="contain" />
      {/* alt に描写文を入れない。長文になりうるうえ、画像の中身ではなく「当てようとした言葉」のため（カードと同じ）。 */}
      <ComparisonFigure
        caption="再現"
        src={generatedSrc}
        alt={`${attempt.user.name} さんの再現画像`}
        fit="cover"
      />
    </div>
  );
}

function ComparisonFigure({
  caption,
  src,
  alt,
  fit,
}: {
  caption: string;
  src: string | null;
  alt: string;
  fit: "contain" | "cover";
}) {
  const fitClass = fit === "contain" ? "object-contain" : "object-cover";

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-sm font-semibold text-ink-muted">{caption}</figcaption>
      {/*
        next/image ではなく <img>（7-3a 設計書「決定 4」）。loading="lazy" にしない（ページの主役で、
        最初に見える画像のため）。URL を組み立てられないときは同じ寸法の空枠を出す（カードと同じ）。
      */}
      {src === null ? (
        <div role="img" aria-label={alt} className="aspect-square w-full rounded-card bg-line" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className={`aspect-square w-full rounded-card bg-line ${fitClass}`} />
      )}
    </figure>
  );
}
```

- [ ] **Step 2: いいねボタンを書く**

`frontend/src/components/attempts/like-button.tsx`：

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { attemptDetailHref } from "@/lib/attempts/attempt-detail-query";
import { toLikeErrorMessage } from "@/lib/attempts/attempt-messages";
import { useAuth } from "@/lib/auth/auth-context";
import { toast } from "@/lib/toast/toast-store";
import type { Attempt, LikeResponse } from "@/types/api";

/**
 * いいねのトグル。**楽観更新しない**。API は冪等で、応答が更新後の liked と likes_count を
 * 返すので、それで表示を確定させれば巻き戻しのロジックが要らない（FavoriteButton と同じ。
 * 7-4 設計書「決定 5」）。いいね数は呼び出し側が出す（ボタンが無い場合も数は出すため）。
 */
export function LikeButton({
  attempt,
  onChange,
}: {
  attempt: Attempt;
  onChange: (attempt: Attempt) => void;
}) {
  const auth = useAuth();
  const [pending, setPending] = useState(false);

  if (auth.status === "unauthenticated") {
    // ログイン画面側が safeNextPath() で検証する。
    return (
      <Link
        href={`/login?next=${encodeURIComponent(attemptDetailHref(attempt.id))}`}
        className={`${buttonClasses({ variant: "secondary", size: "sm" })} text-sm`}
      >
        ログインしていいね
      </Link>
    );
  }

  // 自分の挑戦には出さない。押せば必ず 422 になる（いいねは再現度への投票で、自票を禁じている。5-1）。
  if (auth.status === "authenticated" && auth.user.id === attempt.user.id) return null;

  async function toggle() {
    setPending(true);
    try {
      const { attempt: updated } = await apiFetch<LikeResponse>(`/api/attempts/${attempt.id}/like`, {
        method: attempt.liked ? "DELETE" : "POST",
      });
      onChange(updated);
    } catch (error: unknown) {
      toast.error(toLikeErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      // loading の間は押せない（ログイン中か、自分の挑戦かが確定していない）。unreachable は押せる。
      // 押して失敗すれば toLikeErrorMessage で理由が出る。
      disabled={auth.status === "loading" || pending}
      // ラベルは固定し、状態は aria-pressed で伝える（ラベルと状態の両方を変えると読み上げが二重になる）。
      aria-pressed={attempt.liked}
      className={`${buttonClasses({ variant: attempt.liked ? "primary" : "secondary", size: "sm" })} text-sm`}
    >
      <span aria-hidden="true">{attempt.liked ? "♥" : "♡"}</span> いいね
    </button>
  );
}
```

- [ ] **Step 3: リンクのコピーを書く**

`frontend/src/components/attempts/copy-link-button.tsx`：

```tsx
"use client";

import { buttonClasses } from "@/components/ui/button";
import { toast } from "@/lib/toast/toast-store";

const COPIED_MESSAGE = "リンクをコピーしました";
const COPY_FAILED_MESSAGE = "リンクをコピーできませんでした。アドレスバーの URL をコピーしてください";

/**
 * 比較ビューのパーマリンクをコピーする（7-4 設計書「決定 6」）。
 *
 * location.href ではなく、渡されたパスから組み立てる。? や # 付きで開かれたとき、それまで
 * 共有されてしまうため。
 */
export function CopyLinkButton({ href }: { href: string }) {
  async function copy() {
    try {
      // clipboard は https か localhost でしか生えない。LAN 経由の dev サーバー（http、0-6）では
      // undefined になる。その場合も失敗として同じ文言を出す。
      if (typeof navigator.clipboard?.writeText !== "function") {
        throw new Error("Clipboard API is unavailable");
      }
      await navigator.clipboard.writeText(new URL(href, window.location.origin).toString());
      toast.success(COPIED_MESSAGE);
    } catch {
      toast.error(COPY_FAILED_MESSAGE);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`${buttonClasses({ variant: "secondary", size: "sm" })} text-sm`}
    >
      リンクをコピー
    </button>
  );
}
```

- [ ] **Step 4: 取得と状態の出し分けを書く**

`frontend/src/components/attempts/attempt-detail.tsx`：

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AttemptComparison } from "@/components/attempts/attempt-comparison";
import { CopyLinkButton } from "@/components/attempts/copy-link-button";
import { LikeButton } from "@/components/attempts/like-button";
import { buttonClasses } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { attemptDetailHref } from "@/lib/attempts/attempt-detail-query";
import { useAuth } from "@/lib/auth/auth-context";
import { cloudinaryDownloadUrlOrNull } from "@/lib/cloudinary";
import { postDetailHref } from "@/lib/posts/post-detail-query";
import { postsHref } from "@/lib/posts/posts-query";
import { toRequestErrorMessage } from "@/lib/request-error-messages";
import type { Attempt, AttemptShowResponse } from "@/types/api";

type Outcome =
  | { kind: "success"; data: AttemptShowResponse }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

/** いいねの操作結果。取得した値より新しいので、こちらを優先する。 */
type LikeOverride = { attemptId: number; liked: boolean; likesCount: number };

/**
 * 挑戦詳細・比較ビュー。取得はクライアントで 1 本だけ行う（7-4 設計書「決定 1」）。
 *
 * 結果は 7-3b の PostDetail と同じく「どのリクエストの結果か」を表す key と一緒に持ち、
 * 今の key と一致しないものは表示しない（effect の中で同期的に setState しない）。
 *
 * 認証状態の確定は待たずに取得を始める。apiFetch は tokenStore のトークンを同期的に載せるので、
 * liked も「本人にだけ見える未公開の挑戦」も正しく返る。
 */
export function AttemptDetail({ attemptId }: { attemptId: number }) {
  const auth = useAuth();
  const [retryCount, setRetryCount] = useState(0);
  const requestKey = `${attemptId}#${retryCount}`;
  const [result, setResult] = useState<{ key: string; outcome: Outcome } | null>(null);
  const [likeOverride, setLikeOverride] = useState<LikeOverride | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    apiFetch<AttemptShowResponse>(`/api/attempts/${attemptId}`, { signal: controller.signal })
      .then((data) => setResult({ key: requestKey, outcome: { kind: "success", data } }))
      .catch((error: unknown) => {
        // 自分で中断した（アンマウントした）ものは失敗ではない。
        if (controller.signal.aborted) return;
        // 404 は削除済み・存在しない・他人の未公開・お題が削除済み。待っても変わらないので再試行を出さない。
        const outcome: Outcome =
          error instanceof ApiError && error.status === 404
            ? { kind: "not_found" }
            : { kind: "error", message: toRequestErrorMessage(error) };
        setResult({ key: requestKey, outcome });
      });

    return () => controller.abort();
  }, [attemptId, requestKey]);

  const outcome = result?.key === requestKey ? result.outcome : null;

  if (outcome === null) return <AttemptDetailSkeleton />;
  if (outcome.kind === "not_found") return <AttemptNotFound />;
  if (outcome.kind === "error") {
    return <ErrorPanel message={outcome.message} onRetry={() => setRetryCount((count) => count + 1)} />;
  }

  const { post } = outcome.data;
  const fetched = outcome.data.attempt;

  // 本人にだけ返る draft / generating / failed は比較ビューにしない（決定 2）。
  if (fetched.status !== "published") return <AttemptNotPublished postId={post.id} />;

  const attempt: Attempt =
    likeOverride?.attemptId === fetched.id
      ? { ...fetched, liked: likeOverride.liked, likes_count: likeOverride.likesCount }
      : fetched;

  // ダウンロードは本人の挑戦にだけ出す（決定 7。2026-09-30 決定）。
  const isOwner = auth.status === "authenticated" && auth.user.id === attempt.user.id;
  const downloadHref =
    isOwner && attempt.generated_image_public_id !== null
      ? cloudinaryDownloadUrlOrNull(attempt.generated_image_public_id, {
          filename: `kotoe-attempt-${attempt.id}`,
        })
      : null;

  return (
    <article className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href={postDetailHref(post.id)} className="self-start text-sm text-accent hover:text-accent-strong">
          ← お題に戻る
        </Link>
        {/* 公開 UGC。{value} のまま置く。長い英数字がはみ出さないよう wrap-break-word。 */}
        <h1 className="text-2xl font-semibold tracking-tight wrap-break-word text-ink">{post.title}</h1>
      </div>

      <AttemptComparison post={post} attempt={attempt} />

      <section aria-labelledby="attempt-description-heading" className="flex flex-col gap-2">
        <h2
          id="attempt-description-heading"
          className="text-sm font-semibold wrap-break-word text-ink-muted"
        >
          {attempt.user.name} さんの描写
        </h2>
        {/* 改行は whitespace-pre-wrap で反映する。<br> に置き換えると XSS になる（CLAUDE.md）。 */}
        <p className="whitespace-pre-wrap wrap-break-word text-ink">{attempt.description}</p>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-ink-muted">
          いいね <span className="font-medium text-ink">{attempt.likes_count}</span>
        </p>
        <LikeButton
          attempt={attempt}
          onChange={(updated) =>
            setLikeOverride({
              attemptId: updated.id,
              liked: updated.liked,
              likesCount: updated.likes_count,
            })
          }
        />
        <CopyLinkButton href={attemptDetailHref(attempt.id)} />
        {downloadHref !== null && (
          // download 属性は付けない（別オリジンでは効かない）。fl_attachment で保存させる。
          <a href={downloadHref} className={`${buttonClasses({ variant: "secondary", size: "sm" })} text-sm`}>
            ダウンロード（PNG）
          </a>
        )}
      </div>
    </article>
  );
}

function AttemptDetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="読み込み中" className="flex flex-col gap-6">
      <div className="h-8 w-2/3 animate-pulse rounded bg-line" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="aspect-square w-full animate-pulse rounded-card bg-line" />
        <div className="aspect-square w-full animate-pulse rounded-card bg-line" />
      </div>
      <div className="h-4 w-full animate-pulse rounded bg-line" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-line" />
    </div>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-card border border-line bg-surface p-8 text-center">
      <p className="text-ink">{message}</p>
      <button type="button" onClick={onRetry} className={buttonClasses({ variant: "secondary" })}>
        再試行
      </button>
    </div>
  );
}

function AttemptNotFound() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface p-10 text-center">
      <p className="text-ink">挑戦が見つかりませんでした。削除された可能性があります</p>
      <Link href={postsHref()} className="text-accent hover:text-accent-strong">
        お題を探す
      </Link>
    </div>
  );
}

function AttemptNotPublished({ postId }: { postId: number }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface p-10 text-center">
      <p className="text-ink">この挑戦はまだ公開されていません</p>
      <Link href={postDetailHref(postId)} className="text-accent hover:text-accent-strong">
        お題に戻る
      </Link>
    </div>
  );
}
```

- [ ] **Step 5: ページを書く**

`frontend/src/app/attempts/[id]/page.tsx`：

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AttemptDetail } from "@/components/attempts/attempt-detail";
import { parseAttemptId } from "@/lib/attempts/attempt-detail-query";

// 挑戦の中身（お題のタイトルなど）を入れるにはサーバーでの取得（generateMetadata）が要り、
// クライアント取得（7-4 設計書「決定 1」）と衝突する。OGP とあわせて 8-3 で扱う。
export const metadata: Metadata = {
  title: "挑戦",
};

/**
 * サーバーコンポーネントのまま、id を正規化して渡すだけにする。取得はしない
 * （Render がスリープしていると HTML ごと最大約 60 秒待たされるため。7-3a・7-3b と同じ）。
 *
 * id が正の整数でなければ API を呼ばずに 404。存在しない id は API の 404 を
 * AttemptDetail が画面内で出す。
 */
export default async function AttemptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const attemptId = parseAttemptId((await params).id);
  if (attemptId === null) notFound();

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <AttemptDetail attemptId={attemptId} />
    </main>
  );
}
```

- [ ] **Step 6: 型・lint・テスト・整形**

```bash
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run lint
docker compose exec frontend npm test
```

Expected：エラー 0・全件 PASS。prettier は導入されていないので、書式は既存ファイル（`post-detail.tsx` / `favorite-button.tsx`）に手で合わせる。

- [ ] **Step 7: 表示されることだけ確かめる**

公開済みの挑戦の id を 1 つ取り、ブラウザで開く。

```bash
docker compose exec -T backend bin/rails runner 'puts Attempt.kept.published.joins(:post).merge(Post.kept).order(:id).last&.id'
```

`http://localhost:3001/attempts/<id>` を開き、元画像・再現画像・描写文・いいね数が出ること、`/attempts/abc` が Next の 404 になることを確かめる（詳しい確認は Task 4）。公開済みの挑戦が無ければ、Task 4 Step 1 の手順で作る。

- [ ] **Step 8: コミット**

```bash
git add "frontend/src/app/attempts/[id]/page.tsx" frontend/src/components/attempts/attempt-detail.tsx frontend/src/components/attempts/attempt-comparison.tsx frontend/src/components/attempts/like-button.tsx frontend/src/components/attempts/copy-link-button.tsx
git commit -m "feat: 挑戦詳細・比較ビュー（/attempts/[id]）を足す

元画像と再現画像を同じ大きさの枠で並べ、描写文・いいね・リンクのコピー・
本人だけのダウンロードを置く。公開済み以外は比較ビューにしない。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: カードと結果パネルから比較ビューへ

**Files:**
- Modify: `frontend/src/components/attempts/attempt-card.tsx`
- Modify: `frontend/src/components/attempts/generation-panel.tsx`（`PublishedResult`）

**Interfaces:**
- Consumes: Task 1 の `attemptDetailHref(id: number): string`。Task 2 でルートが実在すること
- Produces: なし（見た目と導線だけ）

- [ ] **Step 1: カードをリンクにする**

`frontend/src/components/attempts/attempt-card.tsx` を次に置き換える。`PostCard` と同じ形（`group` とフォーカスリング、ホバーで枠線の色）にそろえる。

```tsx
import Link from "next/link";

import { attemptDetailHref } from "@/lib/attempts/attempt-detail-query";
import { cloudinaryUrlOrNull } from "@/lib/cloudinary";
import type { Attempt } from "@/types/api";

// 生成画像は 1024×1024 の正方形（4-3）。表彰台と一覧で同じ変換にすると、同じ挑戦が
// 両方に出ても Cloudinary の派生画像は 1 つで済む（7-3b 設計書「決定 4」）。
const IMAGE_WIDTH = 640;

/**
 * 挑戦カード。全体が比較ビューへのリンク（7-4 設計書「決定 3」）。
 *
 * いいねボタンは置かない。<a> の中に <button> は置けず、同じ挑戦が表彰台とみんなの挑戦の
 * 両方に出るので、置くなら状態の同期も要る。いいねは比較ビューで元画像と見比べてから押す。
 */
export function AttemptCard({ attempt }: { attempt: Attempt }) {
  const publicId = attempt.generated_image_public_id;
  const src =
    publicId === null ? null : cloudinaryUrlOrNull(publicId, { width: IMAGE_WIDTH, aspect: "1:1" });
  // alt に描写文を入れない。長文になりうるうえ、画像の中身ではなく「当てようとした言葉」のため。
  const alt = `${attempt.user.name} さんの再現画像`;

  return (
    // href は id（API が返す整数）から組み立てた値だけ。
    <Link
      href={attemptDetailHref(attempt.id)}
      className="group block rounded-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <article className="overflow-hidden rounded-card border border-line bg-surface transition-colors group-hover:border-accent">
        {/*
          next/image ではなく <img>（7-3a 設計書「決定 4」）。URL を組み立てられないときは
          同じ寸法の空枠を出す（1 件の不正なデータで一覧ごと落とさないため。PostCard と同じ）。
        */}
        {src === null ? (
          <div role="img" aria-label={alt} className="aspect-square w-full bg-line" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={alt}
            loading="lazy"
            className="aspect-square w-full bg-line object-cover"
          />
        )}
        <div className="p-4">
          {/*
            公開 UGC。{value} のまま置く（React が自動でエスケープする）。
            改行は whitespace-pre-wrap で反映する。<br> に置き換えると XSS になる（CLAUDE.md）。
            wrap-break-word は、空白を含まない長い英数字がカードの外へはみ出さないため。
          */}
          <p className="line-clamp-3 text-sm whitespace-pre-wrap wrap-break-word text-ink">
            {attempt.description}
          </p>
          <div className="mt-3 flex items-center justify-between gap-2 text-sm text-ink-muted">
            <span className="truncate">{attempt.user.name}</span>
            <span className="shrink-0">
              いいね <span className="font-medium text-ink">{attempt.likes_count}</span>
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}
```

- [ ] **Step 2: 結果パネルにリンクを足す**

`frontend/src/components/attempts/generation-panel.tsx`：

先頭の import に足す（既存の import の並びに合わせ、`next/link` を最初、`@/lib/attempts/attempt-detail-query` を `@/lib/attempts/attempt-messages` の前に置く）：

```tsx
import Link from "next/link";
```

```tsx
import { attemptDetailHref } from "@/lib/attempts/attempt-detail-query";
```

`PublishedResult` のボタン群（`<div className="flex flex-wrap gap-2">`）の、ダウンロードの `<a>` の**前**にリンクを足す：

```tsx
          <Link
            href={attemptDetailHref(attempt.id)}
            className={`${buttonClasses({ variant: "secondary", size: "sm" })} text-sm`}
          >
            お題と見比べる
          </Link>
```

`PublishedResult` の末尾のコメント行 `{/* 7-4：/attempts/[id] ができたら、ここに比較ビューへのリンクを足す。 */}` を削除する。

- [ ] **Step 3: 型・lint・テスト**

```bash
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run lint
docker compose exec frontend npm test
grep -rn "7-4" frontend/src
```

Expected：エラー 0・全件 PASS。`grep` の結果に「7-4 で足す」「7-4 まで」のような**宿題のコメント**が残っていない（設計書の決定を指す「7-4 設計書」は残ってよい）。

- [ ] **Step 4: 導線を確かめる**

お題詳細を開き、表彰台とみんなの挑戦のカードを押すと比較ビューへ移ること、Tab でカードにフォーカスするとアウトラインが出ること、ホバーで枠線の色が変わることを確かめる。

- [ ] **Step 5: コミット**

```bash
git add frontend/src/components/attempts/attempt-card.tsx frontend/src/components/attempts/generation-panel.tsx
git commit -m "feat: 挑戦カードと生成の結果パネルから比較ビューへ移れるようにする

カードにはいいねボタンを足さない（<a> の中に <button> は置けず、表彰台と
みんなの挑戦の間で状態の同期も要るため。設計書「決定 3」）。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 実物での確認・ドキュメント・レビュー・PR

**Files:**
- Modify: `docs/issues_backlog.md`

**Interfaces:**
- Consumes: Task 1〜3 の成果すべて
- Produces: PR（`Closes #25`）

- [ ] **Step 1: 確認の準備**

確認には**ユーザー 2 人**（A：自分の挑戦を持つ人、B：それにいいねする人）と、A の公開済みの挑戦が要る。データの描写文には必ず `[7-4確認]` を付ける（Step 3 で片づけるため）。

1. ユーザーと、お題が 1 件以上あることを確かめる。

```bash
docker compose exec -T backend bin/rails runner 'puts User.order(:id).limit(5).pluck(:id, :name).inspect; puts Post.kept.order(:id).last&.id'
```

2. A・B の 2 人を選び、A の公開済みの挑戦と下書きを作る（生成画像はお題画像を流用する。7-3c と同じ手順）。

```bash
docker compose exec -T backend bin/rails runner '
a = User.order(:id).first
post = Post.kept.order(:id).last
pub = a.attempts.create!(post: post, description: "[7-4確認] 公開済み\n2 行目\n" + "x" * 120, status: :published, generated_at: Time.current, generated_image_public_id: post.image_public_id)
draft = a.attempts.create!(post: post, description: "[7-4確認] 下書き", status: :draft)
puts "A=#{a.id} published=#{pub.id} draft=#{draft.id}"
'
```

3. ログインのトークンを作る（A・B それぞれ。`USER_ID` を差し替える）。DevTools → Application → Local Storage の `kotoe.auth.token` に入れてリロードすると、そのユーザーでログインした状態になる。

```bash
docker compose exec -T backend bin/rails runner 'u = User.find(USER_ID); print JWT.encode({ "sub" => u.id.to_s, "scp" => "user", "jti" => SecureRandom.uuid, "exp" => 1.hour.from_now.to_i, "iat" => Time.current.to_i }, ENV.fetch("JWT_SECRET_KEY"), "HS256")'
```

期限切れのトークンは `"exp" => 1.hour.ago.to_i, "iat" => 2.hours.ago.to_i` で作る。

- [ ] **Step 2: 手動確認（全部に ✓ が付くまで先に進まない）**

`http://localhost:3001` で確かめる。Rails のログは `docker compose logs -f backend` で見る。

1. [ ] **カードから**：お題詳細の表彰台とみんなの挑戦の両方で、カードを押すと `/attempts/<id>` へ移る。Tab でフォーカスするとアウトラインが出て、Enter で移れる
2. [ ] **結果パネルから**：お題詳細で生成（dummy）→ 公開パネルの「お題と見比べる」で比較ビューへ移る
3. [ ] **期限切れのトークン**：Local Storage を期限切れのトークンにして公開済みの挑戦を開く → **200 で表示される**（設計書「決定 1」の前提の実測。Network タブで `/api/attempts/<id>` が 200）。**401 なら止めて相談する**
4. [ ] **未ログイン**：Local Storage のトークンを消して開く → 「ログインしていいね」→ `/login?next=%2Fattempts%2F<id>` → ログイン後に同じ比較ビューへ戻る。ダウンロードは出ない
5. [ ] **他人の挑戦（B でログイン）**：いいね → 数が 1 増え、ボタンが塗られる（`aria-pressed="true"`）→ もう一度押すと戻る。**ダブルクリックしても 1 回分しか変わらない**（Rails のログで `POST` か `DELETE` が 1 本）。ダウンロードは出ない
6. [ ] **直接ロード**：B でいいねした状態で、比較ビューを**アドレスバーから直接開く・リロードする** → ボタンが押された状態で出る。A でも直接ロード → いいねボタンが無く、数とダウンロードが出る
7. [ ] **自分の挑戦（A でログイン）**：いいねボタンが無く「いいね N」だけ。「ダウンロード（PNG）」で画面が遷移せず `kotoe-attempt-<id>.png` が保存され、macOS のプレビューで開ける
8. [ ] **失効**：B で開いたまま Local Storage を期限切れのトークンに差し替え、いいね → 「セッションの有効期限が切れました…」のトースト → ボタンが「ログインしていいね」に変わる
9. [ ] **削除済み**：B で開いたまま、別ターミナルで `docker compose exec -T backend bin/rails runner 'Attempt.find(ID).discard!'` → いいね → 「この挑戦は削除されました」。確認後 `Attempt.find(ID).undiscard!` で戻す
10. [ ] **未公開**：A でログインし、Step 1 の下書きの id を開く → 「この挑戦はまだ公開されていません」と「お題に戻る」。B で同じ id を開く → 「挑戦が見つかりませんでした…」
11. [ ] **存在しない id**：`/attempts/99999999` → 「挑戦が見つかりませんでした…」と「お題を探す」。`/attempts/abc` → Next の 404
12. [ ] **通信エラー**：`docker compose pause backend` → リロード → 約 15 秒後にエラーと「再試行」→ `docker compose unpause backend` → 「再試行」で表示される
13. [ ] **リンクのコピー**：`http://localhost:3001/attempts/<id>?x=1#y` で開いて「リンクをコピー」→ 「リンクをコピーしました」→ 貼り付けると `http://localhost:3001/attempts/<id>`（`?x=1#y` が付かない）。LAN の URL（`http://<MacのIP>:3001`、0-6）で開いて押す → 失敗のトースト
14. [ ] **縦横比**：DevTools で元画像の `<img>` の `src` の `/upload/` の直後に `c_fill,ar_16:9,w_640/` を挟む → 枠の上下に帯が出て、画像が切れない。`c_fill,ar_3:4,w_480/` → 左右に帯。どちらも再現画像と枠の大きさが同じ（メモリの教訓：開発データは正方形だけ）
15. [ ] **スマホ幅（375px）**：元画像が上・再現画像が下に縦積み。横スクロールが出ない。操作の行が折り返す
16. [ ] **長い文字列**：描写文の改行が反映され、`x` が 120 個続く行が枠からはみ出さない（Step 1 で作ったデータ）。カードでは 3 行で切れる

- [ ] **Step 3: 片づける**

```bash
docker compose exec -T backend bin/rails runner '
attempts = Attempt.kept.where("description LIKE ?", "[7-4確認]%")
Like.where(attempt_id: attempts.select(:id)).delete_all
count = attempts.count
attempts.find_each(&:discard!)
puts "discarded: #{count}"
'
git status --short
```

Expected：`discarded:` の件数が出る。`git status` に意図しない変更が無い。Step 2 で生成した dummy の挑戦は残してよい（7-3c と同じく開発データとして使える）。Local Storage のトークンは自分のアカウントでログインし直して戻す。

- [ ] **Step 4: backlog を更新する**

`docs/issues_backlog.md` の 7-4 の節（`### 🟢 7-4. 挑戦詳細・比較ビュー（/attempts/[id]）` から、次の `### 🟢 7-5.` の直前まで）を次に置き換える。

```markdown
### 🟢 7-4. 挑戦詳細・比較ビュー（/attempts/[id]）
- 依存：7-1, 5-1
- GitHub：#25
- 設計書：`docs/superpowers/specs/2026-10-03-issue-7-4-attempt-detail-design.md`
- タスク：元画像 vs 再現画像の比較、いいね、（あれば）スコア、共有/通報導線。
- **7-4 で決めたこと（後続が乗る前提）**：
  - 比較ビューは `components/attempts/attempt-detail.tsx`。取得はクライアントで 1 本（`GET /api/attempts/:id`）。
    タイトルは固定の「挑戦」で、挑戦の中身を `<title>`・OGP に入れるのは 8-3
  - **公開済み以外は比較ビューにしない**。本人が未公開の挑戦を開いたら「まだ公開されていません」と
    お題へのリンクだけ。生成中・失敗の表示は 4-5・7-6 の範囲
  - **カード（`attempt-card.tsx`）は全体が比較ビューへのリンクで、いいねボタンは置かない**。`<a>` の中に
    `<button>` は置けず、表彰台とみんなの挑戦に同じ挑戦が出るので状態の同期も要るため。カードでの
    いいねは必要になったら別 issue に積む（7-7 のランキングでも同じカードを使う見込み）
  - 比較は**同じ幅の正方形枠を 2 つ**、**元画像 → 再現画像**の順（左右／スマホは上下）。元画像は
    `object-contain` で帯付き。スライダー型は見送り
  - いいねは `like-button.tsx`。楽観更新しない／自分の挑戦にはボタンを出さない（数だけ）／失敗は
    `toLikeErrorMessage()` でトースト
  - 共有は「リンクをコピー」だけ（SNS シェア・OGP は 8-3）。通報の導線は 5-3 が未実装のため置いていない
  - **ダウンロードは比較ビューで、本人の挑戦にだけ出す**（2026-09-30 決定）。カードには置かない
  - URL は `attemptDetailHref(id)`（`lib/attempts/attempt-detail-query.ts`）から作る
- **5-3 への申し送り**：通報 API ができたら、比較ビューの操作の行（いいね・リンクのコピーの並び）に
  通報の導線を足す
- 完了条件：比較ビューが表示され、いいねできる。
```

- [ ] **Step 5: 全体の検証**

```bash
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run lint
docker compose exec frontend npm test
git diff --stat main -- backend frontend/src/app/globals.css frontend/package.json
```

Expected：すべてエラー 0・全件 PASS。`git diff --stat` は何も出力しない（rspec / rubocop は backend に差分が無いので CI に任せる）。

**`npm run build` はコンテナ内で回さない。** dev サーバーと同じ `.next` に書き込むため。本番ビルドは PR の Vercel プレビューで確かめる（CI も型検査だけを回す方針。`.github/workflows/ci.yml`）。

- [ ] **Step 6: コミット**

```bash
git add docs/issues_backlog.md
git commit -m "docs: 7-4 の決定事項と、5-3 への申し送りを backlog に記録する

Refs #25

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: プッシュ前にコードレビューを通す**

プッシュ前に `/code-review high` を回す（superpowers の最終レビューとは別物なので、両方通す。メモリの規約）。指摘は `superpowers:receiving-code-review` に沿って検証してから直す。**直したコミットにも `/code-review high` を再度かける**（メモリの規約：レビュー修正も再レビュー）。

- [ ] **Step 8: プッシュして PR を出す**

この PR のマージで #25 の完了条件（比較ビューが表示され、いいねできる）を満たすので `Closes #25`。マージ後は **issue #25 が閉じたことを必ず確かめる**（7-3c では `Closes` が紐づかなかった）。

```bash
git push -u origin feat/attempt-detail
gh pr create --title "7-4. 挑戦詳細・比較ビュー（/attempts/[id]）" --body "$(cat <<'EOF'
## 概要

公開済みの挑戦を `/attempts/[id]` で元画像と並べて見せ、いいね・リンクのコピー・本人だけのダウンロードができるようにした。お題詳細のカードと、生成直後の結果パネルから移れる。バックエンドの変更は無い。

設計書：`docs/superpowers/specs/2026-10-03-issue-7-4-attempt-detail-design.md`

## 決めたこと

- 比較は同じ幅の正方形枠を 2 つ、元画像 → 再現画像の順。元画像は切り抜かず帯付き
- 公開済み以外は比較ビューにしない（本人には「まだ公開されていません」）
- カードはリンクにするだけで、いいねボタンは足さない（backlog の申し送りを変更。理由は設計書「決定 3」）
- いいねは楽観更新しない。自分の挑戦にはボタンを出さない
- 共有は「リンクをコピー」だけ。通報は 5-3 が未実装のため導線を置いていない
- ダウンロードは本人の挑戦にだけ出す

## 確認したこと

- Vitest：`parseAttemptId` / `attemptDetailHref` / `toLikeErrorMessage`
- 手動確認：計画書 Task 4 Step 2 の 16 項目（未ログイン・他人・自分・失効・削除済み・未公開・直接ロード・縦横比・スマホ幅など）

Closes #25

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 9: マージ後**

1. `gh issue view 25 --json state` が `CLOSED` であることを確かめる（閉じていなければ手で閉じる）
2. （PR の段階で）Vercel プレビューのビルドが成功していることを確かめておく
3. Vercel の本番デプロイが成功し、`/posts` と `/posts/<id>` が壊れていないこと、`https://kotoe.vercel.app/attempts/abc` が 404 になることを確かめる（本番にはお題が 0 件なので、比較ビューの実データでの確認は 7-5 以降）

---

## Self-Review（記入済み）

1. **設計書の網羅**：決定 1（Task 2 Step 4・5）、決定 2（Task 2 Step 4 の `AttemptNotPublished`）、決定 3（Task 3 Step 1）、決定 4（Task 2 Step 1）、決定 5（Task 1 Step 5〜8・Task 2 Step 2）、決定 6（Task 2 Step 3）、決定 7（Task 2 Step 4 の `downloadHref`）、決定 8（Task 1）、「状態」の表（Task 2 Step 4）、「構成」の表（ファイル構成）、「画面」（Task 2 Step 4）、「XSS」（Global Constraints）、「テスト」（Task 1）、「手動確認」1〜16（Task 4 Step 2。対応は 1→1・2→2・3→3・4→4・5→5・6→6・7→7・8→8・9→9・10→10・11→11・12→12・13→13・14→14・15→15・16→16）、「backlog への反映」（Task 4 Step 4）
2. **プレースホルダー**：無し。`USER_ID` / `ID` / `<id>` は手順の中で値を取る箇所
3. **型の整合**：`attemptDetailHref(id: number)` は Task 1・2・3 で同じ。`LikeButton` の `onChange: (attempt: Attempt) => void` と `AttemptDetail` の呼び出しが一致。`LikeResponse` は Task 1 で定義し Task 2 で使う
4. **Review Focus**：5 項目それぞれを Task 4 の手動確認に割り当てた。単体テストで守れるもの（文言の振り分け）は Task 1 にある

## 設計書との差分

- いいねの「その他」の失敗は `toRequestErrorMessage` ではなく `fallbackErrorMessage` にした（4xx でもエラーコードを出せる。7-3c の規約）。設計書も計画書と同じコミットで直した
