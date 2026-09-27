# お題詳細の閲覧（/posts/[id]） 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一覧からお題を開き、元画像・ベスト再現（表彰台）・みんなの挑戦（再現度順／新着順・ページ送り）を見られるようにする。ログイン中はお気に入りを付け外しできる。

**Architecture:** `app/posts/[id]/page.tsx` はサーバーコンポーネントのまま `params.id` と `searchParams` を正規化して渡すだけにし、取得はクライアントの `PostDetail` が `GET /api/posts/:id?sort&page` を 1 本だけ呼ぶ（7-3a と同じ）。結果は「どのリクエストの結果か」を表す key 付きで持ち、さらに**最後に成功した応答をお題 id と一緒に保持**して、同じお題の再取得中はヒーローと表彰台を出し続け、みんなの挑戦の部分だけを読み込み中にする（7-3c の描写フォームがアンマウントされない前提）。ページ送りと並び替えの部品は URL の組み立てを呼び出し側に出して一覧と共有する。

**Tech Stack:** Next.js 16.2.10（App Router）／ React 19.2.4 ／ TypeScript ／ TailwindCSS 4 ／ Vitest（jsdom）／ Docker Compose。**新しい依存は追加しない。**

**Spec:** `docs/superpowers/specs/2026-09-27-issue-7-3b-post-detail-design.md`

**Issue:** GitHub #115（`docs/issues_backlog.md` 7-3b）。後半は #120（7-3c）

**Branch:** `feat/post-detail`（作成済み。設計書のコミット `2b31736` が載っている）

## Global Constraints

このプロジェクト全体の規約。**全タスクの要件に暗黙に含まれる。**

- **依存パッケージを追加しない。** `frontend/package.json` は変更しない。
- **`backend/` のコードは 1 行も変更しない。** API は 3-2 / 5-2 / 6-1 のものをそのまま使う。
- **`frontend/src/app/globals.css` を変更しない。** 過去 4 回の Turbopack stale はすべてこのファイルの変更で起きている（`frontend/AGENTS.md`）。色は既存トークン（`bg-canvas` / `bg-surface` / `text-ink` / `text-ink-muted` / `border-line` / `bg-line` / `bg-accent` / `text-accent` / `border-accent` / `text-danger` / `rounded-card`）だけを使い、`zinc-500` のような生のパレットと `dark:` を書かない。
- **`useSearchParams()` を使わない。** Vercel の本番ビルドだけ落ちる（7-2 の規約）。
- **`dangerouslySetInnerHTML` を使わない**（eslint `react/no-danger` が error）。`title` / `user.name` / `description` は `{value}` で出すだけ。**描写文の改行は `whitespace-pre-wrap`**（`replace(/\n/g, "<br>")` は XSS）。
- **`<img src>` に入れてよいのは `cloudinaryUrl()` / `cloudinaryUrlOrNull()` の戻り値だけ。** `next/image` は使わない（7-3a 決定 4）。
- **存在しないルートへリンクを置かない。** `/attempts/[id]`（7-4）・`/posts/new`（7-5）・`/mypage`（7-6）・`/rankings`（7-7）へのリンクは作らない。main は Vercel の本番を追跡している。
- **文字列はダブルクォート。** コメントは日本語で、「何をしているか」ではなく**「なぜそうしたか」**を書く（既存ファイルの書き方に合わせる）。
- **`any` を使わない。** API レスポンスには型を付ける。
- **テストは `frontend/test/` に置き、`src/` の構造を写す。** コンポーネントのテストは書かない（CLAUDE.md のテスト方針。E2E は 8-1）。
- **env ファイルの中身を表示しない。** 確認はキー名だけ。
- コマンドはリポジトリのルートで実行し、`npm` / `npx` は `docker compose exec frontend <コマンド>` でコンテナ内で動かす。
- コミットメッセージの末尾は `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` で止める（セッションリンクを書かない）。
- `git checkout` を使わない。ブランチの切り替えもしない（`feat/post-detail` 上だけで作業する）。

## Review Focus

どのタスクの単体テストも直接は叩かないが、使う人が最初に踏みそうな入力・条件。各行の確認は、そのコードを持つタスクに入れてある。

1. **並び替え・ページ送りを押したとき、ヒーローと表彰台がスケルトンに戻らない**こと（7-3c のフォームがここに乗る。戻ると書きかけの文面が消える） → Task 6 の `current` の導出と、Task 7 の手動確認（Slow 4G で並び替え）
2. **並び替えを素早く連打しても、古い応答が新しい結果を上書きしない**こと → Task 6 のキー付き結果（`result.key === requestKey`）と、Task 7 の手動確認
3. **お気に入りを押した直後にトークンが失効していた（401）とき、無言にならない**こと。トーストが出てボタンがログイン導線に変わる → Task 5 の `toFavoriteErrorMessage` と、Task 7 の手動確認（期限切れトークンへの差し替え）
4. **縦長の元画像が画面を占有しすぎず、切り抜かれもしない**こと → Task 1 のテスト（`c_limit`）と Task 5 の `max-h-[70vh] object-contain`、Task 7 の手動確認
5. **改行を含む描写文・空白の無い長い英数字の描写文がカードを壊さない**こと → Task 4 の `whitespace-pre-wrap line-clamp-3 wrap-break-word`、Task 7 の手動確認

## ファイル構成

| ファイル | 責務 | タスク |
|---|---|---|
| `frontend/src/lib/cloudinary.ts` | `aspect` を省略可能にし、省略時は `c_limit`（切り抜かない） | 1 |
| `frontend/test/lib/cloudinary.test.ts` | 上のテストを追加 | 1 |
| `frontend/src/lib/search-params.ts` | **新規**。`RawSearchParams`・`firstParam()`・`parsePositiveInt()`（一覧と詳細で共有） | 2 |
| `frontend/test/lib/search-params.test.ts` | **新規** | 2 |
| `frontend/src/lib/posts/posts-query.ts` | 上を使うように置き換え（振る舞いは変えない） | 2 |
| `frontend/src/app/posts/page.tsx` | `RawSearchParams` の import 元を変える | 2 |
| `frontend/src/lib/posts/post-detail-query.ts` | **新規**。`parsePostId` / `parsePostDetailQuery` / `postDetailHref` / `postDetailApiPath` | 2 |
| `frontend/test/lib/posts/post-detail-query.test.ts` | **新規** | 2 |
| `frontend/src/components/ui/pagination.tsx` | **`components/posts/` から移動**し、`hrefFor` を受け取る形にする | 3 |
| `frontend/src/components/ui/sort-toggle.tsx` | **新規**。汎用の並び替えトグル | 3 |
| `frontend/src/components/posts/post-sort-toggle.tsx` | **削除** | 3 |
| `frontend/src/components/posts/post-list.tsx` | 上の 2 部品を使うように変更 | 3 |
| `frontend/src/components/posts/post-card.tsx` | `<Link>` で包む | 3 |
| `frontend/src/types/api.ts` | `AttemptStatus` / `Attempt` / `PostDetailResponse` / `FavoriteResponse` を追加 | 4 |
| `frontend/src/components/attempts/attempt-card.tsx` | **新規** | 4 |
| `frontend/src/components/attempts/best-attempts.tsx` | **新規**。表彰台 | 4 |
| `frontend/src/components/attempts/attempt-list.tsx` | **新規**。みんなの挑戦 | 4 |
| `frontend/src/lib/auth/error-messages.ts` | `SESSION_EXPIRED_MESSAGE` を export | 5 |
| `frontend/src/components/posts/favorite-button.tsx` | **新規** | 5 |
| `frontend/src/components/posts/post-hero.tsx` | **新規** | 5 |
| `frontend/src/components/posts/post-detail.tsx` | **新規**。取得と出し分け | 6 |
| `frontend/src/app/posts/[id]/page.tsx` | **新規** | 6 |
| `frontend/src/components/dev/health-panel.tsx` | トースト確認用ボタンを削除 | 6 |
| `docs/issues_backlog.md` | 7-3b の書き換え・7-3c の新設・後続への申し送り | 7 |

---

### Task 1: `cloudinaryUrl()` に「切り抜かない」指定を足す

**Files:**
- Modify: `frontend/src/lib/cloudinary.ts`
- Test: `frontend/test/lib/cloudinary.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `cloudinaryUrl(publicId: string, options: CloudinaryOptions): string`、`cloudinaryUrlOrNull(publicId: string, options: CloudinaryOptions): string | null`、`export type CloudinaryOptions = { width: number; aspect?: CloudinaryAspect }`。`aspect` を省くと `c_limit,w_<幅>,f_auto,q_auto`

- [ ] **Step 1: 失敗するテストを書く**

`frontend/test/lib/cloudinary.test.ts` の `describe("cloudinaryUrl", ...)` の中、「縦横比と幅を変換に反映する」の直後に足す：

```ts
  it("aspect を省くと切り抜かず、幅の上限だけを付ける（c_limit）", () => {
    // お題の元画像は描写の対象そのもの。4:3 に切り抜くと描写すべき部分が見えなくなる。
    expect(cloudinaryUrl("a/b", { width: 1280 })).toBe(
      "https://res.cloudinary.com/demo/image/upload/c_limit,w_1280,f_auto,q_auto/a/b",
    );
  });
```

`describe("cloudinaryUrlOrNull", ...)` の中、最初の `it` の直後に足す：

```ts
  it("aspect を省いた指定もそのまま cloudinaryUrl に渡す", () => {
    expect(cloudinaryUrlOrNull("a/b", { width: 1280 })).toBe(cloudinaryUrl("a/b", { width: 1280 }));
  });
```

- [ ] **Step 2: 失敗を確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/cloudinary.test.ts`
Expected: FAIL。`c_fill,ar_undefined,w_1280,...` のように `ar_undefined` が入った URL と比較して落ちる（型エラーは vitest では止まらない）

- [ ] **Step 3: 実装する**

`frontend/src/lib/cloudinary.ts`：

1. `export type CloudinaryAspect = "4:3" | "1:1";` の直後に足す：

```ts
/**
 * aspect を省くと切り抜かない（c_limit：幅の上限だけ。縦横比は元のまま、元より大きくはしない）。
 * お題の元画像は描写の対象そのものなので、詳細のヒーローでは切り抜かない（7-3b 設計書「決定 4」）。
 * 一覧のサムネイルや生成画像のようにグリッドを揃えたい場所だけ aspect を渡す。
 */
export type CloudinaryOptions = { width: number; aspect?: CloudinaryAspect };
```

2. `cloudinaryUrl` のシグネチャを置き換える：

```ts
export function cloudinaryUrl(publicId: string, { width, aspect }: CloudinaryOptions): string {
```

3. 変換文字列の組み立て（`const transformation = ...` の行とその直前のコメント）を置き換える：

```ts
  // f_auto で配信形式（AVIF / WebP など）をブラウザに合わせ、q_auto で画質を自動にする。
  const crop = aspect === undefined ? "c_limit" : `c_fill,ar_${aspect}`;
  const transformation = `${crop},w_${width},f_auto,q_auto`;
```

