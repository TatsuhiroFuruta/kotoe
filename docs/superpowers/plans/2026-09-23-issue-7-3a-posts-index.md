# お題一覧・検索（/posts） 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/posts` で、お題を検索・並び替え・ページ送りして探せるようにする。あわせて、後続の issue が使い回す Cloudinary の URL ヘルパと、ナビの「探す」／トップの CTA「お題を探す」を足す。

**Architecture:** `app/posts/page.tsx` はサーバーコンポーネントのまま、`searchParams`（Promise の prop）を `parsePostsQuery()` で正規化してクライアントコンポーネント `PostList` に渡すだけにする。取得は `PostList` の `useEffect` から `apiFetch` で行う。状態は URL だけに持たせる（検索は `next/form` の `<Form>`、並び替えとページ送りは `<Link>`）。取得結果は「どのリクエストの結果か」を表すキー付きで保持し、今のキーと一致しないものは表示しない（＝取得中）。画像は `<img>` に `cloudinaryUrl()` の変換 URL を入れる（`next/image` は使わない）。

**Tech Stack:** Next.js 16.2.10（App Router）／ React 19.2.4 ／ TypeScript ／ TailwindCSS 4.3.2 ／ Vitest 4.1.11（jsdom）／ Docker Compose。**新しい依存は追加しない**（`next/form` は next に同梱）。

**Spec:** `docs/superpowers/specs/2026-09-23-issue-7-3a-posts-index-design.md`

**Issue:** GitHub #114（`docs/issues_backlog.md` 7-3a）

**Branch:** `feat/posts-index`（作成済み。設計書のコミット `1c0a9fb` が載っている）

## Global Constraints

このプロジェクト全体の規約。**全タスクの要件に暗黙に含まれる。**

- **依存パッケージを追加しない。** `frontend/package.json` は変更しない。
- **`backend/` のコードは 1 行も変更しない。** API は 3-2 / 6-1 のものをそのまま使う。
- **`frontend/src/app/globals.css` を変更しない。** 過去 4 回の Turbopack stale はすべてこのファイルの変更で起きている（`frontend/AGENTS.md`）。色は既存トークン（`bg-canvas` / `bg-surface` / `text-ink` / `text-ink-muted` / `border-line` / `bg-accent` / `text-accent` / `text-danger` / `rounded-card`）だけを使い、`zinc-500` のような生のパレットと `dark:` を書かない。
- **`useSearchParams()` を使わない。** Vercel の本番ビルドだけ落ちる（7-2 の規約）。クエリは `page.tsx` の `searchParams` prop から受け取る。
- **`dangerouslySetInnerHTML` を使わない**（eslint `react/no-danger` が error）。ユーザー由来の値（`title` / `user.name` / 検索語 `q`）は `{value}` で出すだけ。
- **`<img src>` に入れてよいのは `cloudinaryUrl()` の戻り値だけ。**
- **存在しないルートへリンクを置かない。** `/posts/[id]`（7-3b）・`/posts/new`（7-5）・`/mypage`（7-6）・`/rankings`（7-7）へのリンクは作らない。main は Vercel の本番を追跡している。
- **文字列はダブルクォート。** コメントは日本語で、「何をしているか」ではなく**「なぜそうしたか」**を書く（既存ファイルの書き方に合わせる）。
- **`any` を使わない。** API レスポンスには型を付ける。
- **テストは `frontend/test/` に置き、`src/` の構造を写す。** コンポーネントのテストは書かない（CLAUDE.md のテスト方針。E2E は 8-1）。
- **env ファイルの中身を表示しない。** 確認はキー名だけ（`grep -o '^[A-Z_]*='`）。`cat` / `grep` の結果に値を出さない。
- コマンドはリポジトリのルートで実行し、`npm` 系は `docker compose exec frontend <コマンド>` でコンテナ内で動かす。
- コミットメッセージの末尾は `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` で止める（セッションリンクを書かない）。
- `git checkout` を使わない。ブランチの切り替えもしない（`feat/posts-index` 上だけで作業する）。

## Review Focus

どのタスクの単体テストも直接は叩かないが、使う人が最初に踏みそうな入力・条件。各行の確認は、そのコードを持つタスクに入れてある。

1. **日本語 IME の変換確定の Enter で検索が発火しない**こと。変換途中の文字列（「ねk」など）で `/posts?q=` に遷移すると、意図しない 0 件表示になる → Task 6 の手動確認
2. **並び替え・ページ送りを素早く連打しても、古い応答が新しい結果を上書きしない**こと → Task 4 のキー付き結果（`result.key === requestKey`）と、Task 6 の手動確認（DevTools の Slow 4G）
3. **`&` `#` `%` `+` や空白を含む検索語が、往復しても同じ語に戻る**こと（`+` は `URLSearchParams` で `%2B` になり、空白は `+` になる） → Task 2 のテスト
4. **空白を含まない長いタイトル・ユーザー名がカードからはみ出さない**こと → Task 4 の `wrap-break-word` / `line-clamp-2`、Task 6 の手動確認（80 文字の英数字タイトル）
5. **Vercel の Preview / Production に `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` が無いままビルドされる**と、一覧の描画で例外になって画面ごと落ちる → Task 6 の PR チェックリストと、プレビュー URL での確認

## ファイル構成

| ファイル | 責務 | タスク |
|---|---|---|
| `frontend/src/lib/request-error-messages.ts` | **新規**。通信エラーの文言と、認証に依存しない取得の失敗を 1 文にする関数 | 1 |
| `frontend/src/lib/auth/error-messages.ts` | 3 定数を上のモジュールから import するだけ（振る舞いは変えない） | 1 |
| `frontend/test/lib/request-error-messages.test.ts` | **新規** | 1 |
| `frontend/src/lib/posts/posts-query.ts` | **新規**。URL ⇄ `PostsQuery` の正規化と組み立て（純粋関数） | 2 |
| `frontend/test/lib/posts/posts-query.test.ts` | **新規** | 2 |
| `frontend/src/lib/cloudinary.ts` | **新規**。`cloudinaryUrl()`（純粋関数） | 3 |
| `frontend/test/lib/cloudinary.test.ts` | **新規** | 3 |
| `frontend/.env.example` | `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` を追記 | 3 |
| `frontend/src/types/api.ts` | `PublicUser` / `PostSummary` / `PaginationMeta` / `PostsIndexResponse` を追加 | 4 |
| `frontend/src/components/posts/post-card.tsx` | **新規**。カード 1 枚 | 4 |
| `frontend/src/components/posts/post-search-form.tsx` | **新規**。`<Form action="/posts">` | 4 |
| `frontend/src/components/posts/post-sort-toggle.tsx` | **新規**。新着／人気の `<Link>` | 4 |
| `frontend/src/components/posts/pagination.tsx` | **新規**。前へ｜n / N｜次へ | 4 |
| `frontend/src/components/posts/post-list.tsx` | **新規**。取得と状態の出し分け | 4 |
| `frontend/src/app/posts/page.tsx` | **新規**。`searchParams` を正規化して `PostList` へ | 4 |
| `frontend/src/app/layout.tsx` | `metadata.title` を template 形式に | 4 |
| `frontend/src/components/layout/site-header.tsx` | 「探す」→ `/posts` | 5 |
| `frontend/src/app/page.tsx` | CTA「お題を探す」→ `/posts` | 5 |
| `docs/issues_backlog.md` | 7-3a 完了・7-3b への申し送り・8-5 の `img-src` | 6 |
| `docs/superpowers/specs/2026-09-23-issue-7-3a-posts-index-design.md` | 配列の扱いの記述を実装に合わせる（Task 2 で判明） | 2 |

---

### Task 1: 通信エラーの文言を `lib/request-error-messages.ts` へ切り出す

**Files:**
- Create: `frontend/src/lib/request-error-messages.ts`
- Modify: `frontend/src/lib/auth/error-messages.ts:48-52`（3 定数の定義を import に置き換える）
- Test: `frontend/test/lib/request-error-messages.test.ts`

**Interfaces:**
- Consumes: `ApiError` / `ApiTimeoutError`（`@/lib/api`。既存）
- Produces:
  - `export const TIMEOUT_MESSAGE: string`
  - `export const NETWORK_MESSAGE: string`
  - `export const SERVER_MESSAGE: string`
  - `export function toRequestErrorMessage(error: unknown): string` … Task 4 の `PostList` が使う

- [ ] **Step 1: 失敗するテストを書く**

`frontend/test/lib/request-error-messages.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, ApiTimeoutError } from "@/lib/api";
import {
  NETWORK_MESSAGE,
  SERVER_MESSAGE,
  TIMEOUT_MESSAGE,
  toRequestErrorMessage,
} from "@/lib/request-error-messages";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toRequestErrorMessage", () => {
  it("タイムアウトを通信断とは別の文言にする", () => {
    // Render のコールドスタートで必ず通る経路。通信断の文言（通信環境を疑わせる）を
    // 出すと、ユーザーの回線は正常なのに誤診させることになる。
    expect(toRequestErrorMessage(new ApiTimeoutError(15_000))).toBe(TIMEOUT_MESSAGE);
  });

  it("2xx 以外の応答はサーバーエラーの文言にする", () => {
    expect(toRequestErrorMessage(new ApiError(500, "<html>Bad Gateway</html>"))).toBe(
      SERVER_MESSAGE,
    );
  });

  it("fetch 自体の失敗（TypeError）は通信断の文言にする", () => {
    expect(toRequestErrorMessage(new TypeError("Failed to fetch"))).toBe(NETWORK_MESSAGE);
  });

  it("想定外の例外も空文字にせず文言を返し、原文を console.error に残す", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("boom");

    const message = toRequestErrorMessage(error);

    expect(message).not.toBe("");
    expect([TIMEOUT_MESSAGE, NETWORK_MESSAGE, SERVER_MESSAGE]).not.toContain(message);
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), error);
  });

  it("文言は auth の辞書と同じものを指す（同じ文を 2 箇所に持たない）", async () => {
    const { toAuthFormErrors } = await import("@/lib/auth/error-messages");

    expect(toAuthFormErrors(new ApiTimeoutError(15_000)).formError).toBe(TIMEOUT_MESSAGE);
    expect(toAuthFormErrors(new TypeError("Failed to fetch")).formError).toBe(NETWORK_MESSAGE);
    expect(toAuthFormErrors(new ApiError(500, null)).formError).toBe(SERVER_MESSAGE);
  });
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/request-error-messages.test.ts`
Expected: FAIL（`Failed to resolve import "@/lib/request-error-messages"`）

- [ ] **Step 3: モジュールを作る**

`frontend/src/lib/request-error-messages.ts`：

```ts
// 通信そのものの失敗（タイムアウト・通信断・2xx 以外）を画面の文言にする。
//
// 認証フォーム（lib/auth/error-messages.ts）と一覧などの取得（7-3a 以降）で
// 同じ文言を使うため、ここに 1 つだけ置く。どちらかにだけ書くと、片方の
// 文言を直したときにもう片方が古いまま残る。
//
// 業務ルールのエラー（422 のフィールド別コードなど）はここでは扱わない。
// 画面ごとに描画する入力欄が違い、振り分け方も画面ごとに違うため。

import { ApiError, ApiTimeoutError } from "@/lib/api";

export const TIMEOUT_MESSAGE =
  "サーバーの応答がありません。起動中の可能性があるので、少し待ってから再度お試しください";
export const NETWORK_MESSAGE = "サーバーに接続できませんでした。通信環境を確認してください";
export const SERVER_MESSAGE = "サーバーでエラーが発生しました。時間をおいて再度お試しください";

const UNEXPECTED_LOAD_MESSAGE = "読み込みに失敗しました。時間をおいて再度お試しください";

/**
 * 認証に依存しない取得（お題一覧など）の失敗を 1 文にする。
 *
 * 判定の順序は toAuthFormErrors の末尾と揃えてある。ApiTimeoutError を先に見るのは、
 * abort の reject 値が TypeError ではないため（後ろに置いても結果は同じだが、
 * 「タイムアウトは通信断ではない」という意図を順序で示す）。
 *
 * 呼び出し側の中断（AbortError）はここに渡さないこと。失敗ではないので文言を出す相手が無い。
 */
export function toRequestErrorMessage(error: unknown): string {
  if (error instanceof ApiTimeoutError) return TIMEOUT_MESSAGE;

  // JSON でないボディ（Render のプロキシや Vercel の HTML エラーページ）もここに来る。
  if (error instanceof ApiError) return SERVER_MESSAGE;

  // fetch 自体が失敗すると TypeError になる（通信断・CORS・名前解決の失敗）。
  if (error instanceof TypeError) return NETWORK_MESSAGE;

  // 握り潰すと原因の分からない「読み込めない」になる。文言は丸め、原文はコンソールに残す。
  console.error("読み込みで想定外のエラーが発生しました", error);
  return UNEXPECTED_LOAD_MESSAGE;
}
```

- [ ] **Step 4: auth の辞書を import に置き換える**

`frontend/src/lib/auth/error-messages.ts` の import に 1 行足し、48〜52 行目の 3 定数の定義を消す。`UNEXPECTED_MESSAGE`（「認証に失敗しました…」）は auth 固有なので**残す**。

```ts
import { ApiError, ApiTimeoutError } from "@/lib/api";
import { NETWORK_MESSAGE, SERVER_MESSAGE, TIMEOUT_MESSAGE } from "@/lib/request-error-messages";
```

```ts
// 通信そのものの失敗の文言は lib/request-error-messages.ts にある（一覧と共有するため）。
const UNEXPECTED_MESSAGE = "認証に失敗しました。時間をおいて再度お試しください";
```

- [ ] **Step 5: テストが通ることを確かめる（既存の auth のテストも含む）**

Run: `docker compose exec frontend npx vitest run test/lib/request-error-messages.test.ts test/lib/auth/error-messages.test.ts`
Expected: PASS（新規 5 件＋既存 8 件。**既存の `error-messages.test.ts` は 1 行も変えずに通ること**が、振る舞いを変えていない証拠になる）

- [ ] **Step 6: 型と lint**

Run: `docker compose exec frontend npx tsc --noEmit && docker compose exec frontend npm run lint`
Expected: エラー 0

- [ ] **Step 7: コミット**

```bash
git add frontend/src/lib/request-error-messages.ts frontend/src/lib/auth/error-messages.ts frontend/test/lib/request-error-messages.test.ts
git commit -m "refactor: 通信エラーの文言を認証の辞書から切り出す

お題一覧（7-3a）でも同じタイムアウト・通信断・5xx の文言が要るため。
auth 側は定数を import に置き換えただけで、振る舞いは変えていない。

Refs #114

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: URL ⇄ 検索条件の正規化（`lib/posts/posts-query.ts`）

**Files:**
- Create: `frontend/src/lib/posts/posts-query.ts`
- Test: `frontend/test/lib/posts/posts-query.test.ts`
- Modify: `docs/superpowers/specs/2026-09-23-issue-7-3a-posts-index-design.md`（配列の扱いの記述）

**Interfaces:**
- Consumes: なし
- Produces（Task 4 が使う）:
  - `export type PostsSort = "recent" | "popular"`
  - `export type PostsQuery = { q: string; sort: PostsSort; page: number }`
  - `export type RawSearchParams = Record<string, string | string[] | undefined>`
  - `export function parsePostsQuery(params: RawSearchParams): PostsQuery`
  - `export function postsHref(query?: Partial<PostsQuery>): string` … 例：`postsHref({ q: "猫", sort: "popular" })` → `"/posts?q=%E7%8C%AB&sort=popular"`、`postsHref()` → `"/posts"`
  - `export function postsApiPath(query: PostsQuery): string` … 例：`"/api/posts?sort=popular&page=2"`

- [ ] **Step 1: 失敗するテストを書く**

`frontend/test/lib/posts/posts-query.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import {
  parsePostsQuery,
  postsApiPath,
  postsHref,
  type PostsQuery,
} from "@/lib/posts/posts-query";

/** 組み立てた URL を、Next が searchParams として渡す形（値は文字列）に戻す。 */
function paramsOf(href: string): Record<string, string> {
  return Object.fromEntries(new URL(href, "http://localhost").searchParams);
}

describe("parsePostsQuery", () => {
  it("何も無ければ既定値（検索なし・新着順・1 ページ目）", () => {
    expect(parsePostsQuery({})).toEqual({ q: "", sort: "recent", page: 1 });
  });

  describe("sort", () => {
    it("popular だけを人気順として受け付ける", () => {
      expect(parsePostsQuery({ sort: "popular" }).sort).toBe("popular");
    });

    it.each(["recent", "likes", "POPULAR", "", " popular"])(
      "%j は新着順に丸める（API も popular 以外は新着順にする）",
      (sort) => {
        expect(parsePostsQuery({ sort }).sort).toBe("recent");
      },
    );

    it("?sort=a&sort=b のように配列で来たら先頭で判定する", () => {
      expect(parsePostsQuery({ sort: ["popular", "recent"] }).sort).toBe("popular");
      expect(parsePostsQuery({ sort: ["likes", "popular"] }).sort).toBe("recent");
    });
  });

  describe("page", () => {
    it("正の整数の文字列はそのまま使う", () => {
      expect(parsePostsQuery({ page: "3" }).page).toBe(3);
    });

    it.each(["0", "-1", "abc", "2.5", "", "1e3", " 2", "0x10"])(
      "%j は 1 ページ目に丸める",
      (page) => {
        expect(parsePostsQuery({ page }).page).toBe(1);
      },
    );

    it("安全な整数を超える値は 1 ページ目に丸める（精度が落ちて別のページを指すため）", () => {
      expect(parsePostsQuery({ page: "99999999999999999999" }).page).toBe(1);
    });

    it("配列で来たら先頭で判定する", () => {
      expect(parsePostsQuery({ page: ["2", "5"] }).page).toBe(2);
    });
  });

  describe("q", () => {
    it("前後の空白を落とす（全角空白も）", () => {
      expect(parsePostsQuery({ q: "  猫　" }).q).toBe("猫");
    });

    it("空白だけなら検索なしと同じ", () => {
      expect(parsePostsQuery({ q: "   " }).q).toBe("");
    });

    it("配列で来たら先頭を使う", () => {
      expect(parsePostsQuery({ q: ["猫", "犬"] }).q).toBe("猫");
    });
  });
});