4. `cloudinaryUrlOrNull` の `options` の型を `CloudinaryOptions` にする：

```ts
export function cloudinaryUrlOrNull(publicId: string, options: CloudinaryOptions): string | null {
```

- [ ] **Step 4: 通ることを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/cloudinary.test.ts && docker compose exec frontend npx tsc --noEmit`
Expected: 全件 PASS、型エラー 0（既存の呼び出し `{ width: THUMBNAIL_WIDTH, aspect: "4:3" }` はそのまま通る）

- [ ] **Step 5: コミット**

```bash
git add frontend/src/lib/cloudinary.ts frontend/test/lib/cloudinary.test.ts
git commit -m "feat: cloudinaryUrl で aspect を省くと切り抜かないようにする

お題詳細のヒーローは元画像を切り抜かずに見せる必要があるため。

Refs #115

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: URL の正規化（`search-params.ts` の切り出しと `post-detail-query.ts`）

**Files:**
- Create: `frontend/src/lib/search-params.ts`
- Create: `frontend/test/lib/search-params.test.ts`
- Modify: `frontend/src/lib/posts/posts-query.ts`
- Modify: `frontend/src/app/posts/page.tsx`（import 1 行）
- Create: `frontend/src/lib/posts/post-detail-query.ts`
- Create: `frontend/test/lib/posts/post-detail-query.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `search-params.ts`：`export type RawSearchParams = Record<string, string | string[] | undefined>`、`firstParam(value: string | string[] | undefined): string | undefined`、`parsePositiveInt(raw: string | undefined): number | null`
  - `post-detail-query.ts`：`export type AttemptsSort = "recent" | "likes"`、`export type PostDetailQuery = { sort: AttemptsSort; page: number }`、`parsePostId(raw: string): number | null`、`parsePostDetailQuery(params: RawSearchParams): PostDetailQuery`、`postDetailHref(id: number, query?: Partial<PostDetailQuery>): string`、`postDetailApiPath(id: number, query: PostDetailQuery): string`

- [ ] **Step 1: `search-params` の失敗するテストを書く**

`frontend/test/lib/search-params.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import { firstParam, parsePositiveInt } from "@/lib/search-params";

describe("firstParam", () => {
  it("文字列はそのまま返す", () => {
    expect(firstParam("a")).toBe("a");
  });

  it("?k=a&k=b のように配列で来たら先頭を返す", () => {
    expect(firstParam(["a", "b"])).toBe("a");
  });

  it("未指定なら undefined", () => {
    expect(firstParam(undefined)).toBeUndefined();
  });
});