describe("postsHref", () => {
  it("既定値のパラメータは省く", () => {
    expect(postsHref()).toBe("/posts");
    expect(postsHref({ q: "", sort: "recent", page: 1 })).toBe("/posts");
  });

  it("既定値以外だけを載せる", () => {
    expect(paramsOf(postsHref({ sort: "popular", page: 2 }))).toEqual({
      sort: "popular",
      page: "2",
    });
  });

  it.each(["猫 と 犬", "a&b=c", "#1", "100%", "C++", "?q=x"])(
    "検索語 %j は往復しても同じ語に戻る",
    (q) => {
      const query: PostsQuery = { q, sort: "popular", page: 3 };

      expect(parsePostsQuery(paramsOf(postsHref(query)))).toEqual(query);
    },
  );
});

describe("postsApiPath", () => {
  it("人気順は sort=popular を API に渡す", () => {
    // 並びの正しさは API（6-1 の request spec）の責務。フロントの責務は
    // popular を渡すことなので、ここが抜けると画面は「人気順」と表示したまま
    // 新着順が返る。
    expect(paramsOf(postsApiPath({ q: "", sort: "popular", page: 1 }))).toEqual({
      sort: "popular",
    });
  });

  it("新着順・1 ページ目・検索なしならクエリを付けない", () => {
    expect(postsApiPath({ q: "", sort: "recent", page: 1 })).toBe("/api/posts");
  });

  it("画面の URL と同じ条件を API に渡す", () => {
    const query: PostsQuery = { q: "猫", sort: "popular", page: 2 };

    expect(paramsOf(postsApiPath(query))).toEqual(paramsOf(postsHref(query)));
    expect(postsApiPath(query).startsWith("/api/posts?")).toBe(true);
  });
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/posts/posts-query.test.ts`
Expected: FAIL（`Failed to resolve import "@/lib/posts/posts-query"`）

- [ ] **Step 3: 実装する**

`frontend/src/lib/posts/posts-query.ts`：

```ts
/**
 * お題一覧の検索条件（q / sort / page）と URL の相互変換。
 *
 * 画面の URL（/posts?…）と API のパス（/api/posts?…）を同じ関数から作る。
 * 別々に組み立てると、並び替えの値を片方だけ変えたときに「画面は人気順と
 * 表示しているのに新着順が返る」ずれが起きるため。
 *
 * React も fetch も知らない純粋関数にしてあるので Vitest で検査できる。
 */

export type PostsSort = "recent" | "popular";

export type PostsQuery = { q: string; sort: PostsSort; page: number };

/** Next の page.tsx が受け取る searchParams の値の形。 */
export type RawSearchParams = Record<string, string | string[] | undefined>;

const DEFAULT_QUERY: PostsQuery = { q: "", sort: "recent", page: 1 };

/** ?sort=a&sort=b のように同じキーが重なると配列で来る。先頭を採る。 */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * URL から来る任意の値を正規化する。どんな入力でも例外を投げない
 * （URL は誰でも書けるので、壊れた値で画面ごと落とさない）。
 */
export function parsePostsQuery(params: RawSearchParams): PostsQuery {
  // String.prototype.trim は全角空白（U+3000）も落とす。
  const q = (first(params.q) ?? "").trim();

  // API も popular 以外はすべて新着順に扱う（Post.listing）。ここで同じ丸め方を
  // しておくと、並び替えトグルの「現在地」表示が API の実際の並びと一致する。
  const sort: PostsSort = first(params.sort) === "popular" ? "popular" : "recent";

  // Number() や parseInt() に任せない。Number("1e3") は 1000、parseInt("2.5") は 2 に
  // なり、書いていないページへ黙って飛ぶ。数字だけの文字列に限る。
  // 上限はサーバー（Paginating::MAX_PAGE）が丸めるので、ここでは見ない。
  // ただし安全な整数を超えると精度が落ちて別の値になるので、それは 1 に戻す。
  const rawPage = first(params.page) ?? "";
  const parsed = /^\d+$/.test(rawPage) ? Number(rawPage) : NaN;
  const page = Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : DEFAULT_QUERY.page;

  return { q, sort, page };
}

/** 既定値のパラメータを省いたクエリ文字列。/posts?page=1&sort=recent ではなく /posts にする。 */
function toSearch({ q, sort, page }: PostsQuery): string {
  const params = new URLSearchParams();
  if (q !== DEFAULT_QUERY.q) params.set("q", q);
  if (sort !== DEFAULT_QUERY.sort) params.set("sort", sort);
  if (page !== DEFAULT_QUERY.page) params.set("page", String(page));

  const search = params.toString();
  return search ? `?${search}` : "";
}

/** 画面の URL。省いた項目は既定値（検索なし・新着順・1 ページ目）になる。 */
export function postsHref(query: Partial<PostsQuery> = {}): string {
  return `/posts${toSearch({ ...DEFAULT_QUERY, ...query })}`;
}

/** API のパス。画面の URL と同じ規則で組み立てる。 */
export function postsApiPath(query: PostsQuery): string {
  return `/api/posts${toSearch(query)}`;
}
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/posts/posts-query.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: ミューテーションで、テストが実際に守っていることを確かめる**

一時的に `postsApiPath` の中身を `return "/api/posts";` に書き換えてテストを回し、**「人気順は sort=popular を API に渡す」と「画面の URL と同じ条件を API に渡す」が落ちる**ことを確認したら元に戻す。
同じく `parsePostsQuery` の `/^\d+$/.test(rawPage)` を `rawPage !== ""` に書き換え、`"2.5"` / `"1e3"` / `"0x10"` のケースが落ちることを確認して戻す。

Run: `docker compose exec frontend npx vitest run test/lib/posts/posts-query.test.ts`
Expected: 書き換え中は FAIL、戻したあと PASS。戻した内容が Step 3 のコードと一致していること

- [ ] **Step 6: 設計書の記述を実装に合わせる**

設計書の「`lib/posts/posts-query.ts`」節と「テスト」節は、`sort` と `page` の配列を「→ recent」「→ 1」と書いている。実装は 3 つとも「配列は先頭の値で判定」に揃えた（`q` だけ先頭を使うのは一貫しない）。

`docs/superpowers/specs/2026-09-23-issue-7-3a-posts-index-design.md` の該当行を次のように直す：

- `- \`sort\`：\`"popular"\` のときだけ popular、それ以外（不正値・配列・未指定）は recent` → `- \`sort\`：\`"popular"\` のときだけ popular、それ以外（不正値・未指定）は recent`
- `- 配列が来るのは \`?sort=a&sort=b\` のとき（Next の \`searchParams\` の型が \`string | string[]\`）` → `- 配列が来るのは \`?sort=a&sort=b\` のとき（Next の \`searchParams\` の型が \`string | string[]\`）。**3 つとも先頭の値で判定する**`
- テスト節の `- \`sort\`：不正値・配列・未指定 → recent、\`"popular"\` → popular` → `- \`sort\`：不正値・未指定 → recent、\`"popular"\` → popular、配列は先頭で判定`
- テスト節の `- \`page\`：\`"0"\` / \`"-1"\` / \`"abc"\` / \`"2.5"\` / \`""\` / 配列 → 1、\`"3"\` → 3` → `- \`page\`：\`"0"\` / \`"-1"\` / \`"abc"\` / \`"2.5"\` / \`""\` / \`"1e3"\` → 1、\`"3"\` → 3、配列は先頭で判定`

- [ ] **Step 7: 型と lint**

Run: `docker compose exec frontend npx tsc --noEmit && docker compose exec frontend npm run lint`
Expected: エラー 0

- [ ] **Step 8: コミット**

```bash
git add frontend/src/lib/posts/posts-query.ts frontend/test/lib/posts/posts-query.test.ts docs/superpowers/specs/2026-09-23-issue-7-3a-posts-index-design.md
git commit -m "feat: お題一覧の検索条件と URL の相互変換を足す

画面の URL と API のパスを同じ関数から作り、並び替えの値がずれないようにする。
page は数字だけの文字列に限る（Number(\"1e3\") が 1000 になるため）。

Refs #114

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Cloudinary の配信 URL ヘルパ（`lib/cloudinary.ts`）と環境変数

**Files:**
- Create: `frontend/src/lib/cloudinary.ts`
- Test: `frontend/test/lib/cloudinary.test.ts`
- Modify: `frontend/.env.example`（追記）
- ローカルのみ（コミットしない）：`frontend/.env.development` にキーを追記

**Interfaces:**
- Consumes: `process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`
- Produces（Task 4 が使う。7-3b・7-4・7-6 も使う）:
  - `export type CloudinaryAspect = "4:3" | "1:1"`
  - `export function cloudinaryUrl(publicId: string, options: { width: number; aspect: CloudinaryAspect }): string`
  - 例：`cloudinaryUrl("kotoe/production/posts/abc", { width: 640, aspect: "4:3" })` → `"https://res.cloudinary.com/<cloud>/image/upload/c_fill,ar_4:3,w_640,f_auto,q_auto/kotoe/production/posts/abc"`

- [ ] **Step 1: 失敗するテストを書く**

`frontend/test/lib/cloudinary.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cloudinaryUrl } from "@/lib/cloudinary";

const OPTIONS = { width: 640, aspect: "4:3" } as const;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "demo");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cloudinaryUrl", () => {
  it("変換つきの配信 URL を組み立てる", () => {
    expect(cloudinaryUrl("kotoe/production/posts/abc123", OPTIONS)).toBe(
      "https://res.cloudinary.com/demo/image/upload/c_fill,ar_4:3,w_640,f_auto,q_auto/kotoe/production/posts/abc123",
    );
  });

  it("縦横比と幅を変換に反映する", () => {
    expect(cloudinaryUrl("a/b", { width: 320, aspect: "1:1" })).toBe(
      "https://res.cloudinary.com/demo/image/upload/c_fill,ar_1:1,w_320,f_auto,q_auto/a/b",
    );
  });

  it("public_id の / はパスの区切りとして残し、各セグメントの ? # % はエンコードする", () => {
    // ? や # がそのまま残ると、そこから後ろがクエリ／フラグメントになって
    // Cloudinary に届く public_id が変わる。
    expect(cloudinaryUrl("kotoe/x?y#z%", OPTIONS)).toBe(
      "https://res.cloudinary.com/demo/image/upload/c_fill,ar_4:3,w_640,f_auto,q_auto/kotoe/x%3Fy%23z%25",
    );
  });

  it.each(["", "/a", "a/", "a//b", "a/./b", "a/../b", "..", "//evil.example/x", "https://evil.example/x"])(
    "空・. ・.. のセグメントを含む %j は受け付けない",
    (publicId) => {
      // encodeURIComponent は . と .. をそのまま残すので、URL の正規化で
      // パスが上へ辿られてしまう。エンコードでは無害化できないので拒否する。
      expect(() => cloudinaryUrl(publicId, OPTIONS)).toThrow();
    },
  );

  it("public_id にどんな文字列が来てもオリジンは res.cloudinary.com に固定される", () => {
    // src に入る値なので、javascript: や別オリジンになってはいけない（CLAUDE.md の XSS）。
    for (const publicId of ["javascript:alert(1)", "data:text/html,x", "a/b:c", "@evil.example"]) {
      expect(new URL(cloudinaryUrl(publicId, OPTIONS)).origin).toBe("https://res.cloudinary.com");
    }
  });

  it.each([0, -1, 1.5, Number.NaN])("幅 %j は受け付けない", (width) => {
    expect(() => cloudinaryUrl("a/b", { width, aspect: "4:3" })).toThrow();
  });

  it("cloud name が未設定なら例外を投げる（黙って壊れた URL を配らない）", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "");

    expect(() => cloudinaryUrl("a/b", OPTIONS)).toThrow("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME");
  });
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/cloudinary.test.ts`
Expected: FAIL（`Failed to resolve import "@/lib/cloudinary"`）

- [ ] **Step 3: 実装する**

`frontend/src/lib/cloudinary.ts`：

```ts
/**
 * Cloudinary の配信 URL を組み立てる。お題画像・生成画像の URL はすべてここを通す
 * （7-3a の一覧が最初。7-3b・7-4・7-6 が使い回す）。
 *
 * next/image を使わず <img> にこの URL を入れる。next/image の Vercel 最適化は
 * Cloudinary と二重に処理して 2 つの無料枠を両方消費し、カスタムローダーは
 * 幅ごとの srcset で変換数が約 8 倍になる。Cloudinary の無料枠は超過すると
 * 翌月まで全画像が止まるので、変換は 1 画像 1 サイズに抑える（設計書「決定 4」）。
 *
 * ダウンロード用の URL（WebP で保存しているため f_png + fl_attachment が要る。
 * 4-3 からの申し送り）は、使う issue（7-3b / 7-4）で足す。
 */