describe("parsePositiveInt", () => {
  it.each([
    ["1", 1],
    ["3", 3],
    ["007", 7],
  ])("%j は %d", (raw, expected) => {
    expect(parsePositiveInt(raw)).toBe(expected);
  });

  // Number() や parseInt() に任せると "1e3" は 1000、"2.5" は 2 になり、書いていない値へ黙って飛ぶ。
  it.each(["0", "-1", "abc", "2.5", "", "1e3", " 2", "0x10", "+1"])("%j は null", (raw) => {
    expect(parsePositiveInt(raw)).toBeNull();
  });

  it("未指定なら null", () => {
    expect(parsePositiveInt(undefined)).toBeNull();
  });

  it("安全な整数を超える値は null（精度が落ちて別の値を指すため）", () => {
    expect(parsePositiveInt("99999999999999999999")).toBeNull();
  });
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/search-params.test.ts`
Expected: FAIL（`@/lib/search-params` が解決できない）

- [ ] **Step 3: `search-params.ts` を作る**

`frontend/src/lib/search-params.ts`：

```ts
/**
 * URL（searchParams と動的セグメント）から来る値の共通の読み方。
 *
 * お題一覧（posts-query.ts）とお題詳細（post-detail-query.ts）で同じ規則を使う。
 * 片方にだけ書くと、ページ番号の受け付け方を片方だけ直したときに
 * 「一覧では 1 ページ目に丸まる値が、詳細では別のページを指す」ずれが起きる。
 */

/** Next の page.tsx が受け取る searchParams の値の形。 */
export type RawSearchParams = Record<string, string | string[] | undefined>;

/** ?sort=a&sort=b のように同じキーが重なると配列で来る。先頭を採る。 */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * 正の整数の文字列だけを数値にする。それ以外は null（呼び出し側が既定値に倒す）。
 *
 * Number() や parseInt() に任せない。Number("1e3") は 1000、parseInt("2.5") は 2 に
 * なり、書いていないページやお題へ黙って飛ぶ。数字だけの文字列に限る。
 * 安全な整数を超えると精度が落ちて別の値になるので、それも null にする。
 * 上限（ページの MAX_PAGE など）はサーバーが丸めるので、ここでは見ない。
 */
export function parsePositiveInt(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d+$/.test(raw)) return null;

  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : null;
}
```

- [ ] **Step 4: `posts-query.ts` を置き換える（振る舞いは変えない）**

`frontend/src/lib/posts/posts-query.ts`：

1. 先頭のコメントブロックの直後に import を足す：

```ts
import { firstParam, parsePositiveInt, type RawSearchParams } from "@/lib/search-params";
```

2. 次の 2 つを**削除**する：`export type RawSearchParams = ...`（とその 1 行コメント）、`function first(...)`（とその 1 行コメント）。

3. `parsePostsQuery` の本体を置き換える：

```ts
export function parsePostsQuery(params: RawSearchParams): PostsQuery {
  // String.prototype.trim は全角空白（U+3000）も落とす。
  const q = (firstParam(params.q) ?? "").trim();

  // API も popular 以外はすべて新着順に扱う（Post.listing）。ここで同じ丸め方を
  // しておくと、並び替えトグルの「現在地」表示が API の実際の並びと一致する。
  const sort: PostsSort = firstParam(params.sort) === "popular" ? "popular" : "recent";

  // 受け付ける形は search-params.ts に集約してある（詳細画面と同じ規則）。
  const page = parsePositiveInt(firstParam(params.page)) ?? DEFAULT_QUERY.page;

  return { q, sort, page };
}
```

4. `frontend/src/app/posts/page.tsx` の import を置き換える：

```ts
import { parsePostsQuery } from "@/lib/posts/posts-query";
import type { RawSearchParams } from "@/lib/search-params";
```

- [ ] **Step 5: 回帰を確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/search-params.test.ts test/lib/posts/posts-query.test.ts && docker compose exec frontend npx tsc --noEmit`
Expected: 全件 PASS（`posts-query.test.ts` は**1 行も変えずに**通ること）、型エラー 0

- [ ] **Step 6: `post-detail-query` の失敗するテストを書く**

`frontend/test/lib/posts/post-detail-query.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import {
  parsePostDetailQuery,
  parsePostId,
  postDetailApiPath,
  postDetailHref,
  type PostDetailQuery,
} from "@/lib/posts/post-detail-query";

/** 組み立てた URL を、Next が searchParams として渡す形（値は文字列）に戻す。 */
function paramsOf(href: string): Record<string, string> {
  return Object.fromEntries(new URL(href, "http://localhost").searchParams);
}

describe("parsePostId", () => {
  it.each([
    ["1", 1],
    ["9", 9],
    ["007", 7],
  ])("%j は %d", (raw, expected) => {
    expect(parsePostId(raw)).toBe(expected);
  });

  it.each(["0", "-1", "1.5", "abc", "", "1e3", "99999999999999999999"])(
    "%j は null（page.tsx が API を呼ばずに notFound() にする）",
    (raw) => {
      expect(parsePostId(raw)).toBeNull();
    },
  );
});

describe("parsePostDetailQuery", () => {
  it("何も無ければ既定値（新着順・1 ページ目）", () => {
    expect(parsePostDetailQuery({})).toEqual({ sort: "recent", page: 1 });
  });

  it("likes だけを再現度順として受け付ける", () => {
    expect(parsePostDetailQuery({ sort: "likes" }).sort).toBe("likes");
  });

  // popular はお題一覧の値。詳細の API は likes 以外をすべて新着順にする（Attempt.listing_for）。
  it.each(["popular", "recent", "LIKES", "", " likes"])("%j は新着順に丸める", (sort) => {
    expect(parsePostDetailQuery({ sort }).sort).toBe("recent");
  });

  it("配列で来たら先頭で判定する", () => {
    expect(parsePostDetailQuery({ sort: ["likes", "recent"], page: ["2", "5"] })).toEqual({
      sort: "likes",
      page: 2,
    });
  });

  it("正の整数でない page は 1 ページ目に丸める", () => {
    expect(parsePostDetailQuery({ page: "abc" }).page).toBe(1);
    expect(parsePostDetailQuery({ page: "3" }).page).toBe(3);
  });
});

describe("postDetailHref", () => {
  it("既定値のパラメータは省く", () => {
    expect(postDetailHref(9)).toBe("/posts/9");
    expect(postDetailHref(9, { sort: "recent", page: 1 })).toBe("/posts/9");
  });

  it("既定値以外だけを載せる", () => {
    expect(postDetailHref(9, { sort: "likes" })).toBe("/posts/9?sort=likes");
    expect(postDetailHref(9, { page: 2 })).toBe("/posts/9?page=2");
  });

  it.each<PostDetailQuery>([
    { sort: "recent", page: 1 },
    { sort: "likes", page: 1 },
    { sort: "recent", page: 3 },
    { sort: "likes", page: 12 },
  ])("組み立てた URL を読み直すと同じ条件に戻る（%o）", (query) => {
    expect(parsePostDetailQuery(paramsOf(postDetailHref(9, query)))).toEqual(query);
  });
});

describe("postDetailApiPath", () => {
  it("再現度順は sort=likes を API に渡す", () => {
    expect(paramsOf(postDetailApiPath(9, { sort: "likes", page: 1 }))).toEqual({ sort: "likes" });
  });

  it("新着順・1 ページ目ならクエリを付けない", () => {
    expect(postDetailApiPath(9, { sort: "recent", page: 1 })).toBe("/api/posts/9");
  });

  it("画面の URL と同じ条件を API に渡す", () => {
    const query: PostDetailQuery = { sort: "likes", page: 2 };
    expect(paramsOf(postDetailApiPath(9, query))).toEqual(paramsOf(postDetailHref(9, query)));
  });
});
```

- [ ] **Step 7: 失敗を確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/posts/post-detail-query.test.ts`
Expected: FAIL（`@/lib/posts/post-detail-query` が解決できない）

- [ ] **Step 8: `post-detail-query.ts` を作る**

`frontend/src/lib/posts/post-detail-query.ts`：

```ts
/**
 * お題詳細の URL（/posts/[id]?sort=&page=）と API のパスの相互変換。
 *
 * posts-query.ts と同じく、画面の URL と API のパスを同じ関数から作る。
 * 別々に組み立てると「画面は再現度順と表示しているのに新着順が返る」ずれが起きる。
 *
 * 並び替えの値は一覧（popular）と違い likes。API（Attempt.listing_for）と
 * docs/screen_and_api_design.md がそう定義している。
 */

import { firstParam, parsePositiveInt, type RawSearchParams } from "@/lib/search-params";

export type AttemptsSort = "recent" | "likes";

export type PostDetailQuery = { sort: AttemptsSort; page: number };

const DEFAULT_QUERY: PostDetailQuery = { sort: "recent", page: 1 };

/**
 * URL の [id]。正の安全な整数の文字列だけを受け付ける。
 * それ以外は null を返し、page.tsx が API を呼ばずに notFound() にする。
 * "007" は 7 として受け付ける（API も 7 として扱うので、正規化の URL へは飛ばさない）。
 */
export function parsePostId(raw: string): number | null {
  return parsePositiveInt(raw);
}

/** URL から来る任意の値を正規化する。どんな入力でも例外を投げない。 */
export function parsePostDetailQuery(params: RawSearchParams): PostDetailQuery {
  const sort: AttemptsSort = firstParam(params.sort) === "likes" ? "likes" : "recent";
  const page = parsePositiveInt(firstParam(params.page)) ?? DEFAULT_QUERY.page;

  return { sort, page };
}

/** 既定値のパラメータを省いたクエリ文字列。/posts/9?page=1&sort=recent ではなく /posts/9 にする。 */
function toSearch({ sort, page }: PostDetailQuery): string {
  const params = new URLSearchParams();
  if (sort !== DEFAULT_QUERY.sort) params.set("sort", sort);
  if (page !== DEFAULT_QUERY.page) params.set("page", String(page));

  const search = params.toString();
  return search ? `?${search}` : "";
}

/** 画面の URL。省いた項目は既定値（新着順・1 ページ目）になる。 */
export function postDetailHref(id: number, query: Partial<PostDetailQuery> = {}): string {
  return `/posts/${id}${toSearch({ ...DEFAULT_QUERY, ...query })}`;
}

/** API のパス。画面の URL と同じ規則で組み立てる。 */
export function postDetailApiPath(id: number, query: PostDetailQuery): string {
  return `/api/posts/${id}${toSearch(query)}`;
}
```

- [ ] **Step 9: 通ることを確かめる**

Run: `docker compose exec frontend npm test && docker compose exec frontend npx tsc --noEmit && docker compose exec frontend npm run lint`
Expected: 全件 PASS、型エラー 0、lint エラー 0

- [ ] **Step 10: コミット**

```bash
git add frontend/src/lib/search-params.ts frontend/test/lib/search-params.test.ts \
  frontend/src/lib/posts/posts-query.ts frontend/src/app/posts/page.tsx \
  frontend/src/lib/posts/post-detail-query.ts frontend/test/lib/posts/post-detail-query.test.ts
git commit -m "feat: お題詳細の URL を正規化する関数を足す

ページ番号の受け付け方を search-params.ts に切り出し、一覧と詳細で共有する。

Refs #115

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: ページ送りと並び替えを共有部品にし、一覧のカードをリンクにする

**Files:**
- Create: `frontend/src/components/ui/pagination.tsx`（`components/posts/pagination.tsx` を `git mv` して書き換え）
- Create: `frontend/src/components/ui/sort-toggle.tsx`
- Delete: `frontend/src/components/posts/post-sort-toggle.tsx`
- Modify: `frontend/src/components/posts/post-list.tsx`
- Modify: `frontend/src/components/posts/post-card.tsx`

**Interfaces:**
- Consumes: `postDetailHref(id)`（Task 2）、`postsHref()`（既存）
- Produces:
  - `Pagination({ page, totalPages, hrefFor }: { page: number; totalPages: number; hrefFor: (page: number) => string })`
  - `export type SortOption = { label: string; href: string; active: boolean }`、`SortToggle({ options }: { options: SortOption[] })`

このタスクは見た目と挙動を変えない（リンク化を除く）。Vitest の対象は無い。回帰は Task 7 の手動確認（一覧の並び替え・ページ送り）で見る。

- [ ] **Step 1: `Pagination` を移動して一般化する**

```bash
git mv frontend/src/components/posts/pagination.tsx frontend/src/components/ui/pagination.tsx
```

`frontend/src/components/ui/pagination.tsx` を次の内容にする（見た目・コメントの趣旨は元のまま、URL の組み立てだけを外に出す）：

```tsx
import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";

/**
 * 「前へ｜2 / 5｜次へ」。番号の列は作らない（7-3a 設計書「決定 5」）。
 *
 * URL の組み立ては呼び出し側に任せる（hrefFor）。お題一覧とお題詳細で
 * クエリの形が違う（q の有無・sort の値）ため。
 *
 * 端では <Link> を出さず <span aria-disabled> にする。<Link> には disabled が無く、
 * 見た目だけ薄くしても押せてしまうため。範囲外のページ（?page=99）では
 * 呼び出し側がこの部品を描画しない。totalPages は 0 件のとき 0 で来るが、
 * 下の条件でそのまま何も描かない。
 */
export function Pagination({
  page,
  totalPages,
  hrefFor,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
}) {
  if (totalPages <= 1) return null;

  const linkClass = `${buttonClasses({ variant: "secondary", size: "sm" })} text-sm`;
  const disabledClass = `${linkClass} pointer-events-none opacity-60`;

  return (
    <nav aria-label="ページ送り" className="flex items-center justify-center gap-4">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={linkClass}>
          前へ
        </Link>
      ) : (
        <span aria-disabled="true" className={disabledClass}>
          前へ
        </span>
      )}

      {/* 「2 / 5」は記号だけだと読み上げで意味が伝わらないので、文で名前を付ける。 */}
      <span className="text-sm text-ink-muted" aria-label={`${totalPages} ページ中 ${page} ページ目`}>
        {page} / {totalPages}
      </span>

      {page < totalPages ? (
        <Link href={hrefFor(page + 1)} className={linkClass}>
          次へ
        </Link>
      ) : (
        <span aria-disabled="true" className={disabledClass}>
          次へ
        </span>
      )}
    </nav>
  );
}
```

実装前に `git show HEAD:frontend/src/components/posts/pagination.tsx` で元のファイルを読み、上に無いクラスや属性が元にあれば**残す**こと（見た目を変えないタスクのため）。

- [ ] **Step 2: `SortToggle` を作り、`PostSortToggle` を削除する**

`frontend/src/components/ui/sort-toggle.tsx`：

```tsx
import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";

export type SortOption = { label: string; href: string; active: boolean };

/**
 * 並び替えは <Link>。状態を URL にだけ持たせるので、リロードや戻るボタンで
 * 並びが保たれる。href は呼び出し側が組み立てる（お題一覧とお題詳細で
 * クエリの形が違うため）。切り替えたら 1 ページ目に戻すこと
 * （別の並びの 3 ページ目は、元の 3 ページ目とは無関係な内容になるため）。
 */
export function SortToggle({ options }: { options: SortOption[] }) {
  return (
    <nav aria-label="並び替え" className="flex gap-2">
      {options.map(({ label, href, active }) => (
        <Link
          key={href}
          href={href}
          // "page" ではなく "true"。並び順は「今いるページ」ではなく、選ばれている選択肢のため。
          aria-current={active ? "true" : undefined}
          className={`${buttonClasses({ variant: active ? "primary" : "secondary", size: "sm" })} text-sm`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
```

```bash
git rm frontend/src/components/posts/post-sort-toggle.tsx
```

- [ ] **Step 3: `PostList` を新しい部品に差し替える**

`frontend/src/components/posts/post-list.tsx`：

1. import を置き換える。`Pagination` と `PostSortToggle` の 2 行を消し、次を足す：

```ts
import { Pagination } from "@/components/ui/pagination";
import { SortToggle } from "@/components/ui/sort-toggle";
```

`posts-query` の import に `type PostsSort` を足す：

```ts
import { postsApiPath, postsHref, type PostsQuery, type PostsSort } from "@/lib/posts/posts-query";
```

2. `const SKELETON_COUNT = 12; ...` の直後に足す：

```ts
const SORT_OPTIONS: { sort: PostsSort; label: string }[] = [
  { sort: "recent", label: "新着順" },
  { sort: "popular", label: "人気順" },
];
```

3. `<PostSortToggle query={query} />` を置き換える：

```tsx
        {/* 並び替えたら 1 ページ目に戻す（page を渡さない）。検索語は引き継ぐ。 */}
        <SortToggle
          options={SORT_OPTIONS.map(({ sort, label }) => ({
            label,
            href: postsHref({ q: query.q, sort }),
            active: query.sort === sort,
          }))}
        />
```

4. `<Pagination query={query} totalPages={meta.total_pages} />` を置き換える：

```tsx
      <Pagination
        page={query.page}
        totalPages={meta.total_pages}
        hrefFor={(page) => postsHref({ ...query, page })}
      />
```

- [ ] **Step 4: `PostCard` をリンクにする**

`frontend/src/components/posts/post-card.tsx`：

1. import を足す：

```ts
import Link from "next/link";

import { postDetailHref } from "@/lib/posts/post-detail-query";
```

2. `// 7-3b：この <article> を ...` の 2 行コメントを削除し、`return (` 以下を `<Link>` で包む。`<article>` の開始タグと終了タグを次の形にする（中身は変えない）：

```tsx
  return (
    // カード全体を押せるようにする。href は id（API が返す整数）から組み立てた値だけ。
    <Link
      href={postDetailHref(post.id)}
      className="group block rounded-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <article className="overflow-hidden rounded-card border border-line bg-surface transition-colors group-hover:border-accent">
        {/* …既存の中身そのまま… */}
      </article>
    </Link>
  );
```

- [ ] **Step 5: 型・lint・テストを通す**

Run: `docker compose exec frontend npx tsc --noEmit && docker compose exec frontend npm run lint && docker compose exec frontend npm test`
Expected: エラー 0・全件 PASS。`grep -rn "post-sort-toggle\|components/posts/pagination" frontend/src` が何も出さない

- [ ] **Step 6: 一覧が壊れていないことを目で確かめる**

`http://localhost:3001/posts` を開き、並び替え・ページ送り（お題が 13 件未満なら並び替えだけ）が以前どおり動き、カードを押すと `/posts/<id>` に遷移する（この時点では 404 でよい。ルートは Task 6 で作る）。

- [ ] **Step 7: コミット**

```bash
git add -A frontend/src/components
git commit -m "refactor: ページ送りと並び替えを共有部品にし、一覧のカードを詳細へのリンクにする

URL の組み立てを呼び出し側に出し、お題詳細でも使えるようにした。見た目は変えていない。

Refs #115

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 挑戦の型・カード・表彰台・みんなの挑戦

**Files:**
- Modify: `frontend/src/types/api.ts`
- Create: `frontend/src/components/attempts/attempt-card.tsx`
- Create: `frontend/src/components/attempts/best-attempts.tsx`
- Create: `frontend/src/components/attempts/attempt-list.tsx`

**Interfaces:**
- Consumes: `cloudinaryUrlOrNull`（Task 1）、`postDetailHref` / `PostDetailQuery` / `AttemptsSort`（Task 2）、`Pagination` / `SortToggle`（Task 3）
- Produces:
  - 型：`AttemptStatus`、`Attempt`、`PostDetailResponse`、`FavoriteResponse`
  - `AttemptCard({ attempt }: { attempt: Attempt })`
  - `BestAttempts({ attempts }: { attempts: Attempt[] })`（`likes_count > 0` が 0 件なら `null`）
  - `export type AttemptListState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; attempts: Attempt[]; meta: PaginationMeta }`
  - `AttemptList({ postId, query, state, onRetry }: { postId: number; query: PostDetailQuery; state: AttemptListState; onRetry: () => void })`

- [ ] **Step 1: 型を足す**

`frontend/src/types/api.ts` の末尾に足す：

```ts
/** 挑戦の状態。published と failed が終端（4-2）。 */
export type AttemptStatus = "draft" | "generating" | "published" | "failed";

/**
 * 挑戦 1 件（AttemptSerializer）。お題詳細の一覧・表彰台と、挑戦 API で共通。
 * お題詳細に出るのは published だけ（Attempt.listing_for）。
 */
export type Attempt = {
  id: number;
  description: string;
  /** published 以外は null。表示には必ず cloudinaryUrl() を通す */
  generated_image_public_id: string | null;
  status: AttemptStatus;
  /** failed のときだけ値が入る。7-3c でリテラル型に絞る */
  failure_reason: string | null;
  /** 8-4（CLIP）まで常に null。描画しない */
  similarity_score: number | null;
  user: PublicUser;
  likes_count: number;
  /** リクエストした本人がいいね済みか。7-4 まで描画しない */
  liked: boolean;
  /** ISO 8601（UTC） */
  created_at: string;
};

/**
 * GET /api/posts/:id。
 * meta は attempts のページングだけを指す。best_attempts はページングを持たず、
 * sort・page によらず常にいいね上位 3 件（6-1）。同じ挑戦が両方に現れうる。
 */
export type PostDetailResponse = {
  post: PostSummary;
  best_attempts: Attempt[];
  attempts: Attempt[];
  meta: PaginationMeta;
};

/** POST / DELETE /api/posts/:id/favorite。どちらも冪等で、更新後の favorited を含む。 */
export type FavoriteResponse = {
  post: PostSummary;
};
```

- [ ] **Step 2: `AttemptCard` を作る**

`frontend/src/components/attempts/attempt-card.tsx`：

```tsx
import { cloudinaryUrlOrNull } from "@/lib/cloudinary";
import type { Attempt } from "@/types/api";

// 生成画像は 1024×1024 の正方形（4-3）。表彰台と一覧で同じ変換にすると、同じ挑戦が
// 両方に出ても Cloudinary の派生画像は 1 つで済む（7-3b 設計書「決定 4」）。
const IMAGE_WIDTH = 640;