// 固定する。img の src に入る値なので、public_id がどんな文字列でも
// このオリジンの外へ出られないようにする（CLAUDE.md の XSS：href / src）。
const ORIGIN = "https://res.cloudinary.com";

/**
 * 縦横比はリテラル型に絞り、変換文字列を呼び出し側に書かせない。
 * 自由に書けると、呼び出しごとに少しずつ違う変換が生まれ、それぞれが
 * 別の派生画像として変換数を消費する。
 */
export type CloudinaryAspect = "4:3" | "1:1";

export function cloudinaryUrl(
  publicId: string,
  { width, aspect }: { width: number; aspect: CloudinaryAspect },
): string {
  // 関数の中で読む（モジュールの先頭で読まない）。Next は
  // process.env.NEXT_PUBLIC_* という字面をビルド時に値へ置き換えるので
  // どちらでも本番は動くが、中で読めばテストが vi.stubEnv で差し替えられる。
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (!cloudName) {
    throw new Error("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME が設定されていません");
  }

  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(`cloudinaryUrl: 幅は正の整数で指定してください（${width}）`);
  }

  // public_id は kotoe/<env>/posts/<id> のように / を含む。/ はパスの区切りとして
  // 残し、セグメントごとにエンコードする（? や # が残ると public_id が途中で切れる）。
  //
  // 空・. ・.. のセグメントは拒否する。encodeURIComponent はこれらをそのまま残すので、
  // URL の正規化でパスを上へ辿られる。バックエンドが発行する public_id には
  // 現れないので、来たらデータの異常として落とす。
  const segments = publicId.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("cloudinaryUrl: public_id の形式が不正です");
  }
  const path = segments.map(encodeURIComponent).join("/");

  // f_auto で配信形式（AVIF / WebP など）をブラウザに合わせ、q_auto で画質を自動にする。
  const transformation = `c_fill,ar_${aspect},w_${width},f_auto,q_auto`;

  return `${ORIGIN}/${encodeURIComponent(cloudName)}/image/upload/${transformation}/${path}`;
}
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/cloudinary.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: `.env.example` に追記する**

`frontend/.env.example` の `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000` の直後（「スマホ実機から」の節より前）に足す：

```bash

# Cloudinary の cloud name。お題画像・生成画像の配信 URL を組み立てるのに使う（issue 7-3a）。
# 配信 URL に必ず現れる公開値なので NEXT_PUBLIC_ でよい。API キー・シークレットは
# Rails だけが持つ（backend/.env.development の CLOUDINARY_URL）。値はその
# cloudinary://<api_key>:<api_secret>@<cloud_name> の @ より後ろと同じ。
#
# Vercel では Production と Preview の両方に設定すること。NEXT_PUBLIC_ はビルド時に
# 埋め込まれるので、未設定のままビルドされると一覧の描画で例外になる。
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=
```

- [ ] **Step 6: ローカルの `frontend/.env.development` にキーを足す（値を表示しない）**

`backend/.env.development` の `CLOUDINARY_URL` から `@` より後ろだけを取り出して追記する。**値を画面に出さないこと**（`echo` / `cat` をしない）。

```bash
grep -q '^NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=' frontend/.env.development || {
  name=$(grep '^CLOUDINARY_URL=' backend/.env.development | sed -E 's#^[^@]*@([^/?]+).*$#\1#')
  if [ -n "$name" ] && [ "$name" != "$(grep '^CLOUDINARY_URL=' backend/.env.development)" ]; then
    printf '\nNEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=%s\n' "$name" >> frontend/.env.development
  else
    echo "CLOUDINARY_URL から cloud name を取り出せませんでした。手で追記してください"
  fi
}
grep -o '^[A-Z_]*=' frontend/.env.development
```