export function AttemptCard({ attempt }: { attempt: Attempt }) {
  // 7-4：この <article> を <Link href={`/attempts/${attempt.id}`}> で包み、いいねボタンを足す。
  // /attempts/[id] が実在しないうちにリンクにすると、main を追跡している本番で 404 になる。
  const publicId = attempt.generated_image_public_id;
  const src =
    publicId === null ? null : cloudinaryUrlOrNull(publicId, { width: IMAGE_WIDTH, aspect: "1:1" });
  // alt に描写文を入れない。長文になりうるうえ、画像の中身ではなく「当てようとした言葉」のため。
  const alt = `${attempt.user.name} さんの再現画像`;

  return (
    <article className="overflow-hidden rounded-card border border-line bg-surface">
      {src === null ? (
        <div role="img" aria-label={alt} className="aspect-square w-full bg-line" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- 変換は cloudinaryUrl() が済ませている（7-3a 設計書「決定 4」）
        <img src={src} alt={alt} loading="lazy" className="aspect-square w-full bg-line object-cover" />
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
  );
}
```

`post-card.tsx` の既存の `eslint-disable-next-line` の書き方（理由の書き方）を確認し、揃えること。

- [ ] **Step 3: `BestAttempts` を作る**

`frontend/src/components/attempts/best-attempts.tsx`：

```tsx
import { AttemptCard } from "@/components/attempts/attempt-card";
import type { Attempt } from "@/types/api";

// sm 以上で 2 位・1 位・3 位の順に並べる（1 位を中央に）。DOM の順序は 1・2・3 位のまま
// にして、並べ替えは order で行う。読み上げとスマホ幅の縦並びを順位どおりにするため。
const PLACEMENT_CLASSES = ["sm:order-2", "sm:order-1 sm:mt-10", "sm:order-3 sm:mt-10"];

/**
 * ベスト再現（表彰台）。
 *
 * API の best_attempts は「いいね上位 3 件」だが、全員 0 件のときは実質「新着 3 件」になる。
 * 見出しが「ベスト再現」なのに新着が並ぶのは嘘になるので、いいねが 1 以上のものだけを載せ、
 * 1 件も無ければセクションごと出さない（6-1：見せ方の判断はフロント）。
 *
 * 表彰台の挑戦はみんなの挑戦にも重複して出る。一覧から除くと kaminari の
 * total_count と OFFSET がずれるため、重複は仕様として受け入れる（6-1）。
 */
export function BestAttempts({ attempts }: { attempts: Attempt[] }) {
  const podium = attempts.filter((attempt) => attempt.likes_count > 0);
  if (podium.length === 0) return null;

  return (
    <section aria-labelledby="best-attempts-heading" className="flex flex-col gap-4">
      <h2 id="best-attempts-heading" className="text-lg font-semibold text-ink">
        このお題のベスト再現
      </h2>
      <ol className="grid grid-cols-1 items-start gap-6 sm:grid-cols-3">
        {podium.map((attempt, index) => (
          <li key={attempt.id} className={`flex flex-col gap-2 ${PLACEMENT_CLASSES[index]}`}>
            <p className="text-sm font-semibold text-accent">{index + 1} 位</p>
            <AttemptCard attempt={attempt} />
          </li>
        ))}
      </ol>
    </section>
  );
}
```

- [ ] **Step 4: `AttemptList` を作る**

`frontend/src/components/attempts/attempt-list.tsx`：

```tsx
import Link from "next/link";

import { AttemptCard } from "@/components/attempts/attempt-card";
import { buttonClasses } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { SortToggle } from "@/components/ui/sort-toggle";
import {
  postDetailHref,
  type AttemptsSort,
  type PostDetailQuery,
} from "@/lib/posts/post-detail-query";
import type { Attempt, PaginationMeta } from "@/types/api";

const SKELETON_COUNT = 6;

const SORT_OPTIONS: { sort: AttemptsSort; label: string }[] = [
  { sort: "recent", label: "新着順" },
  // デザインブリーフの「再現度順（いいね順）」。API の値は likes。
  { sort: "likes", label: "再現度順" },
];

/**
 * 一覧部分の状態。取得は PostDetail が持ち、ここは描き分けだけを行う。
 * 再取得中も見出しと並び替えは出したままにする（失敗したときに別の並びへ逃げられるように）。
 */
export type AttemptListState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; attempts: Attempt[]; meta: PaginationMeta };

export function AttemptList({
  postId,
  query,
  state,
  onRetry,
}: {
  postId: number;
  query: PostDetailQuery;
  state: AttemptListState;
  onRetry: () => void;
}) {
  return (
    <section aria-labelledby="attempts-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-baseline gap-3">
          <h2 id="attempts-heading" className="text-lg font-semibold text-ink">
            みんなの挑戦
          </h2>
          {state.kind === "ready" && state.meta.total_count > 0 && (
            <p className="text-sm text-ink-muted">全 {state.meta.total_count} 件</p>
          )}
        </div>
        {/* 並び替えたら 1 ページ目に戻す（page を渡さない）。 */}
        <SortToggle
          options={SORT_OPTIONS.map(({ sort, label }) => ({
            label,
            href: postDetailHref(postId, { sort }),
            active: query.sort === sort,
          }))}
        />
      </div>

      {state.kind === "loading" && <AttemptGridSkeleton />}

      {state.kind === "error" && (
        <div className="flex flex-col items-center gap-4 rounded-card border border-line bg-surface p-8 text-center">
          <p className="text-ink">{state.message}</p>
          <button
            type="button"
            onClick={onRetry}
            className={buttonClasses({ variant: "secondary" })}
          >
            再試行
          </button>
        </div>
      )}

      {state.kind === "ready" && (
        <AttemptResults postId={postId} query={query} attempts={state.attempts} meta={state.meta} />
      )}
    </section>
  );
}

function AttemptGridSkeleton() {
  return (
    <ul
      aria-busy="true"
      aria-label="読み込み中"
      className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
    >
      {Array.from({ length: SKELETON_COUNT }, (_, index) => (
        <li key={index} className="overflow-hidden rounded-card border border-line bg-surface">
          <div className="aspect-square w-full animate-pulse bg-line" />
          <div className="flex flex-col gap-2 p-4">
            <div className="h-4 w-full animate-pulse rounded bg-line" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-line" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function AttemptResults({
  postId,
  query,
  attempts,
  meta,
}: {
  postId: number;
  query: PostDetailQuery;
  attempts: Attempt[];
  meta: PaginationMeta;
}) {
  // 範囲外のページ（?page=99）。挑戦自体は存在するので「まだ挑戦がありません」は嘘になる。
  if (attempts.length === 0 && meta.total_count > 0) {
    return (
      <EmptyState message="このページには挑戦がありません">
        <Link
          href={postDetailHref(postId, { sort: query.sort })}
          className="text-accent hover:text-accent-strong"
        >
          1 ページ目へ
        </Link>
      </EmptyState>
    );
  }

  if (attempts.length === 0) {
    // 描写への導線は 7-3c（描写フォームがこのセクションの上に入る）。
    return <EmptyState message="まだ挑戦がありません" />;
  }

  return (
    <>
      <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {attempts.map((attempt) => (
          <li key={attempt.id}>
            <AttemptCard attempt={attempt} />
          </li>
        ))}
      </ul>
      <Pagination
        page={query.page}
        totalPages={meta.total_pages}
        hrefFor={(page) => postDetailHref(postId, { ...query, page })}
      />
    </>
  );
}

function EmptyState({ message, children }: { message: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface p-10 text-center">
      <p className="text-ink-muted">{message}</p>
      {children}
    </div>
  );
}
```

- [ ] **Step 5: 型・lint を通す**

Run: `docker compose exec frontend npx tsc --noEmit && docker compose exec frontend npm run lint`
Expected: エラー 0（`React.ReactNode` の参照は `post-list.tsx` と同じ書き方。型エラーになる場合は `import type { ReactNode } from "react"` に変えて揃える）

- [ ] **Step 6: コミット**

```bash
git add frontend/src/types/api.ts frontend/src/components/attempts
git commit -m "feat: 挑戦カード・表彰台・みんなの挑戦の部品を足す

表彰台はいいねが 1 以上の挑戦だけを載せる（全員 0 件なら実質新着になるため）。
カードは /attempts/[id]（7-4）が実在するまでリンクにしない。

Refs #115

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: お気に入りボタンとヒーロー

**Files:**
- Modify: `frontend/src/lib/auth/error-messages.ts`
- Create: `frontend/src/components/posts/favorite-button.tsx`
- Create: `frontend/src/components/posts/post-hero.tsx`

**Interfaces:**
- Consumes: `cloudinaryUrlOrNull`（Task 1）、`postDetailHref`（Task 2）、`FavoriteResponse` / `PostSummary`（Task 4 と既存）、`useAuth()`（既存。`status: "loading" | "authenticated" | "unauthenticated" | "unreachable"`）、`apiFetch` / `ApiError`（既存）、`toast.error`（既存）、`toRequestErrorMessage`（既存）
- Produces:
  - `export const SESSION_EXPIRED_MESSAGE: string`（`error-messages.ts`）
  - `FavoriteButton({ postId, favorited, onChange }: { postId: number; favorited: boolean; onChange: (favorited: boolean) => void })`
  - `PostHero({ post, favorited, onFavoritedChange }: { post: PostSummary; favorited: boolean; onFavoritedChange: (favorited: boolean) => void })`

- [ ] **Step 1: 失効の文言を export する**

`frontend/src/lib/auth/error-messages.ts`：`const FORM_MESSAGES` の直前に足し、辞書の値をこの定数に置き換える：

```ts
/**
 * JWT の失効（Authorization を載せたリクエストの 401）。ログインフォーム以外でも出すので export する。
 * 7-3b のお気に入りが最初の利用者。7-2.6 で失効の通知を設計するときもこれを使う（文言を 2 箇所に書かない）。
 */
export const SESSION_EXPIRED_MESSAGE = "セッションの有効期限が切れました。もう一度ログインしてください";
```

```ts
const FORM_MESSAGES: Record<string, string> = {
  invalid_credentials: "メールアドレスまたはパスワードが正しくありません",
  unauthorized: SESSION_EXPIRED_MESSAGE,
};
```

Run: `docker compose exec frontend npx vitest run test/lib/auth/error-messages.test.ts`
Expected: 全件 PASS（振る舞いは変わらない）

- [ ] **Step 2: `FavoriteButton` を作る**

`frontend/src/components/posts/favorite-button.tsx`：

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/error-messages";
import { postDetailHref } from "@/lib/posts/post-detail-query";
import { toRequestErrorMessage } from "@/lib/request-error-messages";
import { toast } from "@/lib/toast/toast-store";
import type { FavoriteResponse } from "@/types/api";

const POST_GONE_MESSAGE = "このお題は削除されました";

/**
 * 失敗を 1 文にする。**無言にしない**のが要点（backlog 7-3b：7-2.6 が未着手のうちの最低限）。
 *
 * 401 は失効。api.ts がトークンを捨てるので、このボタンはすぐ「ログインしてお気に入り」に
 * 変わる。理由を伝えないと、押したら別のボタンに化けたようにしか見えない。
 */
function toFavoriteErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return SESSION_EXPIRED_MESSAGE;
  if (error instanceof ApiError && error.status === 404) return POST_GONE_MESSAGE;
  return toRequestErrorMessage(error);
}

/**
 * お気に入りのトグル。**楽観更新しない**。API は冪等で、応答が更新後の真の状態を返すので、
 * 応答の favorited で表示を確定させれば巻き戻しのロジックが要らない（7-3b 設計書「決定 5」）。
 */
export function FavoriteButton({
  postId,
  favorited,
  onChange,
}: {
  postId: number;
  favorited: boolean;
  onChange: (favorited: boolean) => void;
}) {
  const auth = useAuth();
  const [pending, setPending] = useState(false);

  if (auth.status === "unauthenticated") {
    // 戻り先は並び替えとページを引き継がない（お題そのものに戻れれば足りる）。
    // ログイン画面側が safeNextPath() で検証する。
    return (
      <Link
        href={`/login?next=${encodeURIComponent(postDetailHref(postId))}`}
        className={`${buttonClasses({ variant: "secondary", size: "sm" })} shrink-0 text-sm`}
      >
        ログインしてお気に入り
      </Link>
    );
  }

  async function toggle() {
    setPending(true);
    try {
      const { post } = await apiFetch<FavoriteResponse>(`/api/posts/${postId}/favorite`, {
        method: favorited ? "DELETE" : "POST",
      });
      onChange(post.favorited);
    } catch (error: unknown) {
      toast.error(toFavoriteErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      // loading の間は押せない（ログイン中か確定していない）。unreachable は押せる。
      // 押して失敗すれば上の文言で理由が出る。
      disabled={auth.status === "loading" || pending}
      // ラベルは固定し、状態は aria-pressed で伝える（ラベルと状態の両方を変えると
      // 読み上げが「お気に入り済み、押されています」のように二重になる）。
      aria-pressed={favorited}
      className={`${buttonClasses({ variant: favorited ? "primary" : "secondary", size: "sm" })} shrink-0 text-sm`}
    >
      <span aria-hidden="true">{favorited ? "★" : "☆"}</span> お気に入り
    </button>
  );
}
```

- [ ] **Step 3: `PostHero` を作る**

`frontend/src/components/posts/post-hero.tsx`：

```tsx
import { FavoriteButton } from "@/components/posts/favorite-button";
import { cloudinaryUrlOrNull } from "@/lib/cloudinary";
import type { PostSummary } from "@/types/api";

// 本文の最大幅（max-w-5xl ≒ 1024px）に対し、Retina で少し足りない程度の 1 本に抑える。
// 幅を増やすほど変換と転送量が増える（7-3a 設計書「決定 4」の「1 画像 1 サイズ」）。
const HERO_WIDTH = 1280;

/**
 * 元画像・タイトル・投稿者・お気に入り。
 *
 * 元画像は aspect を渡さず切り抜かない（7-3b 設計書「決定 4」）。描写の対象そのものなので、
 * 一覧のサムネイルのように 4:3 に切ると描写すべき部分が見えなくなる。
 * 縦長の画像が画面を埋め尽くさないよう、高さは 70vh までに抑えて object-contain で収める。
 */
export function PostHero({
  post,
  favorited,
  onFavoritedChange,
}: {
  post: PostSummary;
  favorited: boolean;
  onFavoritedChange: (favorited: boolean) => void;
}) {
  const src = cloudinaryUrlOrNull(post.image_public_id, { width: HERO_WIDTH });

  return (
    <section className="flex flex-col gap-4">
      {src === null ? (
        <div role="img" aria-label={post.title} className="aspect-4/3 w-full rounded-card bg-line" />
      ) : (
        // loading="lazy" にしない。ページの主役で、最初に見える画像のため。
        // eslint-disable-next-line @next/next/no-img-element -- 変換は cloudinaryUrl() が済ませている（7-3a 設計書「決定 4」）
        <img
          src={src}
          alt={post.title}
          className="mx-auto max-h-[70vh] w-auto max-w-full rounded-card bg-line object-contain"
        />
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {/* 公開 UGC。{value} のまま置く。長い英数字のタイトルがはみ出さないよう wrap-break-word。 */}
          <h1 className="text-2xl font-semibold tracking-tight wrap-break-word text-ink">
            {post.title}
          </h1>
          <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
            <div className="flex min-w-0 gap-1">
              <dt>投稿者</dt>
              <dd className="truncate font-medium text-ink">{post.user.name}</dd>
            </div>
            <div className="flex gap-1">
              <dt>挑戦</dt>
              <dd className="font-medium text-ink">{post.attempts_count}</dd>
            </div>
            <div className="flex gap-1">
              <dt>いいね</dt>
              <dd className="font-medium text-ink">{post.likes_count}</dd>
            </div>
          </dl>
        </div>
        <FavoriteButton postId={post.id} favorited={favorited} onChange={onFavoritedChange} />
      </div>
    </section>
  );
}
```

`eslint-disable-next-line` の行とコメント行の順序で lint が通らない場合は、`post-card.tsx` と同じ配置（`{/* … */}` のコメントブロックの後に `// eslint-disable-next-line` を 1 行）に揃える。

- [ ] **Step 4: 型・lint・テストを通す**

Run: `docker compose exec frontend npx tsc --noEmit && docker compose exec frontend npm run lint && docker compose exec frontend npm test`
Expected: エラー 0・全件 PASS

- [ ] **Step 5: コミット**

```bash
git add frontend/src/lib/auth/error-messages.ts frontend/src/components/posts/favorite-button.tsx frontend/src/components/posts/post-hero.tsx
git commit -m "feat: お題詳細のヒーローとお気に入りボタンを足す

お気に入りは応答の favorited で表示を確定させる（楽観更新しない）。
失敗は無言にせずトーストで理由を出す。失効（401）の文言は error-messages.ts と共有する。

Refs #115

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `/posts/[id]` ページと取得（決定 2）、確認用ボタンの削除

**Files:**
- Create: `frontend/src/components/posts/post-detail.tsx`
- Create: `frontend/src/app/posts/[id]/page.tsx`
- Modify: `frontend/src/components/dev/health-panel.tsx`

**Interfaces:**
- Consumes: Task 2〜5 のすべて。`apiFetch` / `ApiError`、`toRequestErrorMessage`
- Produces: `PostDetail({ postId, query }: { postId: number; query: PostDetailQuery })`、ルート `/posts/[id]`

- [ ] **Step 1: `PostDetail` を作る**

`frontend/src/components/posts/post-detail.tsx`：

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AttemptList, type AttemptListState } from "@/components/attempts/attempt-list";
import { BestAttempts } from "@/components/attempts/best-attempts";
import { PostHero } from "@/components/posts/post-hero";
import { buttonClasses } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { postDetailApiPath, type PostDetailQuery } from "@/lib/posts/post-detail-query";
import { postsHref } from "@/lib/posts/posts-query";
import { toRequestErrorMessage } from "@/lib/request-error-messages";
import type { PostDetailResponse } from "@/types/api";

type Outcome =
  | { kind: "success"; data: PostDetailResponse }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

/**
 * お題詳細。取得はクライアントで 1 本だけ行う（7-3b 設計書「決定 1」）。
 *
 * 結果は 7-3a の PostList と同じく「どのリクエストの結果か」を表す key と一緒に持ち、
 * 今の key と一致しないものは表示しない（effect の中で同期的に setState しない。
 * react-hooks の set-state-in-effect と、古い応答による上書きの両方を避ける）。
 *
 * それに加えて、最後に成功した応答をお題 id と一緒に持つ（決定 2）。同じお題の再取得中
 * （並び替え・ページ送り・再試行）は、それでヒーローと表彰台を出し続け、みんなの挑戦だけを
 * 読み込み中にする。7-3c の描写フォームは書きかけの文面と生成中のポーリングを持つので、
 * 並び替えのたびにアンマウントされると両方が消える。
 *
 * 詳細 API は認証不要で、期限切れのトークンを付けても 200 を返す（2026-09-27 実測）。
 * そのため auth.status の確定を待たずに取得を始めてよい。favorited は tokenStore の
 * トークンで判定されるので、確定を待たなくても正しい値が返る。
 */
export function PostDetail({ postId, query }: { postId: number; query: PostDetailQuery }) {
  const apiPath = postDetailApiPath(postId, query);
  const [retryCount, setRetryCount] = useState(0);
  const requestKey = `${apiPath}#${retryCount}`;
  const [result, setResult] = useState<{ key: string; outcome: Outcome } | null>(null);
  const [lastSuccess, setLastSuccess] = useState<{ postId: number; data: PostDetailResponse } | null>(
    null,
  );
  // お気に入りの操作結果。取得し直した応答より新しいので、こちらを優先する。
  // 別のお題の値を持ち越さないよう、お題 id と一緒に持つ。
  const [favoritedOverride, setFavoritedOverride] = useState<{ postId: number; value: boolean } | null>(
    null,
  );

  useEffect(() => {
    const controller = new AbortController();

    apiFetch<PostDetailResponse>(apiPath, { signal: controller.signal })
      .then((data) => {
        setResult({ key: requestKey, outcome: { kind: "success", data } });
        setLastSuccess({ postId, data });
      })
      .catch((error: unknown) => {
        // 自分で中断した（クエリが変わった／アンマウントした）ものは失敗ではない。
        if (controller.signal.aborted) return;
        // 404 は削除済み・存在しないお題。待っても変わらないので再試行を出さない。
        const outcome: Outcome =
          error instanceof ApiError && error.status === 404
            ? { kind: "not_found" }
            : { kind: "error", message: toRequestErrorMessage(error) };
        setResult({ key: requestKey, outcome });
      });

    return () => controller.abort();
  }, [apiPath, requestKey, postId]);

  const outcome = result?.key === requestKey ? result.outcome : null;
  const retry = () => setRetryCount((count) => count + 1);

  if (outcome?.kind === "not_found") return <PostNotFound />;

  // 今のリクエストが成功していればそれを、まだ（または失敗）なら同じお題の直前のデータを使う。
  const current =
    outcome?.kind === "success"
      ? outcome.data
      : lastSuccess?.postId === postId
        ? lastSuccess.data
        : null;

  if (current === null) {
    // 初回の失敗はページ全体に出す（出せるデータが何も無い）。
    if (outcome?.kind === "error") {
      return <ErrorPanel message={outcome.message} onRetry={retry} />;
    }
    return <PostDetailSkeleton />;
  }

  const listState: AttemptListState =
    outcome === null
      ? { kind: "loading" }
      : outcome.kind === "error"
        ? { kind: "error", message: outcome.message }
        : { kind: "ready", attempts: outcome.data.attempts, meta: outcome.data.meta };

  const favorited =
    favoritedOverride?.postId === postId ? favoritedOverride.value : current.post.favorited;

  return (
    <div className="flex flex-col gap-10">
      <PostHero
        post={current.post}
        favorited={favorited}
        onFavoritedChange={(value) => setFavoritedOverride({ postId, value })}
      />
      <BestAttempts attempts={current.best_attempts} />
      {/*
        7-3c：描写フォームはここに入る。current が確定した後はこの位置が再取得で
        アンマウントされないので、書きかけの文面と生成中のポーリングが保たれる。
      */}
      <AttemptList postId={postId} query={query} state={listState} onRetry={retry} />
    </div>
  );
}

function PostDetailSkeleton() {
  return (
    <div aria-busy="true" aria-label="読み込み中" className="flex flex-col gap-4">
      <div className="aspect-4/3 w-full animate-pulse rounded-card bg-line" />
      <div className="h-8 w-2/3 animate-pulse rounded bg-line" />
      <div className="h-4 w-1/3 animate-pulse rounded bg-line" />
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

function PostNotFound() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface p-10 text-center">
      <p className="text-ink">お題が見つかりませんでした。削除された可能性があります</p>
      <Link href={postsHref()} className="text-accent hover:text-accent-strong">
        お題を探す
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: ページを作る**

`frontend/src/app/posts/[id]/page.tsx`：

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PostDetail } from "@/components/posts/post-detail";
import { parsePostDetailQuery, parsePostId } from "@/lib/posts/post-detail-query";
import type { RawSearchParams } from "@/lib/search-params";

// お題のタイトルを入れるにはサーバーでの取得（generateMetadata）が要り、
// クライアント取得（7-3b 設計書「決定 1」）と衝突する。OGP とあわせて 8-3 で扱う。
export const metadata: Metadata = {
  title: "お題",
};

/**
 * サーバーコンポーネントのまま、params と searchParams を正規化して渡すだけにする。
 * 取得はしない（Render がスリープしていると HTML ごと最大約 60 秒待たされるため。7-3a と同じ）。
 *
 * id が正の整数でなければ API を呼ばずに 404。存在しない id は API の 404 を
 * PostDetail が画面内で出す（どちらも「見つからない」ことに変わりはない）。
 */
export default async function PostDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const postId = parsePostId((await params).id);
  if (postId === null) notFound();

  const query = parsePostDetailQuery(await searchParams);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <PostDetail postId={postId} query={query} />
    </main>
  );
}
```

- [ ] **Step 3: `HealthPanel` のトースト確認用ボタンを削除する**

`frontend/src/components/dev/health-panel.tsx`：

1. `{/* 7-2.5 のトーストの確認用。… */}` のコメントブロックと、その直後の `<div className="mt-4 flex gap-2 border-t border-line pt-4">…</div>`（「成功トースト」「エラートースト」の 2 ボタン）を丸ごと削除する。
2. 使われなくなった import 2 行を削除する：`import { buttonClasses } from "@/components/ui/button";` と `import { toast } from "@/lib/toast/toast-store";`。削除後に `grep -n "buttonClasses\|toast" frontend/src/components/dev/health-panel.tsx` が何も出さないこと（他に使っている箇所があれば import を残す）。

- [ ] **Step 4: 型・lint・テスト・ビルドを通す**

Run:

```bash
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run lint
docker compose exec frontend npm test
docker compose exec frontend npm run build
```

Expected: すべてエラー 0・全件 PASS。ビルド出力のルート一覧に `ƒ /posts/[id]`（動的）が出る。
**ビルドの後は dev サーバーの `.next` が本番ビルドで上書きされている**ので、`docker compose exec frontend rm -rf .next && docker compose restart frontend` で戻してから次に進む（`frontend/AGENTS.md`）。

- [ ] **Step 5: 表示を目で確かめる（最低限）**

`http://localhost:3001/posts` から任意のカードを押し、ヒーロー・「みんなの挑戦」が出る。`/posts/abc` で 404 ページ、`/posts/999999` で「お題が見つかりませんでした」が出る。本格的な確認は Task 7。

- [ ] **Step 6: コミット**

```bash
git add frontend/src/components/posts/post-detail.tsx "frontend/src/app/posts/[id]/page.tsx" frontend/src/components/dev/health-panel.tsx
git commit -m "feat: お題詳細ページ（/posts/[id]）を足す

同じお題の再取得中は直前のデータでヒーローと表彰台を出し続け、みんなの挑戦だけを
読み込み中にする（7-3c の描写フォームが並び替えで消えないように）。
トーストの初の実利用ができたので、HealthPanel の確認用ボタンを削除する。

Refs #115

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 実物での確認・ドキュメント・レビュー・PR

**Files:**
- Modify: `docs/issues_backlog.md`

**Interfaces:**
- Consumes: Task 1〜6 の成果すべて
- Produces: PR（`Closes #115`）

- [ ] **Step 1: 確認用のデータを作る（ローカルの DB だけ）**

公開済みの挑戦が既存のお題に 1 件も無いので作る。既存のお題画像の `public_id` を生成画像として流用する（Cloudinary にアップロードしない）。**いいね数は作成順と逆向き**（古い挑戦ほど多い）にする。同じ向きだと、フロントが `sort` を渡し忘れていても新着順と再現度順の並びが一致して気づけない。

```bash
docker compose exec -T backend bin/rails runner '
post = Post.kept.order(:created_at).first or abort("お題が 1 件もありません")
author = User.where.not(id: post.user_id).order(:id).first
likers = User.where.not(id: [post.user_id, author.id]).order(:id).limit(14).to_a
abort("いいね用のユーザーが足りません") if likers.size < 14

14.times do |i|
  description =
    case i
    when 0 then "[7-3b確認] 1 行目\n2 行目\n3 行目\n4 行目（ここは省略される）"
    when 1 then "[7-3b確認] " + ("A" * 200)
    else "[7-3b確認] 挑戦 #{i + 1}"
    end
  attempt = Attempt.create!(post: post, user: author, description: description, status: :published,
                            generated_image_public_id: post.image_public_id, generated_at: Time.current,
                            created_at: (14 - i).minutes.ago)
  # 古い挑戦（i が小さい）ほどいいねを多く付ける。最後の 4 件は 0 件のまま。
  likers.first([10 - i, 0].max).each { |user| Like.create!(user: user, attempt: attempt) }
end

zero_post = Post.kept.where.not(id: post.id).order(:created_at).first
if zero_post
  Attempt.create!(post: zero_post, user: author, description: "[7-3b確認] いいね 0 件", status: :published,
                  generated_image_public_id: zero_post.image_public_id, generated_at: Time.current)
end
puts "post=#{post.id} zero_post=#{zero_post&.id}"
'
```

Expected: `post=<id> zero_post=<id>` が出る。以下 `<id>` はこの値。
`Attempt.create!` がバリデーションで落ちた場合（`generated_at` の要否など）は、`backend/app/models/attempt.rb` のバリデーションを読んで足りない属性を補う（**モデルは変更しない**）。

- [ ] **Step 2: 手動確認（全部に ✓ が付くまで先に進まない）**

`http://localhost:3001` で確かめる。

- [ ] 一覧のカード（ホバーで枠がアクセント色）を押すと `/posts/<id>` に遷移する
- [ ] ヒーロー：元画像が**切り抜かれずに**出る（一覧のサムネイルと比べて上下または左右が多く見える）。タイトル・投稿者・挑戦数・いいね合計が出る
- [ ] 表彰台：1 位が中央・2 位が左・3 位が右（640px 以上）。スマホ幅（375px）では 1・2・3 位の縦並び
- [ ] みんなの挑戦：新着順で `[7-3b確認] 挑戦 14` が先頭、「再現度順」で `1 行目…` の挑戦（いいね 10）が先頭に来る（**並びが入れ替わる**）
- [ ] 「次へ」で 2 ページ目（2 件）、再現度順の 2 ページ目で「新着順」を押すと新着順の **1 ページ目**になる
- [ ] DevTools の Network を **Slow 4G** にして並び替え・ページ送りを押すと、**ヒーローと表彰台はそのまま**で、みんなの挑戦だけがスケルトンになる。「新着順」「再現度順」を素早く交互に 5 回押す → 最後に押した並びが表示される
- [ ] `/posts/<id>?sort=likes&page=2` を**アドレスバーに直接入れて**開く・リロードする（`<Link>` 遷移だけではハイドレーション経路を確かめられない）。戻るボタンで前の並びに戻る
- [ ] 改行を含む描写文が 3 行で省略され、改行が反映されている。`AAAA…` の描写文がカードからはみ出さない
- [ ] `/posts/<zero_post>`：いいね 0 件なので**表彰台が出ない**。みんなの挑戦には 1 件出る
- [ ] 挑戦 0 件のお題（3 件目のお題があれば）：「まだ挑戦がありません」
- [ ] `/posts/<id>?page=99`：「このページには挑戦がありません」＋「1 ページ目へ」
- [ ] `/posts/abc`：404 ページ（`notFound()`）。`/posts/999999`：「お題が見つかりませんでした…」＋「お題を探す」
- [ ] お気に入り（ログイン中）：☆ → ★ に変わり、リロード後も ★。もう一度押すと ☆。`/mypage` はまだ無いので、`GET /api/me/favorites` で件数が増減することを curl で確かめてもよい
- [ ] お気に入り（未ログイン）：「ログインしてお気に入り」→ `/login?next=%2Fposts%2F<id>`。ログインすると `/posts/<id>` に戻る
- [ ] 失効：ログイン中に次のコマンドで期限切れトークンを作り、DevTools の Application → Local Storage のトークンの値を差し替える（キー名は `frontend/src/lib/auth/token-store.ts` を見る）。お気に入りを押すと「セッションの有効期限が切れました…」のトーストが出て、ボタンが「ログインしてお気に入り」に変わる

```bash
docker compose exec -T backend bin/rails runner 'u = User.first; print JWT.encode({ "sub" => u.id.to_s, "scp" => "user", "jti" => SecureRandom.uuid, "exp" => 1.hour.ago.to_i, "iat" => 2.hours.ago.to_i }, ENV.fetch("JWT_SECRET_KEY"), "HS256")'
```

- [ ] `docker compose pause backend` → `/posts/<id>` を再読み込み → 約 15 秒後にページ全体に「サーバーの応答がありません…」と「再試行」。`docker compose unpause backend` のあと「再試行」で表示される
- [ ] 表示された状態で `docker compose pause backend` → 「再現度順」を押す → 約 15 秒後、**ヒーローと表彰台は残ったまま**みんなの挑戦の枠にだけエラーと「再試行」。`unpause` 後に「再試行」で一覧が出る
- [ ] 一覧（`/posts`）の並び替え・ページ送り・検索が以前どおり動く（Task 3 の回帰確認）
- [ ] スマホ幅（375px）で横スクロールが出ない
- [ ] トップの `HealthPanel` に「成功トースト」「エラートースト」のボタンが無い
- [ ] タブ名が「お題 | Kotoe（言絵）」

- [ ] **Step 3: 確認用のデータを片づける（挑戦は discard、いいねは物理削除）**

いいねはトグル用の中間テーブルなので物理削除が規約（CLAUDE.md）。挑戦は discard。

```bash
docker compose exec -T backend bin/rails runner '
attempts = Attempt.kept.where("description LIKE ?", "[7-3b確認]%")
Like.where(attempt_id: attempts.select(:id)).delete_all
attempts.find_each(&:discard!)
puts "kept published: #{Attempt.kept.published.count}"
'
```

Expected: Step 1 の前の件数に戻る。お気に入りを付けたままなら、画面から外しておく。

- [ ] **Step 4: backlog を更新する**

`docs/issues_backlog.md`：

1. **7-3b の節**（`### 🟢 7-3b. お題詳細（/posts/[id]）＋描写入力＋生成ポーリング` から次の `### 🟢 7-4.` の直前まで）を次に置き換える：

```markdown
### 🟢 7-3b. お題詳細の閲覧（/posts/[id]）
- 依存：**7-3a**, 6-1, 5-2, 7-2.5（お気に入り失敗のトースト）
- 設計書：`docs/superpowers/specs/2026-09-27-issue-7-3b-post-detail-design.md`
- **分割の経緯**：当初は描写入力と生成ポーリングまで含めていたが、約 16〜18 ファイルになるため
  閲覧（7-3b・#115）と描写・生成（7-3c・#120）に再分割した（2026-09-27）。
- タスク：元画像ヒーロー＋タイトル＋投稿者＋お気に入り、**ベスト再現（表彰台）**、みんなの挑戦
  （再現度順／新着順・ページング）、404・通信エラー・空状態、一覧カードから詳細へのリンク。
- **7-3b で決めたこと（7-3c 以降が乗る前提）**：
  - 取得は `GET /api/posts/:id` を**クライアントで 1 本だけ**。`page.tsx` は `parsePostId()` と
    `parsePostDetailQuery()` で正規化して渡すだけ（`src/lib/posts/post-detail-query.ts`）
  - **同じお題の再取得中は、直前のデータでヒーローと表彰台を出し続け、みんなの挑戦だけを
    読み込み中にする**（`PostDetail` の `lastSuccess`）。7-3c の描写フォームはヒーロー・表彰台と
    みんなの挑戦の間（`PostDetail` にコメントあり）に置けば、並び替えでアンマウントされない
  - 表彰台には **`likes_count > 0` の挑戦だけ**を載せ、0 件ならセクションごと出さない
  - 元画像は**切り抜かない**（`cloudinaryUrl(id, { width })`。`aspect` を省くと `c_limit`）
  - 生成画像は表彰台・一覧とも `{ width: 640, aspect: "1:1" }`（同じ派生画像を共有する）
  - お気に入りは応答の `favorited` で確定（楽観更新しない）。失敗はトースト
    （401 は `SESSION_EXPIRED_MESSAGE`）
  - `Pagination` / `SortToggle` は `components/ui/` の共有部品（URL は呼び出し側が組み立てる）
  - ページ番号と id の受け付け方は `src/lib/search-params.ts`（`parsePositiveInt()`）に集約
- 完了条件：一覧からお題を開き、ベスト再現とみんなの挑戦を並び替え・ページ送りして見られる。
  ログイン中はお気に入りを付け外しできる。

### 🟢 7-3c. お題詳細の描写入力＋生成ポーリング
- 依存：**7-3b**, 4-2, 4-3, 7-2.5（「保存しました」のトースト）, 7-2.7（`AbortSignal` の合成）
- GitHub：#120
- タスク：描写入力（「保存」／「画像を生成」の 2 ボタン）、生成ポーリング、生成中・成功・失敗・
  上限到達の状態、生成画像のダウンロード URL。
- **ドメインの必守ルール**：「保存」＝下書き（`status: draft`）の作成・更新、「画像を生成」＝
  ジョブ起動。生成が成功したら**即公開**（結果を見てから公開を選ぶ導線は作らない）。
- **決めたこと（2026-09-27、7-3b の設計時に合意済み。着手時は設計書に写して根拠を足す）**：
  1. **下書き id は画面の中（`useState`）だけで持つ**。初回の「保存」は `POST`、以降は `PATCH`。
     リロード・移動で id は失われる（下書きはサーバーに残り、7-6 のマイページから再開する）。
     `localStorage` に置かない（別タブ・別端末の生成・削除と食い違う）。URL に載せる案
     （`?draft=`）は 7-6 の「編集」ボタンと一緒に設計する
  2. **「画像を生成」は未保存の変更を自動で保存してから起動する**。生成はサーバーに保存された
     文面を使うため、保存せずに書き換えると古い文面で生成される。下書きが無ければ `POST`、
     `text !== savedText` なら `PATCH`、その後 `POST :generate`。保存が失敗したら生成に進まない。
     「未保存なら生成ボタンを押せなくする」案は、主役のボタンが最初は押せない形になるので不採用
  3. **ポーリングは React を知らない非同期関数 ＋ 薄いフック**（`lib/attempts/poll-attempt.ts`）。
     取得・待機・時計を引数で差し替えられるようにして、そこにだけ Vitest を書く
     （React Testing Library を採用していないので、フックそのものは検査できない）。
     **3 秒間隔**（実測約 29 秒で約 10 回）、**6 分で打ち切り**（最悪ケース：150 秒 × 2 回＋
     アップロードの再試行で約 5 分）、1 回ごとの timeout は `apiRequest` の既定（15 秒）。
     通信エラー・5xx・timeout では**続行**、404 では停止。前の応答を待ってから次を送る（重ねない）。
     打ち切り後は「まだ生成しています」＋「もう一度確認」（枠は消費済みなので「失敗」と言わない）
  4. **入力欄は認証状態によらず常に表示する**（失効で入力欄がアンマウントされて文面が消えないように）。
     ボタン領域だけを出し分ける（`loading` は disabled、`unauthenticated` はログイン導線、
     `unreachable` は出して押せば失敗表示）
  5. 保存の 422（`blank` / `too_long`）は入力欄の下、`attempt_not_draft`・404 は `draftId` を
     `null` に戻して説明、401 はトースト（`SESSION_EXPIRED_MESSAGE`）で文面は残す。
     生成の 422 `generation_limit_reached` / 503 はフォームの上に文で出す（`resets_at` から
     「あと約 N 時間」を組み立てる）
  6. `published` / `failed` の後は `draftId` と `savedText` を `null` に戻し、**文面は残す**
     （終端状態なので次は新しい下書き。少し直して再挑戦できるように）。`published` では詳細を
     取り直して一覧と表彰台に反映する。ポーリング中は「ページを離れても生成は続きます。
     完成するとみんなの挑戦に表示されます」と添える
  7. 新しく作る純粋関数：`poll-attempt.ts`、`attempt-messages.ts`（`failure_reason`・生成エラー・
     バリデーションの翻訳と「あと約 N 時間」）、`cloudinaryDownloadUrl()`（`f_png,fl_attachment`。
     `download` 属性は別オリジンで効かない）。状態遷移は reducer に切り出さない
- **6-1 からの申し送り**：`best_attempts` はページングを持たない（7-3b で対応済み。取り直しは 1 本）。
- **4-3 からの申し送り**：生成画像は WebP で保存しているため、ダウンロード URL には必ず
  `f_png` / `f_jpg` と `fl_attachment` を付けること。
- **「保存」の成功通知は 7-2.5 のトーストを使う**。押しても画面が変わらないため。
- **失効（401）の扱いは 7-2.6 に委ねる**。7-3c では少なくとも失敗が無言にならないようにする（上の 5）。
- 完了条件：お題を開いて描写し、生成（即公開）して結果が表示されるコアループが動く。
```

2. **7-4 の節**（`### 🟢 7-4. 挑戦詳細・比較ビュー`）の `- 完了条件：` の行の直前に足す：

```markdown
- **7-3b からの申し送り**：
  - **挑戦カード（`components/attempts/attempt-card.tsx`）を `<Link href={`/attempts/${attempt.id}`}>`
    で包み、いいねボタンを足す**（コメントで場所がある）。7-3b はルートが無いのでリンクにせず、
    いいねは数の表示だけにした。カードはお題詳細の表彰台とみんなの挑戦の両方で使われている
  - 生成画像は `cloudinaryUrl(id, { width: 640, aspect: "1:1" })` と同じ変換を使えば派生画像を共有できる
```

3. **7-6 の節**（`### 🟢 7-6. マイページ`）の `- 完了条件：` の行の直前に足す：

```markdown
- **7-3b / 7-3c からの申し送り**：
  - 自分の挑戦カードの**削除メニューと確認ダイアログ**（デザインブリーフ 3-B）はここで作る
  - 下書きの「編集」ボタンの受け口（例：`/posts/[id]?draft=<id>`）はここで設計する。7-3c は
    下書き id を画面の中だけで持つので、リロード後に編集を再開する手段はマイページにしか無い。
    URL に載せるなら、他人の下書き・生成済み・別のお題・削除済みの扱いと、値の検証が要る
```

4. **4-5 の節**の「生成中は、起動した画面が手元に持つ `id` をポーリングして追う（7-3b）」の `（7-3b）` を `（7-3c）` にする。

5. **4-3 の節**の「**7-3b への申し送り**：生成画像は WebP で保存しているため…」の `7-3b` を `7-3c` にする。

6. **7-5 の節**の「E2E（8-1）も 7-3b・7-4 依存なので」の `7-3b` を `7-3c` にする。

7. **8-1 の節**の `- 依存：7-3b, 7-4` を `- 依存：7-3c, 7-4` にする。

8. **8-2b の節**の `コアループ完成（7-3b まで）` を `コアループ完成（7-3c まで）` にする。

9. **8-3 の節**の `- 完了条件：` の行の直前に足す：

```markdown
- **7-3b からの申し送り**：お題詳細の `<title>` は固定の「お題」。タイトルを入れるには
  サーバーでの取得（`generateMetadata`）が要り、クライアント取得（7-3a / 7-3b の決定 1）と衝突する。
  Render のスリープで HTML ごと待たされない形（`generateMetadata` だけ短い timeout で取り、
  失敗したら固定の文言に落とすなど）をここで検討する
```

10. **8-5 の節**の「`connect-src` の実際の使われ方（ポーリング含む） → **7-3b** で確定」の `7-3b` を `7-3c` にする。

11. **進行順のまとめ**の背骨の `7-3a → 7-3b →（7-4・7-5）` を `7-3a → 7-3b → 7-3c →（7-4・7-5）` にし、直後の 2 つの箇条書きを次にする：

```markdown
- **7-2.5（フラッシュメッセージ）は 7-3c の前**。7-3c の「保存」は押しても画面が変わらないため、
  通知が無いと保存されたか分からない。
- **7-3 は 4 つに割ってある**。7-2.7（画面を作らない前提整備）→ 7-3a（一覧）→ 7-3b（詳細の閲覧）→
  7-3c（描写・生成）。1 つにすると 20 ファイル規模の PR になり、「1 issue = 1 PR」と釣り合わないため。
```

置き換えのあと、`grep -n "7-3b" docs/issues_backlog.md` で残った箇所を読み、**完了済みの issue の記録**（7-2.5 の「7-3b の前に置く理由」など、当時の判断を書いた箇所）以外に、描写・生成を 7-3b に帰属させている記述が残っていないことを確かめる。完了済みの記録は書き換えない。

- [ ] **Step 5: 全体の検証**

```bash
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run lint
docker compose exec frontend npm test
git diff --stat main -- backend
```

Expected: すべてエラー 0・全件 PASS。`git diff --stat main -- backend` は出力なし（rspec / rubocop は CI に任せる）

- [ ] **Step 6: コミット**

```bash
git add docs/issues_backlog.md
git commit -m "docs: 7-3b の決定事項を記録し、7-3c を backlog に積む

描写・生成は 7-3c（#120）に分けた。分割前に合意した決定事項を 7-3c に先に書いておく。

Refs #115
Refs #120

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: プッシュ前にコードレビューを通す**

プッシュ前に `/code-review high` を回す（superpowers の最終レビューとは別物で、両方通す。メモリの規約）。指摘は `superpowers:receiving-code-review` に沿って検証してから直し、直したものは規約どおりにコミットする。

- [ ] **Step 8: プッシュして PR を出す**

PR 本文の `Closes` の判定：この PR のマージで #115 の完了条件（閲覧・並び替え・ページ送り・お気に入り）を満たす → `Closes #115`。#120 は積むだけなので `Refs #120`。

```bash
git push -u origin feat/post-detail
gh pr create --title "7-3b. お題詳細（/posts/[id]）の閲覧" --body "$(cat <<'EOF'
## 概要

一覧からお題を開き、元画像・ベスト再現（表彰台）・みんなの挑戦（再現度順／新着順・ページ送り）を見られるようにした。ログイン中はお気に入りを付け外しできる。描写入力と生成ポーリングは 7-3c（#120）に分けた。

設計書：`docs/superpowers/specs/2026-09-27-issue-7-3b-post-detail-design.md`

## 決めたこと

- 取得は `GET /api/posts/:id` を**クライアントで 1 本だけ**（7-3a と同じく、Render のスリープで HTML ごと待たせない）
- **同じお題の再取得中は、ヒーローと表彰台を出し続け、みんなの挑戦だけを読み込み中にする**。7-3c の描写フォームが並び替えで消えないようにするため
- 表彰台には**いいね 1 以上**の挑戦だけを載せる（全員 0 件なら実質新着になり、「ベスト再現」の見出しが嘘になる）
- 元画像は**切り抜かない**（`cloudinaryUrl()` で `aspect` を省くと `c_limit`）
- お気に入りは応答で確定（楽観更新しない）。失敗は無言にせずトースト
- 挑戦カードは `/attempts/[id]`（7-4）が実在するまで**リンクにしない**。いいねボタンも 7-4

## 見た目が変わるところ

- 一覧のカードが詳細へのリンクになった（ホバーで枠がアクセント色）
- 開発用の `HealthPanel` からトースト確認用のボタンを削除した（本番には元々出ていない）

## 確認したこと

- Vitest：search-params / post-detail-query / cloudinary（`c_limit`）。posts-query は無変更で通過
- 手動：並び替えの入れ替わり（いいね数を作成順と逆向きに振ったデータ）、ページ送り、再取得中にヒーローが残ること（Slow 4G）、直接ロード・リロード・戻る、表彰台の出し分け、404 の 2 経路、お気に入り（ログイン中・未ログイン・失効）、タイムアウト（初回と再取得）、一覧の回帰、スマホ幅

## マージ前のチェックリスト

- [ ] CI（rubocop / rspec / frontend）が green
- [ ] プレビュー URL で一覧 → 詳細の遷移と画像の表示

Closes #115
Refs #120

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 9: プレビュー URL で確認する**

PR に付いた Vercel のプレビュー URL で一覧 → 詳細を開き、元画像と挑戦の画像が表示されること・並び替えが動くことを確かめ、PR のチェックリストを埋める。マージ後、本番（`https://kotoe.vercel.app`）で一覧 → 詳細の遷移とお気に入りの付け外しを 1 回ずつ確かめる。

---

## Self-Review（記入済み）

**1. 設計書の網羅：**

| 設計書の節 | タスク |
|---|---|
| 決定 1（取得は 1 本・クライアント、`parsePostId` で `notFound()`） | 2（`parsePostId`）、6（`PostDetail`・`page.tsx`） |
| 決定 2（再取得中は直前のデータ） | 6（`lastSuccess` と `current` の導出、`listState`）、7（Slow 4G・再取得の失敗） |
| 決定 3（表彰台は `likes_count > 0`・`order` で配置） | 4（`BestAttempts`）、7（0 件のお題・スマホ幅） |
| 決定 4（元画像は切り抜かない・生成画像は 640 の 1:1） | 1（`c_limit`）、4（`AttemptCard`）、5（`PostHero`） |
| 決定 5（お気に入り：応答で確定・失敗はトースト・`unauthorized` の export） | 5、7（失効の確認） |
| 決定 6（URL に持たせる・「新着順」「再現度順」） | 2、4（`SORT_OPTIONS`） |
| 決定 7（`Pagination` / `SortToggle` の共有） | 3 |
| 決定 8（カードはリンクにしない・いいねボタンなし） | 4（`AttemptCard` のコメント）、7（7-4 への申し送り） |
| 画面の状態（0 件・範囲外・取得中・失敗・404） | 4（`AttemptResults`）、6（`PostNotFound` / `ErrorPanel`） |
| メタデータ | 6（`page.tsx`）、7（8-3 への申し送り） |
| XSS | 4（`whitespace-pre-wrap`）、5・6（`{value}`・`cloudinaryUrlOrNull`）、Global Constraints |
| テスト | 1・2 |
| 手動確認 | 7 |
| ドキュメントの後始末 | 7（Step 4） |
| `health-panel.tsx` の削除 | 6 |

**2. プレースホルダ：** なし。Task 3 Step 1 の「元のファイルに上に無いクラスがあれば残す」は、元ファイル全体を計画に写していないための確認手順で、実装内容は確定している。

**3. 型の一貫性：** `RawSearchParams` / `firstParam` / `parsePositiveInt`（Task 2 → 2・6）、`PostDetailQuery` / `AttemptsSort` / `postDetailHref` / `postDetailApiPath` / `parsePostId` / `parsePostDetailQuery`（Task 2 → 3・4・5・6）、`CloudinaryOptions`（Task 1 → 4・5）、`Pagination({ page, totalPages, hrefFor })` / `SortToggle({ options })`（Task 3 → 3・4）、`Attempt` / `PostDetailResponse` / `FavoriteResponse`（Task 4 → 4・5・6）、`AttemptListState`（Task 4 → 6。`kind` は `loading` / `error` / `ready`）、`SESSION_EXPIRED_MESSAGE`（Task 5）、`FavoriteButton({ postId, favorited, onChange })` / `PostHero({ post, favorited, onFavoritedChange })`（Task 5 → 6）。名前と引数の形が一致していることを確認した。

**4. Review Focus：** 5 項目すべてに、確認を持つタスクを割り当てた（1 → Task 6・7、2 → Task 6・7、3 → Task 5・7、4 → Task 1・5・7、5 → Task 4・7）。

**設計書からの意図的な差分（2 件）：**
- 設計書は「ログイン導線の `next` は `URLSearchParams` で組み立てる」と書いたが、Task 5 は既存の `RequireAuth` と同じ `encodeURIComponent` にした。どちらも同じくエンコードされ、既存の書き方に揃えるほうを採った。
- 設計書の `AttemptList` は「`AttemptListState` に再試行を含める」とは書いていないが、Task 4 は `onRetry` を別の prop にした（状態は描き分けのためのデータ、再試行は操作なので分けた）。