Expected: 最後の行の出力に `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=` が含まれる（値は出ない）。取り出せなかった場合はユーザーに手での追記を頼む。

`env_file` の変更は `restart` では反映されないので作り直す：

```bash
docker compose up -d frontend
```

- [ ] **Step 7: 型と lint**

Run: `docker compose exec frontend npx tsc --noEmit && docker compose exec frontend npm run lint`
Expected: エラー 0

- [ ] **Step 8: コミット（`.env.development` は含めない）**

```bash
git add frontend/src/lib/cloudinary.ts frontend/test/lib/cloudinary.test.ts frontend/.env.example
git status --short   # frontend/.env.development が出ないこと（gitignore 済み）
git commit -m "feat: Cloudinary の配信 URL を組み立てるヘルパを足す

next/image を使わず 1 画像 1 サイズの変換 URL にする（無料枠の変換数を抑えるため）。
オリジンを固定し、. と .. のセグメントを拒否して src に入れても安全な形にする。

Refs #114

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `/posts` ページ（型・カード・検索・並び替え・ページ送り・一覧）

**Files:**
- Modify: `frontend/src/types/api.ts`（末尾に追加）
- Create: `frontend/src/components/posts/post-card.tsx`
- Create: `frontend/src/components/posts/post-search-form.tsx`
- Create: `frontend/src/components/posts/post-sort-toggle.tsx`
- Create: `frontend/src/components/posts/pagination.tsx`
- Create: `frontend/src/components/posts/post-list.tsx`
- Create: `frontend/src/app/posts/page.tsx`
- Modify: `frontend/src/app/layout.tsx:21-24`（`metadata.title`）

**Interfaces:**
- Consumes:
  - `toRequestErrorMessage(error: unknown): string`（Task 1）
  - `PostsQuery` / `PostsSort` / `RawSearchParams` / `parsePostsQuery` / `postsHref` / `postsApiPath`（Task 2）
  - `cloudinaryUrl(publicId, { width, aspect })`（Task 3）
  - `apiFetch<T>(path, init?)`（`@/lib/api`。既存。`init.signal` は timeout と合成される）
  - `buttonClasses({ variant?, size? })`（`@/components/ui/button`。既存。文字サイズは持たない）
- Produces:
  - `/posts` ルート
  - 型 `PublicUser` / `PostSummary` / `PaginationMeta` / `PostsIndexResponse`（7-3b・7-6 も使う）
  - `PostCard({ post })`（7-3b がここを `<Link>` で包む）

このタスクはコンポーネントだけなので Vitest は書かない（CLAUDE.md のテスト方針）。検証は型・lint・本番ビルド・実物で行う。

- [ ] **Step 1: API の型を足す**

`frontend/src/types/api.ts` の末尾に追加：

```ts
/** 他人に見せるユーザーの表現（UserSerializer.public_profile）。email を含まない。 */
export type PublicUser = {
  id: number;
  name: string;
};

/**
 * お題 1 件（PostSerializer）。一覧・詳細・作成の応答で共通。
 * attempts_count / likes_count は公開済みの挑戦だけを数えた値。
 */
export type PostSummary = {
  id: number;
  title: string;
  /** Cloudinary の public_id。表示には必ず cloudinaryUrl() を通す */
  image_public_id: string;
  user: PublicUser;
  attempts_count: number;
  likes_count: number;
  /** リクエストした本人がお気に入り済みか。未ログインなら常に false。一覧では描画しない */
  favorited: boolean;
  /** ISO 8601（UTC） */
  created_at: string;
};

/** kaminari のページ情報（PaginationSerializer）。1 ページの件数はサーバーが 12 に固定している。 */
export type PaginationMeta = {
  current_page: number;
  total_pages: number;
  total_count: number;
};

/** GET /api/posts */
export type PostsIndexResponse = {
  posts: PostSummary[];
  meta: PaginationMeta;
};
```

- [ ] **Step 2: カードを作る**

`frontend/src/components/posts/post-card.tsx`：

```tsx
import { cloudinaryUrl } from "@/lib/cloudinary";
import type { PostSummary } from "@/types/api";

// カードは最大 3 列・幅 320px 程度。Retina でも 640px の 1 本で足りる。
// 幅を増やすと派生画像が増えて Cloudinary の変換数を消費する（設計書「決定 4」）。
const THUMBNAIL_WIDTH = 640;

export function PostCard({ post }: { post: PostSummary }) {
  // 7-3b：この <article> を <Link href={`/posts/${post.id}`}> で包む。
  // /posts/[id] が実在しないうちにリンクにすると、main を追跡している本番で 404 になる。
  return (
    <article className="overflow-hidden rounded-card border border-line bg-surface">
      {/*
        next/image ではなく <img>。変換は cloudinaryUrl() が Cloudinary 側で済ませており、
        next/image を通すと Vercel の最適化枠まで消費する（設計書「決定 4」）。
        alt のタイトルは公開 UGC だが、属性値も React がエスケープする。
      */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={cloudinaryUrl(post.image_public_id, { width: THUMBNAIL_WIDTH, aspect: "4:3" })}
        alt={post.title}
        loading="lazy"
        className="aspect-4/3 w-full bg-line object-cover"
      />
      <div className="p-4">
        {/*
          公開 UGC。{value} のまま置く（React が自動でエスケープする）。
          wrap-break-word は、空白を含まない長い英数字のタイトルがカードの外へはみ出さないため。
        */}
        <h2 className="line-clamp-2 font-semibold wrap-break-word text-ink">{post.title}</h2>
        <p className="mt-1 truncate text-sm text-ink-muted">{post.user.name}</p>
        <dl className="mt-3 flex gap-4 text-sm text-ink-muted">
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
    </article>
  );
}
```

- [ ] **Step 3: 検索フォームを作る**

`frontend/src/components/posts/post-search-form.tsx`：

```tsx
import Form from "next/form";

import { buttonClasses } from "@/components/ui/button";
import type { PostsQuery } from "@/lib/posts/posts-query";

/**
 * 送信で検索する（入力に合わせた自動検索はしない。設計書「決定 3」）。
 *
 * next/form の <Form> は action が文字列なら GET フォームをクライアント遷移に変える。
 * ハイドレーション前でも普通の GET フォームとして /posts?q=… へ飛ぶので、
 * JS が動く前に押されても壊れない。
 *
 * page は送らない（検索し直したら 1 ページ目に戻す）。sort は hidden で引き継ぐ。
 */
export function PostSearchForm({ query }: { query: PostsQuery }) {
  return (
    <Form action="/posts" role="search" className="flex w-full gap-2 sm:max-w-md">
      <label htmlFor="posts-search" className="sr-only">
        お題をタイトルで検索
      </label>
      {/*
        key に q を渡す。defaultValue は初回しか効かないので、「検索をクリア」や
        戻るボタンで q が変わったときに入力欄を作り直して URL と揃える。
      */}
      <input
        key={query.q}
        id="posts-search"
        name="q"
        type="search"
        defaultValue={query.q}
        placeholder="タイトルで検索"
        className="min-w-0 flex-1 rounded-card border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
      />
      {query.sort !== "recent" && <input type="hidden" name="sort" value={query.sort} />}
      <button type="submit" className={buttonClasses()}>
        検索
      </button>
    </Form>
  );
}
```

- [ ] **Step 4: 並び替えトグルを作る**

`frontend/src/components/posts/post-sort-toggle.tsx`：

```tsx
import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";
import { postsHref, type PostsQuery, type PostsSort } from "@/lib/posts/posts-query";

const SORT_OPTIONS: { sort: PostsSort; label: string }[] = [
  { sort: "recent", label: "新着順" },
  { sort: "popular", label: "人気順" },
];

/**
 * 並び替えは <Link>。状態を URL にだけ持たせるので、リロードや戻るボタンで
 * 並びが保たれる。切り替えたら 1 ページ目に戻す（page を渡さない）。
 * 別の並びの 3 ページ目は、元の 3 ページ目とは無関係な内容になるため。
 */
export function PostSortToggle({ query }: { query: PostsQuery }) {
  return (
    <nav aria-label="並び替え" className="flex gap-2">
      {SORT_OPTIONS.map(({ sort, label }) => {
        const active = query.sort === sort;
        return (
          <Link
            key={sort}
            href={postsHref({ q: query.q, sort })}
            aria-current={active ? "page" : undefined}
            className={`${buttonClasses({ variant: active ? "primary" : "secondary", size: "sm" })} text-sm`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 5: ページ送りを作る**

`frontend/src/components/posts/pagination.tsx`：

```tsx
import Link from "next/link";

import { buttonClasses } from "@/components/ui/button";
import { postsHref, type PostsQuery } from "@/lib/posts/posts-query";

/**
 * 「前へ｜2 / 5｜次へ」。番号の列は作らない（設計書「決定 5」）。
 *
 * 端では <Link> を出さず <span aria-disabled> にする。<Link> には disabled が無く、
 * 見た目だけ薄くしても押せてしまうため。範囲外のページ（?page=99）では
 * 呼び出し側がこの部品を描画しない。
 */
export function Pagination({ query, totalPages }: { query: PostsQuery; totalPages: number }) {
  if (totalPages <= 1) return null;

  const { page } = query;
  const linkClass = `${buttonClasses({ variant: "secondary", size: "sm" })} text-sm`;
  const disabledClass = `${linkClass} pointer-events-none opacity-60`;

  return (
    <nav aria-label="ページ送り" className="flex items-center justify-center gap-4">
      {page > 1 ? (
        <Link href={postsHref({ ...query, page: page - 1 })} className={linkClass}>
          前へ
        </Link>
      ) : (
        <span aria-disabled="true" className={disabledClass}>
          前へ
        </span>
      )}

      <span className="text-sm text-ink-muted" aria-current="page">
        {page} / {totalPages}
      </span>

      {page < totalPages ? (
        <Link href={postsHref({ ...query, page: page + 1 })} className={linkClass}>
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

- [ ] **Step 6: 一覧（取得と状態の出し分け）を作る**

`frontend/src/components/posts/post-list.tsx`：

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Pagination } from "@/components/posts/pagination";
import { PostCard } from "@/components/posts/post-card";
import { PostSearchForm } from "@/components/posts/post-search-form";
import { PostSortToggle } from "@/components/posts/post-sort-toggle";
import { buttonClasses } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { postsApiPath, postsHref, type PostsQuery } from "@/lib/posts/posts-query";
import { toRequestErrorMessage } from "@/lib/request-error-messages";
import type { PostsIndexResponse } from "@/types/api";

const SKELETON_COUNT = 12; // サーバーの 1 ページの件数と同じ。レイアウトが跳ねないように

type Outcome =
  | { kind: "success"; data: PostsIndexResponse }
  | { kind: "error"; message: string };

/**
 * お題一覧。取得はクライアントで行う（設計書「決定 1」）。
 *
 * 結果は「どのリクエストに対する結果か」を表す key と一緒に持ち、今の key と
 * 一致しないものは表示しない（＝取得中として扱う）。effect の中で同期的に
 * setState({ kind: "loading" }) を呼ぶ形にしないのは 2 つの理由から。
 *   1. eslint-plugin-react-hooks 7 の set-state-in-effect に当たる
 *   2. 並び替えを素早く切り替えたとき、古いクエリの応答が後から届いても
 *      key が違うので画面に出ない（cleanup の abort が間に合わなかった場合の保険）
 *
 * 一覧 API は認証不要で、期限切れのトークンを付けても 200 を返す（2026-09-23 実測）。
 * そのため auth.status の確定を待たずに取得を始めてよい。
 */
export function PostList({ query }: { query: PostsQuery }) {
  const apiPath = postsApiPath(query);
  const [retryCount, setRetryCount] = useState(0);
  const requestKey = `${apiPath}#${retryCount}`;
  const [result, setResult] = useState<{ key: string; outcome: Outcome } | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    apiFetch<PostsIndexResponse>(apiPath, { signal: controller.signal })
      .then((data) => setResult({ key: requestKey, outcome: { kind: "success", data } }))
      .catch((error: unknown) => {
        // 自分で中断した（クエリが変わった／アンマウントした）ものは失敗ではない。
        if (controller.signal.aborted) return;
        setResult({
          key: requestKey,
          outcome: { kind: "error", message: toRequestErrorMessage(error) },
        });
      });

    return () => controller.abort();
  }, [apiPath, requestKey]);

  const outcome = result?.key === requestKey ? result.outcome : null;

  return (
    <div className="mt-6 flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <PostSearchForm query={query} />
        <PostSortToggle query={query} />
      </div>

      {outcome === null && <PostGridSkeleton />}

      {outcome?.kind === "error" && (
        <div className="flex flex-col items-center gap-4 rounded-card border border-line bg-surface p-8 text-center">
          <p className="text-ink">{outcome.message}</p>
          <button
            type="button"
            onClick={() => setRetryCount((count) => count + 1)}
            className={buttonClasses({ variant: "secondary" })}
          >
            再試行
          </button>
        </div>
      )}

      {outcome?.kind === "success" && <PostResults query={query} data={outcome.data} />}
    </div>
  );
}

function PostGridSkeleton() {
  return (
    <ul
      aria-busy="true"
      aria-label="読み込み中"
      className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
    >
      {Array.from({ length: SKELETON_COUNT }, (_, index) => (
        <li key={index} className="overflow-hidden rounded-card border border-line bg-surface">
          <div className="aspect-4/3 w-full animate-pulse bg-line" />
          <div className="flex flex-col gap-2 p-4">
            <div className="h-5 w-3/4 animate-pulse rounded bg-line" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-line" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function PostResults({ query, data }: { query: PostsQuery; data: PostsIndexResponse }) {
  const { posts, meta } = data;

  // 範囲外のページ（?page=99）。posts は空だが、お題自体は存在する。
  // 「お題がありません」と出すと嘘になるので分ける。
  if (posts.length === 0 && meta.total_count > 0) {
    return (
      <EmptyState message="このページにはお題がありません">
        <Link href={postsHref({ ...query, page: 1 })} className="text-accent hover:text-accent-strong">
          1 ページ目へ
        </Link>
      </EmptyState>
    );
  }

  if (posts.length === 0 && query.q !== "") {
    return (
      // 検索語は公開 UGC ではないが URL から誰でも書ける値。{value} のまま置く。
      <EmptyState message={`「${query.q}」に一致するお題はありません。条件を変えて探してみましょう`}>
        <Link href={postsHref({ sort: query.sort })} className="text-accent hover:text-accent-strong">
          検索をクリア
        </Link>
      </EmptyState>
    );
  }

  if (posts.length === 0) {
    // 投稿への導線は置かない。/posts/new は 7-5 で作る（存在しないルートにリンクしない）。
    return <EmptyState message="まだお題がありません" />;
  }

  return (
    <>
      <p className="text-sm text-ink-muted">全 {meta.total_count} 件</p>
      <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <li key={post.id}>
            <PostCard post={post} />
          </li>
        ))}
      </ul>
      <Pagination query={query} totalPages={meta.total_pages} />
    </>
  );
}

function EmptyState({ message, children }: { message: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface p-10 text-center">
      <p className="wrap-break-word text-ink-muted">{message}</p>
      {children}
    </div>
  );
}
```

- [ ] **Step 7: ルートを作る**

`frontend/src/app/posts/page.tsx`：

```tsx
import type { Metadata } from "next";

import { PostList } from "@/components/posts/post-list";
import { parsePostsQuery, type RawSearchParams } from "@/lib/posts/posts-query";

export const metadata: Metadata = {
  title: "お題を探す",
};

/**
 * サーバーコンポーネントのまま、searchParams を正規化して渡すだけにする。
 * 取得はしない（Render がスリープしていると HTML ごと最大約 60 秒待たされるため。
 * 設計書「決定 1」）。
 *
 * useSearchParams() ではなく searchParams prop を使う。前者は <Suspense> 境界を
 * 要求し、ローカルでは通るのに Vercel の本番ビルドだけ落ちる（7-2 の規約）。
 * 同じ /posts のクエリだけが変わる <Link> 遷移でもこのコンポーネントが再描画され、
 * 新しい query が PostList に降りる。
 */
export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const query = parsePostsQuery(await searchParams);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">お題を探す</h1>
      <PostList query={query} />
    </main>
  );
}
```

- [ ] **Step 8: タブ名を template 形式にする**

`frontend/src/app/layout.tsx` の `metadata`：

```tsx
export const metadata: Metadata = {
  // 各ページが title を持つと「お題を探す | Kotoe（言絵）」になる。
  // title を持たないページ（トップ・ログインなど）は default のまま。
  title: {
    default: "Kotoe（言絵）",
    template: "%s | Kotoe（言絵）",
  },
  description: "画像を言葉だけで描写し、その言葉から AI が再現した画像の再現度を競う Web アプリ",
};
```

- [ ] **Step 9: 型・lint・テスト全体**

Run:
```bash
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run lint
docker compose exec frontend npm test
```
Expected: 型エラー 0、lint エラー・警告 0（`@next/next/no-img-element` は抑えた 1 行だけ。他に警告が出たら直す）、テスト全件 PASS

- [ ] **Step 10: 本番ビルドが通ることを確かめる**

`useSearchParams()` を使っていないことと、`/posts` が動的ルートとしてビルドされることを確かめる（ローカルでは通るのに Vercel だけ落ちる事故を先に潰す）。

```bash
docker compose exec frontend sh -c 'grep -rn "useSearchParams" src || echo "useSearchParams なし"'
docker compose exec frontend sh -c 'NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=demo npx next build 2>&1 | tail -25'
```

Expected: 1 行目は `useSearchParams なし`。ビルドは成功し、ルート一覧で `/posts` が `ƒ`（Dynamic）になる。

ビルドは `.next` を上書きするので、dev サーバーのキャッシュを作り直す（`frontend/AGENTS.md`）：

```bash
docker compose exec frontend rm -rf .next && docker compose restart frontend
```

- [ ] **Step 11: 実物で最低限の表示を確かめる**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/posts
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3001/posts?page=abc&sort=x"
```

Expected: どちらも `200`。ブラウザで `http://localhost:3001/posts` を開き、カードに画像・タイトル・投稿者・挑戦数・いいね数が出ること（詳しい確認は Task 6）。

- [ ] **Step 12: コミット**

```bash
git add frontend/src/types/api.ts frontend/src/components/posts frontend/src/app/posts frontend/src/app/layout.tsx
git commit -m "feat: お題一覧ページ（/posts）を足す

検索・新着／人気の並び替え・ページ送りを URL にだけ持たせ、取得はクライアントで行う。
結果は key 付きで持ち、古いクエリの応答が新しい結果を上書きしないようにする。
カードは /posts/[id]（7-3b）が実在するまでリンクにしない。

Refs #114

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: ナビの「探す」とトップの CTA「お題を探す」

**Files:**
- Modify: `frontend/src/components/layout/site-header.tsx:26-38`（ロゴまわり）
- Modify: `frontend/src/app/page.tsx:62-81`（CTA）

**Interfaces:**
- Consumes: `/posts` ルート（Task 4）、`buttonClasses()`（既存）
- Produces: なし

- [ ] **Step 1: ヘッダーに「探す」を足す**

`frontend/src/components/layout/site-header.tsx` のロゴの `<Link>` と、その下の中央リンクのコメントを、次の `<div>` に置き換える（`justify-between` の左側を 1 かたまりにする）：

```tsx
        <div className="flex items-center gap-6">
          <Link href="/" className="text-lg font-semibold tracking-tight text-ink">
            Kotoe
          </Link>

          {/*
            ナビのリンクは、そのルートを作る issue がここに足す。
            7-5:「お題を投稿」→ /posts/new ／ 7-6: アバター → /mypage ／
            7-7:「ランキング」→ /rankings。
            main は Vercel の本番を追跡するので、存在しないルートへのリンクは置かない
            （置いた瞬間に本番で 404 になる）。

            「探す」は認証状態に関係なく出す。一覧は誰でも見られる。
          */}
          <nav aria-label="メイン" className="flex items-center gap-4 text-sm">
            <Link href="/posts" className="text-ink-muted hover:text-ink">
              探す
            </Link>
          </nav>
        </div>
```

- [ ] **Step 2: トップに CTA を足す**

`frontend/src/app/page.tsx` の CTA のコメントとブロックを次に置き換える：

```tsx
        {/*
          CTA もナビと同じ方針で、実在するルートだけを出す。
          「お題を投稿」→ /posts/new は 7-5 がここに足す。

          「お題を探す」は認証状態に関係なく出す（一覧は誰でも見られる）。
          これが主役なので primary にし、新規登録・ログインは secondary に下げる。
          primary が 2 つ並ぶと、どちらを押せばよいのかが分からなくなるため。
        */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/posts" className={buttonClasses({ size: "lg" })}>
            お題を探す
          </Link>
          {auth.status === "unauthenticated" && (
            <>
              <Link href="/signup" className={buttonClasses({ variant: "secondary", size: "lg" })}>
                新規登録
              </Link>
              <Link href="/login" className={buttonClasses({ variant: "secondary", size: "lg" })}>
                ログイン
              </Link>
            </>
          )}
        </div>
```

- [ ] **Step 3: 存在しないルートへのリンクが無いことを確かめる**

```bash
docker compose exec frontend sh -c 'grep -rnoE "href=\"/[^\"]*\"" src | sort -u'
docker compose exec frontend sh -c 'grep -rnE "\"/(posts/|mypage|rankings)" src || echo "未作成ルートへのリンクなし"'
```

Expected: 1 つ目に出るパスが `/`・`/login`・`/signup`・`/posts` だけ（並び替え・ページ送りは `postsHref()` 経由なのでここには出ない）。2 つ目は `未作成ルートへのリンクなし`（`PostCard` のコメント内の `/posts/${post.id}` はバッククォートなので一致しない）。

- [ ] **Step 4: 型と lint**

Run: `docker compose exec frontend npx tsc --noEmit && docker compose exec frontend npm run lint`
Expected: エラー 0

- [ ] **Step 5: 実物を見る**

ブラウザで `http://localhost:3001/` を開き、ログアウト状態とログイン状態の両方で確かめる：

- ヘッダーに「探す」が出て、押すと `/posts` に移る
- トップの「お題を探す」が常に出る。未ログインのときだけ、その隣に「新規登録」「ログイン」（secondary）が出る
- スマホ幅（DevTools で 375px）でヘッダーが 1 行に収まる

- [ ] **Step 6: コミット**

```bash
git add frontend/src/components/layout/site-header.tsx frontend/src/app/page.tsx
git commit -m "feat: ナビの「探す」とトップの CTA「お題を探す」を足す

/posts が実在するようになったので、7-2.7 から持ち越していた 2 つを置く。
トップは「お題を探す」を主役にし、新規登録・ログインを secondary に下げる。

Refs #114

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 実物での確認・ドキュメント・レビュー・PR

**Files:**
- Modify: `docs/issues_backlog.md`（7-3a・7-3b・8-5）

**Interfaces:**
- Consumes: Task 1〜5 の成果すべて
- Produces: PR（`Closes #114`）

- [ ] **Step 1: 確認用のデータを作る（ローカルの DB だけ）**

ページ送り（13 件以上）と、「人気順と新着順が逆の並びになる」状態を作る。既存のお題（いいねが付いている）を**古い側**に残し、いいね 0 件の新しいお題を 14 件足す。画像は既存のお題の `public_id` を使い回す（Cloudinary にアップロードしない）。長いタイトルも 1 件入れる。

```bash
docker compose exec -T backend bin/rails runner '
source = Post.kept.order(:created_at).first or abort("お題が 1 件もありません")
14.times do |i|
  Post.create!(user: source.user, title: "[7-3a確認] 新しいお題 #{i + 1}", image_public_id: source.image_public_id)
end
Post.create!(user: source.user, title: "[7-3a確認] " + ("A" * 80), image_public_id: source.image_public_id)
puts "kept posts: #{Post.kept.count}"
'
```

Expected: `kept posts: 18` 前後（元の件数＋15）

- [ ] **Step 2: 手動確認（全部に ✓ が付くまで先に進まない）**

`http://localhost:3001/posts` で確かめる。

- [ ] 新着順の 1 ページ目に `[7-3a確認]` のお題が並ぶ。人気順に切り替えると、いいねの付いた古いお題が先頭に来る（**並びが入れ替わる**ことで、`sort` が API に届いていると分かる）
- [ ] 「全 N 件」が出る。「次へ」で 2 ページ目、「前へ」で戻る。1 ページ目の「前へ」、最終ページの「次へ」は押せない
- [ ] 人気順の 2 ページ目で「新着順」を押すと、新着順の **1 ページ目**になる
- [ ] 「確認」で検索すると `[7-3a確認]` のお題だけが出て 1 ページ目に戻る。人気順で検索すると `sort=popular` が URL に残る
- [ ] 一致しない語（`zzzz`）で「『zzzz』に一致するお題はありません…」と「検索をクリア」が出る。クリアすると入力欄も空になる
- [ ] 検索語に `a&b#c 100%` を入れて検索 → リロードしても入力欄と結果が同じ
- [ ] **日本語 IME**で「ねこ」と打ち、変換確定の Enter で**検索が走らない**（もう一度 Enter で走る）
- [ ] 各操作のあと**リロード**と**戻るボタン**で状態が戻る
- [ ] `/posts?page=2&sort=popular` を**アドレスバーに直接入れて**開く（`<Link>` 遷移だけではハイドレーション経路を確かめられない）
- [ ] `/posts?page=99` → 「このページにはお題がありません」と「1 ページ目へ」。`/posts?page=abc&sort=x` → 新着順の 1 ページ目
- [ ] 80 文字の `A…` のタイトルがカードからはみ出さない（2 行で省略される）
- [ ] DevTools の Network を **Slow 4G** にして「新着順」「人気順」を素早く交互に 5 回押す → 最後に押した並びが表示される
- [ ] `docker compose pause backend` → 再読み込み → 約 15 秒後に「サーバーの応答がありません。起動中の可能性が…」と「再試行」。`docker compose unpause backend` のあと「再試行」で一覧が出る（`stop` にしないこと。即座に通信断になりタイムアウトの経路を通らない）
- [ ] ログイン済みと未ログインで、一覧の表示が同じ
- [ ] スマホ幅（375px）でカードが 1 列、640px 以上で 2 列、1024px 以上で 3 列
- [ ] タブ名が「お題を探す | Kotoe（言絵）」、トップは「Kotoe（言絵）」のまま

- [ ] **Step 3: 確認用のデータを片づける（物理削除しない）**

```bash
docker compose exec -T backend bin/rails runner '
Post.kept.where("title LIKE ?", "[7-3a確認]%").find_each(&:discard!)
puts "kept posts: #{Post.kept.count}"
'
```

Expected: Step 1 の前の件数に戻る

- [ ] **Step 4: backlog を更新する**

`docs/issues_backlog.md`：

1. 7-3a の見出しの下（`- 依存：` の行の後）に設計書と完了の記録を足す：

```markdown
- 設計書：`docs/superpowers/specs/2026-09-23-issue-7-3a-posts-index-design.md`
- **7-3a で決めたこと（7-3b 以降が乗る前提）**：
  - 一覧の取得は**クライアント**（`useEffect` ＋ `apiFetch`）。`page.tsx` は `searchParams` を
    `parsePostsQuery()` で正規化して渡すだけ。状態は URL だけに持つ（`postsHref()` で組み立てる）
  - 画像は **`<img>` ＋ `cloudinaryUrl()`**。`next/image` は使わない（Cloudinary と Vercel の
    無料枠を二重に消費し、カスタムローダーは変換数が約 8 倍になるため）。幅は 1 画像 1 サイズ
  - 通信エラーの文言は `src/lib/request-error-messages.ts`（`toRequestErrorMessage()`）
  - 型 `PostSummary` / `PaginationMeta` / `PostsIndexResponse` は `src/types/api.ts`
```

2. 7-3b の箇条書きの末尾に申し送りを足す：

```markdown
- **7-3a からの申し送り**：
  - **カードを `<Link href={`/posts/${post.id}`}>` で包む**（`PostCard` にコメントで場所がある）。
    7-3a は `/posts/[id]` が存在しないのでリンクにしていない
  - 画像は `cloudinaryUrl(publicId, { width, aspect })` を使う。ダウンロード URL
    （`f_png` + `fl_attachment`）は 7-3b で足す（4-3 からの申し送り）
  - **`components/dev/health-panel.tsx` のトースト確認用ボタンを削除する**。7-3b が
    トーストの最初の実利用になるため（7-2.5 からの持ち越し）
```

3. 8-5 の「`img-src` に Cloudinary が要る → **7-3a**（お題画像の表示）で確定」の行を次にする：

```markdown
  - `img-src` に Cloudinary が要る → **7-3a で確定：`https://res.cloudinary.com`**
    （`src/lib/cloudinary.ts` がオリジンを固定している）
```

- [ ] **Step 5: 全体の検証**

```bash
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run lint
docker compose exec frontend npm test
```

Expected: すべてエラー 0・全件 PASS。`backend/` は変更していないので rspec / rubocop は CI に任せる（`git diff --stat main -- backend` が空であることを確かめる）

```bash
git diff --stat main -- backend
```

Expected: 出力なし

- [ ] **Step 6: コミット**

```bash
git add docs/issues_backlog.md
git commit -m "docs: 7-3a の決定事項と 7-3b への申し送りを backlog に記録する

Refs #114

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: プッシュ前にコードレビューを通す**

プッシュ前に `/code-review` を回す（自己レビューでは自分の前提を疑えない）。指摘は `superpowers:receiving-code-review` に沿って検証してから直し、直したものはタスクごとの規約どおりにコミットする。

- [ ] **Step 8: Vercel の環境変数をユーザーに設定してもらう（マージの前提）**

`NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` を Vercel の **Production と Preview の両方**に設定してもらう（値はユーザーが持っている。こちらでは扱わない）。**プッシュより前に Preview に入っていないと、PR のプレビュー URL で一覧が落ちる。** 設定済みかユーザーに確認してから次へ進む。

- [ ] **Step 9: プッシュして PR を出す**

```bash
git push -u origin feat/posts-index
gh pr create --title "7-3a. お題一覧・検索（/posts）" --body "$(cat <<'EOF'
## 概要

`/posts` でお題を検索・並び替え・ページ送りして探せるようにした。後続の 7-3b・7-4・7-6 が使う Cloudinary の URL ヘルパと、ナビの「探す」／トップの CTA「お題を探す」も足した。

設計書：`docs/superpowers/specs/2026-09-23-issue-7-3a-posts-index-design.md`

## 決めたこと

- 取得は**クライアント**で行う（Render がスリープしていても、画面はすぐ出てスケルトンになる）
- 状態は **URL だけ**に持つ（`/posts?q=…&sort=popular&page=2`）。検索は `next/form`、並び替えとページ送りは `<Link>`
- 画像は **`<img>` ＋ Cloudinary の変換 URL**（`next/image` を使わない。無料枠の変換数を抑えるため）
- カードは `/posts/[id]` が実在する 7-3b まで**リンクにしない**（本番で 404 を出さないため）
- 通信エラーの文言を `lib/request-error-messages.ts` に切り出した（auth と共有）

## 見た目が変わるところ

- ヘッダーに「探す」
- トップ：「お題を探す」（primary）を常に出す。未ログインのときの「新規登録」は secondary に下げた

## マージ前のチェックリスト

- [ ] Vercel の **Production と Preview** に `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` を設定した（未設定のままビルドされると一覧の描画が例外になる）
- [ ] プレビュー URL の `/posts` で画像が表示される
- [ ] CI（rubocop / rspec / frontend）が green

## 確認したこと

- Vitest：posts-query / cloudinary / request-error-messages（既存の auth のテストは無変更で通過）
- 手動：並び替えの入れ替わり、ページ送り、検索（記号・IME）、リロード／戻る、直接ロード、範囲外ページ、タイムアウト（`docker compose pause backend`）、スマホ幅

Closes #114

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 10: プレビュー URL で確認する**

PR に付いた Vercel のプレビュー URL で `/posts` を開き、画像が表示されること・検索と並び替えが動くことを確かめ、PR のチェックリストを埋める。

---

## Self-Review（記入済み）

**1. 設計書の網羅：**

| 設計書の節 | タスク |
|---|---|
| 決定 1（クライアント取得） | 4（`PostList` の effect、`page.tsx` は取得しない） |
| 決定 2（状態は URL だけ） | 2（`postsHref` / `parsePostsQuery`）、4（`<Form>` / `<Link>`） |
| 決定 3（送信で検索） | 4（`PostSearchForm`）、6（IME の確認） |
| 決定 4（`<img>` ＋変換 URL） | 3（`cloudinaryUrl`）、4（`PostCard`） |
| 決定 5（前へ｜n / N｜次へ） | 4（`Pagination`） |
| 決定 6（カードはリンクにしない） | 4（`PostCard` のコメント）、5（Step 3 の grep）、6（backlog の申し送り） |
| 決定 7（文言の切り出し） | 1 |
| 画面の状態（6 種） | 4（`PostList` / `PostResults`）、6（手動確認） |
| ナビと CTA | 5 |
| メタデータ | 4（Step 7・8） |
| XSS | 3（オリジン固定のテスト）、4（`{value}` のみ）、Global Constraints |
| テスト | 1・2・3 |
| 手動確認 | 6 |
| 環境変数とリリース | 3（`.env.example`・ローカル）、6（Vercel・PR チェックリスト） |
| ドキュメントの後始末 | 2（設計書の記述）、6（backlog） |

**2. プレースホルダ：** なし（コードを伴う手順はすべてコードを載せた）。

**3. 型の一貫性：** `PostsQuery` / `PostsSort` / `RawSearchParams` / `parsePostsQuery` / `postsHref` / `postsApiPath`（Task 2 で定義 → Task 4 で使用）、`cloudinaryUrl` / `CloudinaryAspect`（Task 3 → 4）、`toRequestErrorMessage`（Task 1 → 4）、`PostSummary` / `PaginationMeta` / `PostsIndexResponse`（Task 4 Step 1 → Step 2・6）。名前と引数の形が一致していることを確認した。

**4. Review Focus：** 5 項目すべてに、確認を持つタスクを割り当てた（1 → Task 6、2 → Task 4・6、3 → Task 2、4 → Task 4・6、5 → Task 3・6）。

**設計書からの意図的な差分（1 件）：** 設計書は「既存の『新規登録／ログイン』は今まで通り」と書いているが、Task 5 で「新規登録」を secondary に下げた。「お題を探す」を常時 primary で出すと、未ログイン時に primary が 2 つ並ぶため。ユーザーの確認を取ること。
