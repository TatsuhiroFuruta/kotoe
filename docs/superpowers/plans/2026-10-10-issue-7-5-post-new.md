# お題投稿（/posts/new） 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/posts/new` で画像（プレビュー付き）とタイトルを入力してお題を投稿でき、各エラーが日本語で表示され、ヘッダーから投稿画面へ行けるようにする。

**Architecture:** `app/posts/new/page.tsx`（サーバーコンポーネント）が `<RequireAuth>` で `PostForm` を包む。`PostForm` は状態・確認・送信を持ち、画像欄は `ImagePicker`（選択・ドロップ・プレビュー）に分ける。送る前の確認は純粋関数 `checkImageFile()`、送信の失敗の振り分けと文言は純粋関数 `toPostFormErrors()`（`post-messages.ts`）に置き、どちらも Vitest で確かめる。送信は共通クライアント `apiFetch` に `FormData` と `timeoutMs: 120_000` を渡す。

**Tech Stack:** Next.js 16.2.10（App Router）／ React 19.2.4（`ref` を普通の prop として渡せる）／ TypeScript ／ TailwindCSS 4 ／ Vitest（jsdom）／ Docker Compose。**新しい依存は追加しない。**

**Spec:** `docs/superpowers/specs/2026-10-10-issue-7-5-post-new-design.md`

**Issue:** GitHub #26（`docs/issues_backlog.md` 7-5）

**Branch:** `feat/post-new`（作成済み。設計書のコミット `ec3ffb5` が載っている）

## Global Constraints

このプロジェクト全体の規約。**全タスクの要件に暗黙に含まれる。**

- **依存パッケージを追加しない。** `frontend/package.json` は変更しない。
- **`backend/` のコードは 1 行も変更しない。** API は 3-2 の `POST /api/posts` をそのまま使う。
- **`frontend/src/app/globals.css` を変更しない。** 過去 4 回の Turbopack stale は、すべてこのファイルの変更で起きている（`frontend/AGENTS.md`）。色は既存のトークン（`bg-canvas` / `bg-surface` / `text-ink` / `text-ink-muted` / `border-line` / `bg-line` / `bg-accent` / `text-accent` / `border-accent` / `ring-accent` / `text-danger` / `border-danger` / `bg-danger/10` / `rounded-card`）だけを使う。`zinc-500` のような生のパレットと `dark:` は書かない。
- **`useSearchParams()` を使わない。** Vercel の本番ビルドだけが落ちる（7-2 の規約）。
- **`dangerouslySetInnerHTML` を使わない**（eslint の `react/no-danger` が error）。タイトル・ファイル名は `{value}` で出す。
- **`<img src>` に入れてよいのは `URL.createObjectURL()` の戻り値だけ。** ユーザーが書ける文字列（ファイル名・タイトル）を `src` / `href` に入れない。`next/image` は使わない（7-3a 決定 4）。
- **存在しないルートへリンクを置かない。** `/mypage`（7-6）・`/rankings`（7-7）へのリンクは作らない。
- **文字列はダブルクォート。** コメントは日本語で書き、「何をしているか」ではなく**「なぜそうしたか」**を書く（既存ファイルの書き方に合わせる）。
- **`any` を使わない。** API のレスポンスには型を付ける。
- **`useEffect` の本体で同期的に `setState` しない**（eslint-plugin-react-hooks 7 の `set-state-in-effect` が error。`post-list.tsx` のコメント参照）。
- **テストは `frontend/test/` に置き、`src/` の構造を写す。** コンポーネントのテストは書かない（CLAUDE.md のテスト方針。E2E は 8-1）。
- **env ファイルの中身を表示しない。** `.env.development` は開かない。
- コマンドはリポジトリのルートで実行する。`npm` / `npx` は `docker compose exec frontend <コマンド>` としてコンテナ内で動かす。
- コミットメッセージの末尾は `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` で止める（`Claude-Session:` 行やセッションリンクを書かない）。
- `git checkout` を使わない。ブランチも切り替えない（`feat/post-new` の上だけで作業する）。

## Review Focus

どのタスクの単体テストも直接は叩かないが、使う人が最初に踏みそうな入力・条件。それぞれの確認は、そのコードを持つタスクに入れてある。

1. **弾かれたファイルと同じファイルを選び直しても、何も起きない状態にならない**（`<input type="file">` は値が同じだと `change` を発火しない）→ Task 3 で選ぶたびに `event.target.value = ""` に戻す。Task 5 の手動確認 4-3
2. **「投稿する」のダブルクリックや Enter の連打で、お題が 2 件できない** → Task 3 の `submitting` による早期 return と disabled。Task 5 の手動確認 2-4（Rails のログで POST が 1 本）
3. **ドラッグ＆ドロップで画像以外・5MB 超を落としても、選択と同じ確認を通る**（`accept` 属性はドロップに効かない）→ Task 3 で選択とドロップを同じ `onSelect` に通す。Task 5 の手動確認 4-4
4. **送信中に別のページへ移っても、成功時に投稿画面以外の場所から勝手にお題詳細へ連れ戻されない** → Task 3 の `mountedRef`（アンマウント後はトーストだけ出し、遷移しない）。Task 5 の手動確認 2-5
5. **全角スペースや改行だけのタイトルを、空として扱う**（Rails の `presence` も空と判定するので、送ると 422 になる）→ Task 2 の `isBlankTitle()` とそのテスト

## ファイル構成

| ファイル | 責務 | タスク |
|---|---|---|
| `frontend/src/lib/posts/image-file-check.ts` | **新規**。上限・形式の写しと `checkImageFile()` | 1 |
| `frontend/test/lib/posts/image-file-check.test.ts` | **新規** | 1 |
| `frontend/src/types/api.ts` | `PostCreateResponse` を足す | 2 |
| `frontend/src/lib/posts/post-messages.ts` | **新規**。文言・`isBlankTitle()`・`imageErrorMessage()`・`titleErrorMessage()`・`toPostFormErrors()` | 2 |
| `frontend/test/lib/posts/post-messages.test.ts` | **新規** | 2 |
| `frontend/src/components/ui/text-field.tsx` | `ref` を受け取る | 3 |
| `frontend/src/components/posts/image-picker.tsx` | **新規**。画像欄（選択・ドロップ・プレビュー） | 3 |
| `frontend/src/components/posts/post-form.tsx` | **新規**。フォーム本体 | 3 |
| `frontend/src/app/posts/new/page.tsx` | **新規**。`<RequireAuth>` で包む | 3 |
| `frontend/src/components/layout/site-header.tsx` | 「お題を投稿」ボタン | 4 |
| `docs/issues_backlog.md` | 7-5 の完了、8-5・7-2.6 への申し送り | 5 |

---

### Task 1: 送る前の画像の確認（`checkImageFile`）

**Files:**
- Create: `frontend/src/lib/posts/image-file-check.ts`
- Test: `frontend/test/lib/posts/image-file-check.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `IMAGE_MAX_BYTES: number`（`5 * 1024 * 1024`）
  - `ALLOWED_IMAGE_TYPES: readonly string[]`
  - `IMAGE_ACCEPT: string`（`<input accept>` に渡す値。`ALLOWED_IMAGE_TYPES.join(",")`）
  - `type ImageFileErrorCode = "image_too_large" | "image_type_not_allowed"`
  - `checkImageFile(file: Pick<File, "size" | "type">): ImageFileErrorCode | null`

- [ ] **Step 1: 失敗するテストを書く**

`frontend/test/lib/posts/image-file-check.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import {
  ALLOWED_IMAGE_TYPES,
  IMAGE_ACCEPT,
  IMAGE_MAX_BYTES,
  checkImageFile,
} from "@/lib/posts/image-file-check";

const file = (size: number, type: string) => ({ size, type });

describe("checkImageFile", () => {
  it("上限はバックの Images::Validation::MAX_BYTES（5.megabytes）と同じ値", () => {
    expect(IMAGE_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it("5MB ちょうどは通す（バックも「超えたら」弾く）", () => {
    expect(checkImageFile(file(IMAGE_MAX_BYTES, "image/png"))).toBeNull();
  });

  it("1 バイトでも超えたら image_too_large", () => {
    expect(checkImageFile(file(IMAGE_MAX_BYTES + 1, "image/png"))).toBe("image_too_large");
  });

  it.each(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"])(
    "%s は通す",
    (type) => {
      expect(checkImageFile(file(1024, type))).toBeNull();
    },
  );

  it.each(["image/gif", "image/svg+xml", "application/pdf", "text/plain"])(
    "%s は image_type_not_allowed",
    (type) => {
      expect(checkImageFile(file(1024, type))).toBe("image_type_not_allowed");
    },
  );

  it("type が空なら形式は判定しない（Chrome・Firefox は HEIC で空になる。バックに任せる）", () => {
    expect(checkImageFile(file(1024, ""))).toBeNull();
  });

  it("type が空でもサイズは判定する", () => {
    expect(checkImageFile(file(IMAGE_MAX_BYTES + 1, ""))).toBe("image_too_large");
  });

  it("サイズと形式の両方が違うときはサイズを返す（バックと同じ順序）", () => {
    expect(checkImageFile(file(IMAGE_MAX_BYTES + 1, "image/gif"))).toBe("image_too_large");
  });

  it("accept の値は許可する形式の一覧と同じ", () => {
    expect(IMAGE_ACCEPT.split(",")).toEqual([...ALLOWED_IMAGE_TYPES]);
  });
});
```

- [ ] **Step 2: 失敗することを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/posts/image-file-check.test.ts`
Expected: FAIL（`Failed to resolve import "@/lib/posts/image-file-check"`）

- [ ] **Step 3: 実装する**

`frontend/src/lib/posts/image-file-check.ts`：

```ts
// お題画像を送る前の確認。
//
// **ルールの正はバック（backend/lib/images/validation.rb）。ここはその写し**で、
// 目的は「早く知らせる」ことだけ。バックはファイルを最後まで受け取ってから判定するので、
// 15MB の写真を弱い回線で送ると、数分待ったあとに弾かれる（7-5 設計書「決定 2」）。
// 値がずれてもバックが最終的に弾くので、安全側に倒れる。バックの値を変えたらここも直すこと。
//
// 返すのはバックと同じエラーコード。翻訳の辞書（post-messages.ts）を 1 つで済ませるため。

/** Images::Validation::MAX_BYTES（5.megabytes = 5 * 1024 * 1024） */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** Images::Validation::ALLOWED_CONTENT_TYPES */
export const ALLOWED_IMAGE_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

/**
 * `<input type="file" accept>` に渡す値。ファイル選択画面の絞り込みであって判定ではない
 * （ドラッグ＆ドロップは accept を通らない）。判定は checkImageFile が担う。
 */
export const IMAGE_ACCEPT = ALLOWED_IMAGE_TYPES.join(",");

export type ImageFileErrorCode = "image_too_large" | "image_type_not_allowed";

/**
 * 送ってよいファイルなら null、だめならエラーコード。
 *
 * サイズを先に見るのはバックと同じ順序にするため（同じファイルに同じコードを返す）。
 *
 * **type が空なら形式は判定しない。** Chrome・Firefox は HEIC の type を空にすることが多く、
 * 弾くと正しい HEIC を拒否してしまう。そもそも file.type は拡張子から決まる値で、
 * バックのマジックバイト判定とは一致しない。分からないものはバックに任せる。
 */
export function checkImageFile(file: Pick<File, "size" | "type">): ImageFileErrorCode | null {
  if (file.size > IMAGE_MAX_BYTES) return "image_too_large";
  if (file.type !== "" && !ALLOWED_IMAGE_TYPES.includes(file.type)) return "image_type_not_allowed";
  return null;
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/posts/image-file-check.test.ts`
Expected: PASS（16 件）

- [ ] **Step 5: コミット**

```bash
git add frontend/src/lib/posts/image-file-check.ts frontend/test/lib/posts/image-file-check.test.ts
git commit -F - <<'EOF'
feat: お題画像のサイズと形式を送る前に確認する checkImageFile を追加する

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: 型と文言（`post-messages.ts`）

**Files:**
- Modify: `frontend/src/types/api.ts`（`FavoriteResponse` の直後）
- Create: `frontend/src/lib/posts/post-messages.ts`
- Test: `frontend/test/lib/posts/post-messages.test.ts`

**Interfaces:**
- Consumes: `ApiError` / `ApiTimeoutError`（`@/lib/api`）、`fallbackErrorMessage()`（`@/lib/attempts/attempt-messages`）、`toRequestErrorMessage()`（`@/lib/request-error-messages`）、`IMAGE_MAX_BYTES`（Task 1）
- Produces:
  - `type PostCreateResponse = { post: PostSummary }`（`@/types/api`）
  - `POST_CREATED_MESSAGE` / `UPLOAD_FAILED_MESSAGE` / `POST_TIMEOUT_MESSAGE` / `UNKNOWN_FIELD_MESSAGE`: `string`
  - `isBlankTitle(title: string): boolean`
  - `imageErrorMessage(code: string): string`
  - `titleErrorMessage(code: string): string`
  - `type PostFormError = { kind: "message"; message: string } | { kind: "timeout" } | { kind: "session_expired" }`
  - `type PostFormErrors = { image: string | null; title: string | null; form: PostFormError | null }`
  - `toPostFormErrors(error: unknown): PostFormErrors`

- [ ] **Step 1: 失敗するテストを書く**

`frontend/test/lib/posts/post-messages.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import { ApiError, ApiTimeoutError } from "@/lib/api";
import {
  POST_TIMEOUT_MESSAGE,
  UNKNOWN_FIELD_MESSAGE,
  UPLOAD_FAILED_MESSAGE,
  imageErrorMessage,
  isBlankTitle,
  titleErrorMessage,
  toPostFormErrors,
} from "@/lib/posts/post-messages";
import { NETWORK_MESSAGE, SERVER_MESSAGE } from "@/lib/request-error-messages";

/** Object.prototype から継承したキー。辞書を素朴に引くと文言ではない値が返る */
const PROTOTYPE_KEYS = ["toString", "constructor", "__proto__"];

const unprocessable = (errors: unknown) => new ApiError(422, { errors });

describe("isBlankTitle", () => {
  it.each(["", " ", "　", "\n\t ", " 　\n"])("%j は空として扱う（Rails の presence と同じ）", (title) => {
    expect(isBlankTitle(title)).toBe(true);
  });

  it.each(["a", " 夕焼け ", "　海　"])("%j は空ではない", (title) => {
    expect(isBlankTitle(title)).toBe(false);
  });
});

describe("imageErrorMessage", () => {
  it.each([
    ["image_missing", "画像を選んでください"],
    ["image_too_large", "画像は 5MB 以下にしてください"],
    ["image_type_not_allowed", "JPEG・PNG・WebP・HEIC の画像を選んでください"],
  ])("%s を翻訳する", (code, message) => {
    expect(imageErrorMessage(code)).toBe(message);
  });

  it.each(["unknown_code", ...PROTOTYPE_KEYS])("未知のコード %s は汎用の文言にする", (code) => {
    expect(imageErrorMessage(code)).toBe("この画像は使えません");
  });
});

describe("titleErrorMessage", () => {
  it("blank を翻訳する", () => {
    expect(titleErrorMessage("blank")).toBe("タイトルを入力してください");
  });

  it.each(["too_long", ...PROTOTYPE_KEYS])("未知のコード %s は汎用の文言にする", (code) => {
    expect(titleErrorMessage(code)).toBe("このタイトルは使えません");
  });
});

describe("toPostFormErrors", () => {
  describe("422", () => {
    it("画像とタイトルのエラーを、それぞれの欄に振り分ける", () => {
      expect(
        toPostFormErrors(unprocessable({ image: ["image_too_large"], title: ["blank"] })),
      ).toEqual({
        image: "画像は 5MB 以下にしてください",
        title: "タイトルを入力してください",
        form: null,
      });
    });

    it("欄の未知のコードは、その欄の汎用の文言にする", () => {
      expect(toPostFormErrors(unprocessable({ title: ["too_long"] }))).toEqual({
        image: null,
        title: "このタイトルは使えません",
        form: null,
      });
    });

    it.each([
      ["空の配列", []],
      ["文字列でないコード", [1]],
      ["配列でない", "blank"],
    ])("コードが読めない（%s）ときも、その欄に汎用の文言を出す", (_label, codes) => {
      expect(toPostFormErrors(unprocessable({ title: codes })).title).toBe("このタイトルは使えません");
    });

    it("画面に無い欄のエラーはフォーム上部に出す（何も表示されない状態を作らない）", () => {
      expect(toPostFormErrors(unprocessable({ user: ["must_exist"] }))).toEqual({
        image: null,
        title: null,
        form: { kind: "message", message: UNKNOWN_FIELD_MESSAGE },
      });
    });

    it("JSON の __proto__ キーも画面に無い欄として扱う", () => {
      const errors: unknown = JSON.parse('{"__proto__": ["x"]}');
      expect(toPostFormErrors(unprocessable(errors)).form).toEqual({
        kind: "message",
        message: UNKNOWN_FIELD_MESSAGE,
      });
    });

    it("画面にある欄と無い欄が混ざっていたら、両方出す", () => {
      expect(toPostFormErrors(unprocessable({ image: ["image_missing"], user: ["x"] }))).toEqual({
        image: "画像を選んでください",
        title: null,
        form: { kind: "message", message: UNKNOWN_FIELD_MESSAGE },
      });
    });

    it.each([
      ["errors が空", new ApiError(422, { errors: {} })],
      ["errors がオブジェクトでない", new ApiError(422, { errors: "invalid" })],
      ["errors が無い", new ApiError(422, { error: "something" })],
      ["本文が JSON でない", new ApiError(422, "<html>")],
    ])("%s ときはフォーム上部に出す", (_label, error) => {
      const result = toPostFormErrors(error);
      expect(result.image).toBeNull();
      expect(result.title).toBeNull();
      expect(result.form).toEqual({ kind: "message", message: expect.any(String) });
    });
  });

  it("502 image_upload_failed は画像の保存に失敗した文言", () => {
    expect(toPostFormErrors(new ApiError(502, { error: "image_upload_failed" }))).toEqual({
      image: null,
      title: null,
      form: { kind: "message", message: UPLOAD_FAILED_MESSAGE },
    });
  });

  it("それ以外の 502（Render のプロキシの HTML など）はサーバーエラー", () => {
    expect(toPostFormErrors(new ApiError(502, "<html>")).form).toEqual({
      kind: "message",
      message: SERVER_MESSAGE,
    });
  });

  it("401 は失効（文言はトーストで出すので、ここでは種類だけ返す）", () => {
    expect(toPostFormErrors(new ApiError(401, { error: "unauthorized" })).form).toEqual({
      kind: "session_expired",
    });
  });

  it("timeout は「投稿されている場合がある」を出すための種類を返す", () => {
    expect(toPostFormErrors(new ApiTimeoutError(120_000)).form).toEqual({ kind: "timeout" });
    expect(POST_TIMEOUT_MESSAGE).toContain("投稿が完了している場合があります");
  });

  it("通信断は通信エラーの文言", () => {
    expect(toPostFormErrors(new TypeError("Failed to fetch")).form).toEqual({
      kind: "message",
      message: NETWORK_MESSAGE,
    });
  });

  it("500 はサーバーエラー", () => {
    expect(toPostFormErrors(new ApiError(500, null)).form).toEqual({
      kind: "message",
      message: SERVER_MESSAGE,
    });
  });

  it("その他の 4xx はステータスを添えた汎用の文言", () => {
    expect(toPostFormErrors(new ApiError(404, null)).form).toEqual({
      kind: "message",
      message: "操作を完了できませんでした（404）",
    });
  });
});
```

- [ ] **Step 2: 失敗することを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/posts/post-messages.test.ts`
Expected: FAIL（`Failed to resolve import "@/lib/posts/post-messages"`）

- [ ] **Step 3: 型を足す**

`frontend/src/types/api.ts` の `FavoriteResponse` の直後に足す：

```ts
/**
 * POST /api/posts（201）。FavoriteResponse と形は同じだが意味が違うので、名前を分けておく
 * （片方の形が変わったときに、もう片方が巻き込まれないように）。
 */
export type PostCreateResponse = {
  post: PostSummary;
};
```

- [ ] **Step 4: 実装する**

`frontend/src/lib/posts/post-messages.ts`：

```ts
// お題投稿まわりの文言。バックはエラーコードだけを返し、日本語はここに集める
// （CLAUDE.md「メッセージ・エラー・i18n の責務」）。
//
// 送る前の確認（image-file-check.ts）もバックと同じコードを返すので、同じ辞書で翻訳する。
// 通信そのものの失敗（timeout 以外）の文言は lib/request-error-messages.ts にある。

import { ApiError, ApiTimeoutError } from "@/lib/api";
import { fallbackErrorMessage } from "@/lib/attempts/attempt-messages";
import { IMAGE_MAX_BYTES } from "@/lib/posts/image-file-check";
import { toRequestErrorMessage } from "@/lib/request-error-messages";

export const POST_CREATED_MESSAGE = "お題を投稿しました";
export const UPLOAD_FAILED_MESSAGE = "画像の保存に失敗しました。時間をおいて再度お試しください";
/**
 * timeout したとき。Rails が本文を受け取ったあとに切れた場合、お題はサーバー側で作られている
 * 可能性がある。一般的な「再度お試しください」では押し直しを促し、二重投稿になる（設計書「決定 4」）。
 */
export const POST_TIMEOUT_MESSAGE =
  "投稿に時間がかかっています。投稿が完了している場合がありますので、お題一覧で確認してから再度お試しください";
/** 422 のうち、画面に欄が無いもの。何も表示されない状態を作らないための受け皿 */
export const UNKNOWN_FIELD_MESSAGE = "投稿できませんでした。入力内容を確認してください";

const IMAGE_MESSAGES: Record<string, string> = {
  image_missing: "画像を選んでください",
  image_too_large: `画像は ${IMAGE_MAX_BYTES / 1024 / 1024}MB 以下にしてください`,
  image_type_not_allowed: "JPEG・PNG・WebP・HEIC の画像を選んでください",
};
const IMAGE_FALLBACK_MESSAGE = "この画像は使えません";

const TITLE_MESSAGES: Record<string, string> = {
  blank: "タイトルを入力してください",
};
const TITLE_FALLBACK_MESSAGE = "このタイトルは使えません";

export type PostFormError =
  | { kind: "message"; message: string }
  /** 文言に一覧へのリンクを添えるので、文字列ではなく種類で返す */
  | { kind: "timeout" }
  /** 文言はトーストで出す（7-3c と同じ）。RequireAuth がこのあとログイン画面へ送る */
  | { kind: "session_expired" };

export type PostFormErrors = {
  image: string | null;
  title: string | null;
  form: PostFormError | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 辞書に自前のキーとしてあるか。`record[key]` は Object.prototype から継承したキー
 * （toString など）にも値を返すので、それらを未知のコードとして扱うために使う。
 */
function hasOwnKey(record: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * タイトルが空か。Rails の `presence`（`blank?`）は空白だけの文字列も空と判定するので、
 * ここで素通しすると 422 になる。JS の trim() と Ruby の [[:space:]] はどちらも
 * 全角スペース（U+3000）を空白として扱う。
 */
export function isBlankTitle(title: string): boolean {
  return title.trim() === "";
}

export function imageErrorMessage(code: string): string {
  return hasOwnKey(IMAGE_MESSAGES, code) ? IMAGE_MESSAGES[code] : IMAGE_FALLBACK_MESSAGE;
}

export function titleErrorMessage(code: string): string {
  return hasOwnKey(TITLE_MESSAGES, code) ? TITLE_MESSAGES[code] : TITLE_FALLBACK_MESSAGE;
}

/** 欄のコードの配列から最初の 1 件を取る。読めなければ null（呼び出し側が汎用の文言にする） */
function firstCode(codes: unknown): string | null {
  return Array.isArray(codes) && typeof codes[0] === "string" ? codes[0] : null;
}

const NO_ERRORS: PostFormErrors = { image: null, title: null, form: null };

function formMessage(message: string): PostFormErrors {
  return { ...NO_ERRORS, form: { kind: "message", message } };
}

/**
 * 422 の `{ errors: { field: [code] } }` を欄に振り分ける。
 *
 * Object.entries で自前のキーだけを見る。JSON.parse は "__proto__" を自前のキーとして作るが、
 * "image" / "title" との一致でしか欄に振らないので、画面に無い欄として扱われる。
 */
function fromValidationErrors(body: unknown): PostFormErrors {
  if (!isRecord(body) || !isRecord(body.errors)) return formMessage(UNKNOWN_FIELD_MESSAGE);

  const result: PostFormErrors = { ...NO_ERRORS };
  let hasUnknownField = false;

  for (const [field, codes] of Object.entries(body.errors)) {
    const code = firstCode(codes);
    if (field === "image") {
      result.image = code === null ? IMAGE_FALLBACK_MESSAGE : imageErrorMessage(code);
    } else if (field === "title") {
      result.title = code === null ? TITLE_FALLBACK_MESSAGE : titleErrorMessage(code);
    } else {
      hasUnknownField = true;
    }
  }

  // errors が空のときもここに来る。どの欄にも出ない 422 を無言にしない。
  if (hasUnknownField || (result.image === null && result.title === null)) {
    result.form = { kind: "message", message: UNKNOWN_FIELD_MESSAGE };
  }
  return result;
}

/**
 * 投稿（POST /api/posts）の失敗を、欄ごとの文言とフォーム上部の表示に振り分ける。
 * どんな失敗でも、image・title・form のどれか 1 つは必ず埋まる。
 *
 * 呼び出し側の中断（AbortError）は渡さないこと（投稿は中断しない）。
 */
export function toPostFormErrors(error: unknown): PostFormErrors {
  if (error instanceof ApiTimeoutError) return { ...NO_ERRORS, form: { kind: "timeout" } };

  if (error instanceof ApiError) {
    if (error.status === 401) return { ...NO_ERRORS, form: { kind: "session_expired" } };
    if (error.status === 422) return fromValidationErrors(error.body);
    if (
      error.status === 502 &&
      isRecord(error.body) &&
      error.body.error === "image_upload_failed"
    ) {
      return formMessage(UPLOAD_FAILED_MESSAGE);
    }
  }

  // 5xx・通信断は toRequestErrorMessage、それ以外の 4xx はコードかステータスを添えた文言
  // （attempt-messages.ts と同じ汎用の扱い）。
  return formMessage(
    error instanceof ApiError && error.status < 500
      ? fallbackErrorMessage(error)
      : toRequestErrorMessage(error),
  );
}
```

- [ ] **Step 5: 通ることを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/posts/post-messages.test.ts`
Expected: PASS

- [ ] **Step 6: 全体のテストと型を確かめる**

```bash
docker compose exec frontend npm test
docker compose exec frontend npx tsc --noEmit
```

Expected: 全件 PASS、型エラー 0。

- [ ] **Step 7: コミット**

```bash
git add frontend/src/types/api.ts frontend/src/lib/posts/post-messages.ts frontend/test/lib/posts/post-messages.test.ts
git commit -F - <<'EOF'
feat: お題投稿の失敗を欄とフォーム上部に振り分ける toPostFormErrors を追加する

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: 投稿フォームと `/posts/new`

**Files:**
- Modify: `frontend/src/components/ui/text-field.tsx`
- Create: `frontend/src/components/posts/image-picker.tsx`
- Create: `frontend/src/components/posts/post-form.tsx`
- Create: `frontend/src/app/posts/new/page.tsx`

**Interfaces:**
- Consumes: Task 1 の `checkImageFile` / `IMAGE_ACCEPT`、Task 2 のすべて、`apiFetch`（`@/lib/api`）、`RequireAuth`（`@/lib/auth/require-auth`）、`SESSION_EXPIRED_MESSAGE`（`@/lib/auth/error-messages`）、`postDetailHref`（`@/lib/posts/post-detail-query`）、`toast`（`@/lib/toast/toast-store`）、`buttonClasses`（`@/components/ui/button`）
- Produces:
  - `TextField` の新しい省略可能な prop `ref?: Ref<HTMLInputElement>`
  - `ImagePicker`（props は下のコード）
  - `PostForm`（props なし）
  - ルート `/posts/new`

このタスクのコードはコンポーネントなので単体テストを書かない（CLAUDE.md）。確認は型・lint と、Step 6 の簡単な画面確認、Task 5 の手動確認で行う。

- [ ] **Step 1: `TextField` に `ref` を通す**

`frontend/src/components/ui/text-field.tsx`：

1. 先頭に `import type { Ref } from "react";` を足す（空行を挟んで `type TextFieldProps` の前）。
2. `TextFieldProps` の `minLength?: number;` の後ろに足す：

```ts
  /**
   * 入力欄そのものへの参照。エラーのときに入力欄へフォーカスを移すために使う（7-5）。
   * React 19 では ref を普通の prop として受け取れるので forwardRef は要らない。
   */
  ref?: Ref<HTMLInputElement>;
```

3. 分割代入に `ref,` を足し（`minLength,` の後ろ）、`<input` の `id={id}` の直前に `ref={ref}` を足す。

- [ ] **Step 2: `ImagePicker` を作る**

`frontend/src/components/posts/image-picker.tsx`：

```tsx
"use client";

import { useEffect, useRef, useState, type DragEvent, type Ref } from "react";

import { buttonClasses } from "@/components/ui/button";
import { IMAGE_ACCEPT } from "@/lib/posts/image-file-check";

/**
 * 選んだファイルのプレビュー。
 *
 * object URL は effect で作って img に直接入れ、effect の後片づけで解放する。
 * - state に入れると effect の中で setState することになる（react-hooks の set-state-in-effect）
 * - useMemo で作って effect で解放すると、開発時の StrictMode が「アンマウント → 再マウント」を
 *   模擬したときに解放だけが走り、memo は作り直されないのでプレビューが壊れる
 * effect で作れば、再マウントのたびに作り直されるのでどちらも起きない。
 *
 * 親は選び直すたびに key を変えるので、previewFailed は新しいファイルで必ず false から始まる。
 */
function FilePreview({ file }: { file: File }) {
  const imageRef = useRef<HTMLImageElement>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    if (imageRef.current !== null) imageRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (previewFailed) {
    // Safari 以外は HEIC を <img> で描けない。壊れた画像のアイコンを出さずに、投稿はできることを伝える。
    // ファイル名は利用者が自由に付けられる文字列なので、{value} で出すだけにする（属性・URL に入れない）。
    return (
      <div className="flex flex-col items-center gap-1 rounded-card bg-line px-4 py-8 text-center text-sm">
        <p className="text-ink">この形式はプレビューできません（投稿はできます）</p>
        <p className="max-w-full truncate text-ink-muted">{file.name}</p>
      </div>
    );
  }

  return (
    // next/image ではなく <img>（7-3a 決定 4）。枠は画像そのものの縦横比にする（PostHero と同じ）。
    // 固定の枠に object-contain で収めると、縦長・正方形の写真で左右に帯が出る。
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imageRef}
      alt="選んだ画像のプレビュー"
      onError={() => setPreviewFailed(true)}
      className="mx-auto block h-auto max-h-80 w-auto max-w-full rounded-card"
    />
  );
}

/**
 * 画像欄。クリックで選ぶ・ドラッグ＆ドロップ・プレビュー。
 *
 * ファイルを受け取ったら onSelect に渡すだけで、確認（サイズ・形式）はしない。
 * 確認は PostForm が checkImageFile で行う（選択とドロップを同じ確認に通すため）。
 *
 * <input type="file"> は見た目を隠し（sr-only）、<label htmlFor> を押せる範囲にする。
 * input 自体はフォーカスを受けられるので、キーボードでも Enter / Space で選べる。
 * フォーカスの見た目は、外枠の focus-within で出す。
 */
export function ImagePicker({
  inputId,
  inputRef,
  selection,
  disabled,
  error,
  onSelect,
}: {
  inputId: string;
  inputRef: Ref<HTMLInputElement>;
  /** 確認を通ったファイル。id は選び直すたびに変わる（プレビューの key） */
  selection: { file: File; id: number } | null;
  disabled: boolean;
  error: string | null;
  onSelect: (file: File) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const errorId = `${inputId}-error`;
  const hintId = `${inputId}-hint`;

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    // これを止めないと drop が発火せず、ブラウザがファイルを開いて画面を離れる。
    event.preventDefault();
    if (!disabled) setDragging(true);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    // 複数落とされたら先頭の 1 枚だけを使う。
    const file = event.dataTransfer.files[0];
    if (file !== undefined) onSelect(file);
  }

  const describedBy = [error !== null ? errorId : null, hintId]
    .filter((id): id is string => id !== null)
    .join(" ");

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">画像</span>

      <div
        onDragOver={handleDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center gap-3 rounded-card border-2 border-dashed p-4 focus-within:ring-2 focus-within:ring-accent ${
          dragging ? "border-accent" : error !== null ? "border-danger" : "border-line"
        }`}
      >
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // 値を空に戻す。戻さないと、弾かれたファイルと同じものを選び直したときに
            // change が発火せず、何も起きないように見える。
            event.target.value = "";
            if (file !== undefined) onSelect(file);
          }}
          aria-invalid={error === null ? undefined : true}
          aria-describedby={describedBy}
          className="sr-only"
        />

        {selection === null ? (
          <label
            htmlFor={inputId}
            className="flex w-full cursor-pointer flex-col items-center gap-1 py-8 text-center"
          >
            <span className={buttonClasses({ variant: "secondary", size: "sm" })}>画像を選ぶ</span>
            <span className="text-sm text-ink-muted">またはここにドロップ</span>
          </label>
        ) : (
          <>
            <FilePreview key={selection.id} file={selection.file} />
            <label
              htmlFor={inputId}
              className={`cursor-pointer text-sm ${buttonClasses({ variant: "secondary", size: "sm" })}`}
            >
              選び直す
            </label>
          </>
        )}
      </div>

      <p id={hintId} className="text-sm text-ink-muted">
        JPEG・PNG・WebP・HEIC、5MB まで
      </p>
      {error !== null && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: `PostForm` を作る**

`frontend/src/components/posts/post-form.tsx`：

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { ImagePicker } from "@/components/posts/image-picker";
import { buttonClasses } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { apiFetch } from "@/lib/api";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/error-messages";
import { checkImageFile } from "@/lib/posts/image-file-check";
import { postDetailHref } from "@/lib/posts/post-detail-query";
import {
  imageErrorMessage,
  isBlankTitle,
  POST_CREATED_MESSAGE,
  POST_TIMEOUT_MESSAGE,
  titleErrorMessage,
  toPostFormErrors,
  type PostFormError,
} from "@/lib/posts/post-messages";
import { toast } from "@/lib/toast/toast-store";
import type { PostCreateResponse } from "@/types/api";

/**
 * 送信の待ち上限。ブラウザ → Rails（5MB を 1Mbps で約 40 秒）と Rails → Cloudinary
 * （gem の既定 timeout 60 秒）を足して約 100 秒、余裕を見て 120 秒（設計書「決定 3」）。
 * 既定の 15 秒はコールドスタートを早く見切るための値だが、この画面は RequireAuth が
 * /api/me に成功してから出るので、送信の時点でサーバーは起きている。
 */
const POST_TIMEOUT_MS = 120_000;

type FocusField = "image" | "title";

/**
 * お題投稿のフォーム（7-5）。画像とタイトルを multipart で POST /api/posts へ送る。
 *
 * 進み具合（%）は出さない（設計書「決定 1」。fetch は送信の進み具合を取れない）。
 */
export function PostForm() {
  const router = useRouter();
  const baseId = useId();
  const imageInputId = `${baseId}-image`;
  const titleInputId = `${baseId}-title`;

  const [selection, setSelection] = useState<{ file: File; id: number } | null>(null);
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [formError, setFormError] = useState<PostFormError | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  // 選び直すたびに増やす。プレビューの key にして、前のファイルの状態を持ち越さない。
  const selectionCount = useRef(0);
  // フォーカスの移動先。描画の確定後（effect）に移すのは、エラーの id が aria-describedby に
  // 載ってからにするため（載る前に移すと、スクリーンリーダーがエラーを読まない。7-3c と同じ）。
  const [focusRequest, setFocusRequest] = useState<{ field: FocusField; count: number } | null>(
    null,
  );
  // 送信中に別のページへ移ったかどうか。移ったあとに成功しても、お題詳細へ連れ戻さない。
  const mountedRef = useRef(false);

  useEffect(() => {
    // StrictMode の模擬的な再マウントでも true に戻るよう、本体で立てる。
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (focusRequest === null) return;
    (focusRequest.field === "image" ? imageInputRef : titleInputRef).current?.focus();
  }, [focusRequest]);

  function requestFocus(field: FocusField) {
    setFocusRequest((previous) => ({ field, count: (previous?.count ?? 0) + 1 }));
  }

  function handleSelect(file: File) {
    const code = checkImageFile(file);
    if (code !== null) {
      // 弾いたファイルは選んだ状態にしない（前に選んでいた画像も外す）。プレビューの下に
      // エラーが出ると、どちらの画像のことか分からなくなるため。
      setSelection(null);
      setImageError(imageErrorMessage(code));
      return;
    }
    selectionCount.current += 1;
    setSelection({ file, id: selectionCount.current });
    setImageError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // disabled だけに頼らない。Enter の連打は disabled が描画される前に届くことがある。
    if (submitting) return;

    setFormError(null);
    const missingImage = selection === null;
    const blankTitle = isBlankTitle(title);
    // 画像のエラーは、選んだ時点で弾かれたもの（selection が null に戻っている）を上書きしない。
    if (missingImage && imageError === null) setImageError(imageErrorMessage("image_missing"));
    setTitleError(blankTitle ? titleErrorMessage("blank") : null);
    // missingImage ではなく selection を直接比べる。別名の条件だと、下の selection.file で
    // null の可能性が型から消えないことがある。
    if (selection === null || blankTitle) {
      requestFocus(missingImage ? "image" : "title");
      return;
    }

    setSubmitting(true);
    const body = new FormData();
    body.append("post[title]", title);
    body.append("post[image]", selection.file);

    try {
      const { post } = await apiFetch<PostCreateResponse>("/api/posts", {
        method: "POST",
        body,
        timeoutMs: POST_TIMEOUT_MS,
      });
      toast.success(POST_CREATED_MESSAGE);
      // replace：戻るボタンで空の投稿フォームに戻ると「投稿が消えた」ように見えるため（決定 6）。
      // submitting は戻さない。遷移が終わるまでの二重送信を防ぐ（ログイン画面と同じ）。
      if (mountedRef.current) router.replace(postDetailHref(post.id));
    } catch (error: unknown) {
      const errors = toPostFormErrors(error);
      setSubmitting(false);

      if (errors.form?.kind === "session_expired") {
        // api.ts がトークンを捨てたので、RequireAuth がこのあとログイン画面へ送る。
        // 入力は消える（既知の制約。7-2.6・7-3d で扱う）。理由だけは伝える。
        toast.error(SESSION_EXPIRED_MESSAGE);
        return;
      }

      setImageError(errors.image);
      setTitleError(errors.title);
      setFormError(errors.form);
      if (errors.image !== null) requestFocus("image");
      else if (errors.title !== null) requestFocus("title");
    }
  }

  return (
    <div className="w-full max-w-lg rounded-card border border-line bg-surface p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-ink">お題を投稿</h1>

      {/*
        noValidate：ブラウザ標準の吹き出し（TextField は required を付ける）ではなく、
        欄の下に同じ見た目でエラーを出すため。画像とタイトルのエラーを同時に出せる。
      */}
      <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-5">
        {formError !== null && formError.kind !== "session_expired" && (
          <div role="alert" className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">
            {formError.kind === "timeout" ? (
              <p>
                {POST_TIMEOUT_MESSAGE}{" "}
                {/*
                  新しいタブで開く。同じタブで移ると、この画面の入力（画像・タイトル）が消え、
                  投稿されていなかったときに入れ直しになる。
                */}
                <Link href="/posts" target="_blank" rel="noopener" className="underline">
                  お題一覧を開く（新しいタブ）
                </Link>
              </p>
            ) : (
              <p>{formError.message}</p>
            )}
          </div>
        )}

        <ImagePicker
          inputId={imageInputId}
          inputRef={imageInputRef}
          selection={selection}
          disabled={submitting}
          error={imageError}
          onSelect={handleSelect}
        />

        <TextField
          id={titleInputId}
          ref={titleInputRef}
          label="タイトル"
          type="text"
          value={title}
          onChange={(value) => {
            setTitle(value);
            // 直している最中に、もう当てはまらないエラーと aria-invalid を残さない。
            if (titleError !== null) setTitleError(null);
          }}
          autoComplete="off"
          error={titleError ?? undefined}
        />

        <button type="submit" disabled={submitting} className={`mt-1 ${buttonClasses()}`}>
          {submitting ? "投稿中…" : "投稿する"}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: ページを作る**

`frontend/src/app/posts/new/page.tsx`：

```tsx
import type { Metadata } from "next";

import { PostForm } from "@/components/posts/post-form";
import { RequireAuth } from "@/lib/auth/require-auth";

export const metadata: Metadata = {
  title: "お題を投稿",
};

/**
 * 認証必須。RequireAuth が未ログインなら /login?next=/posts/new へ送り、
 * サーバーに届かないときは再試行の画面を出す（7-2）。
 *
 * 静的なセグメントなので /posts/[id] より優先される（[id] の parsePostId に "new" は届かない）。
 */
export default function NewPostPage() {
  return (
    <main className="flex flex-1 justify-center px-4 py-8 sm:py-12">
      <RequireAuth>
        <PostForm />
      </RequireAuth>
    </main>
  );
}
```

- [ ] **Step 5: 型・lint・テストを通す**

```bash
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run lint
docker compose exec frontend npm test
```

Expected: すべてエラー 0・全件 PASS。lint が `set-state-in-effect` を出したら、effect の本体で `setState` していないか見直す（`FilePreview` は `src` を DOM に直接入れている）。

- [ ] **Step 6: 画面が開くことだけ確かめる**

`docker compose up -d` の状態で、ログインしてから `http://localhost:3001/posts/new` を開き、フォームが出ること、画像を 1 枚選んでプレビューが出ることを確かめる（詳しい確認は Task 5）。`/login` と `/posts` も開いて、`TextField` の変更で既存の画面が崩れていないことを見る。

- [ ] **Step 7: コミット**

```bash
git add frontend/src/components/ui/text-field.tsx frontend/src/components/posts/image-picker.tsx frontend/src/components/posts/post-form.tsx frontend/src/app/posts/new/page.tsx
git commit -F - <<'EOF'
feat: お題投稿画面（/posts/new）を追加する

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: ヘッダーの「お題を投稿」

**Files:**
- Modify: `frontend/src/components/layout/site-header.tsx`

**Interfaces:**
- Consumes: ルート `/posts/new`（Task 3）
- Produces: なし

- [ ] **Step 1: ナビのコメントを書き換える**

左側の `{/* ナビのリンクは、そのルートを作る issue がここに足す。 ... */}` のコメントを次に置き換える（7-5 の項目を消し、置き場所が右側になったことを残す）：

```tsx
          {/*
            ナビのリンクは、そのルートを作る issue がここに足す。
            7-6: アバター → /mypage ／ 7-7:「ランキング」→ /rankings。
            「お題を投稿」（7-5）は右側のアカウント側にボタンとして置いてある（デザインブリーフ 0）。
            main は Vercel の本番を追跡するので、存在しないルートへのリンクは置かない
            （置いた瞬間に本番で 404 になる）。

            「探す」は認証状態に関係なく出す。一覧は誰でも見られる。
          */}
```

- [ ] **Step 2: アカウント側のナビにボタンを足す**

右側の `<nav aria-label="アカウント" ...>` の中、`{auth.status === "loading" && (...)}` の**直後**に足す：

```tsx
          {/*
            loading 以外では常に出す（7-5 設計書「決定 5」）。未ログインで押すと RequireAuth が
            /login?next=/posts/new へ送り、ログイン後に戻ってくる。unreachable でも押した先で
            再試行の画面が出るので、行き止まりにはならない。loading で出さないのは、
            スケルトンの幅が状態によって変わらないようにするため。
          */}
          {auth.status !== "loading" && (
            <Link href="/posts/new" className={buttonClasses({ size: "sm" })}>
              お題を投稿
            </Link>
          )}
```

- [ ] **Step 3: 型・lint を通す**

```bash
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run lint
```

Expected: エラー 0。

- [ ] **Step 4: コミット**

```bash
git add frontend/src/components/layout/site-header.tsx
git commit -F - <<'EOF'
feat: ヘッダーに「お題を投稿」ボタンを足す

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: 実物での確認・ドキュメント・レビュー・PR

**Files:**
- Modify: `docs/issues_backlog.md`

**Interfaces:**
- Consumes: Task 1〜4 の成果すべて
- Produces: PR（`Closes #26`）

- [ ] **Step 1: 確認用の画像を作る**

スクラッチパッド（以下 `$SCRATCH`）に作る。`magick` と `sips` は Mac 側で動かす（コンテナではない）。

```bash
cd "$SCRATCH"
magick -size 1600x900 gradient:skyblue-orange wide.png          # 16:9
magick -size 900x1200 gradient:seagreen-khaki tall.png          # 3:4
magick -size 1000x1000 plasma:fractal square.jpg                # 正方形
sips -s format heic square.jpg --out square.heic >/dev/null     # HEIC
magick -size 40x40 xc:red anim.gif                              # 許可しない形式
magick -size 2600x2600 xc: +noise Random big.png                # 5MB 超
ls -l "$SCRATCH"
```

Expected：`big.png` が 5,242,880 バイトを超えている（超えていなければサイズを 3000x3000 にして作り直す）。

確認で作るお題のタイトルは、必ず `[7-5確認]` で始める（Step 3 で片づけるため）。

- [ ] **Step 2: 手動確認（全部に ✓ が付くまで先に進まない）**

Rails のログは `docker compose logs -f backend` で見る。

**1. `RequireAuth`（backlog 7-5 の確認 3 点）**
1. [ ] ログインした状態で `http://localhost:3001/posts/new` を**アドレスバーから直接開き**、さらにリロードしても `/login` に飛ばされない（7-1 で埋め込んだバグの再発確認。`<Link>` での遷移では確かめたことにならない）
2. [ ] ログアウトして `/posts/new` を開く → `/login?next=%2Fposts%2Fnew` に移る → ログインすると `/posts/new` に戻る
3. [ ] ログイン状態で `docker compose stop backend` → `/posts/new` をリロード → `/login` に飛ばされず「サーバーの応答がありません」と「再試行」 → `docker compose start backend` → 「再試行」でフォームが出る

**2. 投稿**
1. [ ] `wide.png` とタイトル `[7-5確認] 夕焼け` で投稿 → ボタンが「投稿中…」→ 「お題を投稿しました」のトースト → お題詳細へ移る
2. [ ] そこでブラウザの戻るボタン → 投稿フォームではなく、投稿画面を開く前のページに戻る
3. [ ] `/posts` の先頭に投稿したお題が出る
4. [ ] **連打**：新しいお題で「投稿する」をダブルクリックし、すぐ Enter も押す → Rails のログで `POST "/api/posts"` が 1 本だけ（Review Focus 2）
5. [ ] **送信中の離脱**：DevTools → Network → スロットリングを「Slow 4G」にして `big.png` 以外の画像で投稿 → 「投稿中…」のうちにヘッダーの「探す」を押す → 投稿が終わるとトーストは出るが、**お題詳細へ連れ戻されない**（Review Focus 4）→ スロットリングを戻す

**3. 画像の縦横比（メモリ「画像は縦横比を変えて確認」）**
1. [ ] `wide.png`・`tall.png`・`square.jpg` をそれぞれ選び、プレビューが切れず、左右・上下に帯が出ない
2. [ ] `tall.png` と `square.jpg` も `[7-5確認]` で投稿し、お題詳細のヒーローとお題一覧のカードで崩れない

**4. 画像の確認**
1. [ ] `big.png` を選ぶ → すぐ画像欄の下に「画像は 5MB 以下にしてください」、プレビューは出ない、Rails にリクエストが飛ばない
2. [ ] `anim.gif` を選ぶ → 「JPEG・PNG・WebP・HEIC の画像を選んでください」
3. [ ] **同じファイルを選び直す**：`big.png` を選んで弾かれたあと、もう一度 `big.png` を選ぶ → エラーがもう一度出る（何も起きない状態にならない。Review Focus 1）。続けて `wide.png` を選ぶとエラーが消えてプレビューが出る
4. [ ] **ドロップ**：Finder から `wide.png` をドロップ → 枠の色が変わり、プレビューが出る。`big.png` と `anim.gif` をドロップ → 選んだときと同じエラー（Review Focus 3）。2 枚まとめてドロップ → 先頭の 1 枚だけが選ばれる。**ドロップでブラウザがファイルを開いて画面を離れないこと**
5. [ ] **HEIC**：Chrome で `square.heic` を選ぶ → 「この形式はプレビューできません（投稿はできます）」とファイル名 → `[7-5確認] HEIC` で投稿でき、お題詳細で画像が表示される（Cloudinary が変換して配信する）。Safari が使えればプレビューが出ることも見る

**5. 入力のエラー**
1. [ ] 何も入れずに「投稿する」→ 画像欄に「画像を選んでください」、タイトル欄に「タイトルを入力してください」、フォーカスが画像の入力（外枠に輪郭）に移る
2. [ ] 画像だけ選んで、タイトルに全角スペースだけを入れて「投稿する」→ タイトル欄にエラー、フォーカスがタイトル欄に移る、Rails にリクエストが飛ばない
3. [ ] タイトルを 1 文字入れるとタイトルのエラーが消える。画像を選ぶと画像のエラーが消える

**6. ヘッダー（375px 幅。DevTools のデバイスモード）**
1. [ ] 未ログイン・ログイン中・`unreachable`（`docker compose stop backend` でリロード）の 3 状態で、横スクロールが出ない → `docker compose start backend`
2. [ ] 2 行に折り返す状態と、未ログイン時に primary のボタンが 2 つ（「お題を投稿」「新規登録」）並ぶ見た目を、**スクリーンショットでユーザーに見せて判断を仰ぐ**（直すならこの PR の中で直す。ハンバーガーメニューは入れない）
3. [ ] 未ログインでヘッダーの「お題を投稿」→ `/login?next=%2Fposts%2Fnew`

**7. キーボード**
1. [ ] Tab だけで、画像の入力（外枠に輪郭が出る）→ Space で選択画面 → 画像を選ぶ → タイトル → 「投稿する」まで操作できる

- [ ] **Step 3: 片づける**

```bash
docker compose exec -T backend bin/rails runner '
posts = Post.kept.where("title LIKE ?", "[7-5確認]%")
count = posts.count
posts.find_each(&:discard!)
puts "discarded: #{count}"
'
git status --short
```

Expected：`discarded:` の件数が出る（物理削除しない。Cloudinary の画像は開発用フォルダ `kotoe/development/posts` に残るが、本番とは混ざらない）。`git status` に意図しない変更が無い。

- [ ] **Step 4: backlog を更新する**

`docs/issues_backlog.md`：

1. **7-5 の節**（`### 🟢 7-5. お題投稿（/posts/new）` から、次の `### 🟢 7-6.` の直前まで）を次に置き換える。Step 2 の 6-2 でユーザーが見た目を変えた場合は、最後から 2 番目の項目にその結果を足す。

```markdown
### 🟢 7-5. お題投稿（/posts/new）
- 依存：7-1, 3-2
- GitHub：#26
- 設計書：`docs/superpowers/specs/2026-10-10-issue-7-5-post-new-design.md`
- タスク：画像アップロード（プレビュー）＋タイトル＋投稿、エラー状態。
- **`RequireAuth` の確認 3 点**（直接ロードで飛ばされない／未ログインは `next` 付きでログインへ行き戻る／
  backend 停止時は再試行）は 7-5 で手動確認済み。自動化は 8-1
- **7-5 で決めたこと（後続が乗る前提）**：
  - 送信は `apiFetch` に `FormData` と `timeoutMs: 120_000` を渡す。進み具合（%）は出さない
    （`fetch` は送信の進み具合を取れない。必要になったら `api.ts` に XHR の送信関数を足す）
  - サイズ（5MB）と形式は選んだ時点でフロントでも確かめる（`lib/posts/image-file-check.ts`）。
    **正はバックの `Images::Validation`。値を変えたら両方直す**。`file.type` が空なら形式はバックに任せる
  - 文言は `lib/posts/post-messages.ts`。送る前の確認もバックと同じエラーコードを返し、同じ辞書で翻訳する
  - timeout は「投稿されている場合がある」と知らせ、お題一覧を新しいタブで開くリンクを出す（二重投稿の防止）
  - 成功したらトーストを出し、`router.replace` でお題詳細へ
  - ヘッダーの「お題を投稿」は右側に、`loading` 以外で常に出す
- 完了条件：画面からお題を投稿できる。
```

2. **8-5 の節**の `  - 画像アップロードの経路 → **7-5** で確定` の行を次に置き換える。

```markdown
  - 画像アップロードの経路 → **7-5 で確定：ブラウザ → Rails API**（`POST /api/posts` に multipart）。
    `connect-src` は API のオリジンだけで足り、ブラウザから Cloudinary へ直接つなぐことは無い。
    **プレビューは `blob:` URL（`URL.createObjectURL`）なので `img-src` に `blob:` が要る**
```

3. **7-2.6 の節**の「先に決めること」の 3 の末尾（`保存先の問いが同じなので一緒に決める` の行の後ろ）に足す。

```markdown
     **7-5 の時点で、ガード付きページ（`/posts/new`）が実在する。** 投稿中に 401 が返ると、
     トーストで失効を伝えたあと `RequireAuth` がログイン画面へ送り、選んだ画像とタイトルは消える。
     画像は `File` なので `localStorage` には残せない（残すなら IndexedDB 等が要る）
```

- [ ] **Step 5: 全体の検証**

```bash
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run lint
docker compose exec frontend npm test
docker compose exec frontend npm run build
git diff --stat main -- backend
```

Expected：すべてエラー 0・全件 PASS・ビルド成功。`git diff --stat main -- backend` は何も出力しない（rspec / rubocop は CI に任せる）。`npm run build` を回すのは、`useSearchParams` 系の「本番ビルドだけ落ちる」問題をここで捕まえるため。

- [ ] **Step 6: コミット**

```bash
git add docs/issues_backlog.md
git commit -F - <<'EOF'
docs: 7-5 の決定事項と、8-5・7-2.6 への申し送りを backlog に記録する

Refs #26

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 7: プッシュ前にコードレビューを通す**

プッシュ前に `/code-review high` を回す（superpowers の最終レビューとは別物なので、両方通す。メモリの規約）。指摘は `superpowers:receiving-code-review` に沿って検証してから直す。**直したコミットにも `/code-review high` をもう一度かける**（メモリ「レビュー修正も再レビュー」）。

- [ ] **Step 8: プッシュして PR を出す**

この PR のマージで #26 の完了条件（画面からお題を投稿できる）を満たすので `Closes #26`。

```bash
git push -u origin feat/post-new
gh pr create --title "7-5. お題投稿（/posts/new）" --body "$(cat <<'EOF'
## 概要

`/posts/new` で画像（プレビュー付き）とタイトルを入力してお題を投稿できるようにした。ヘッダーに「お題を投稿」を足した。`RequireAuth` を使う最初のページなので、7-2 からの申し送り（確認 3 点）もここで手動確認した。バックエンドの変更は無い。

設計書：`docs/superpowers/specs/2026-10-10-issue-7-5-post-new-design.md`

## 決めたこと

- 送信は `apiFetch`（`fetch`）のまま。進み具合（%）は出さず「投稿中…」にした。% が表すのはブラウザ → Rails の区間だけで、Rails → Cloudinary（最大 60 秒）は表れない
- サイズ（5MB）と形式を選んだ時点でフロントでも確認する。正はバックの `Images::Validation` で、フロントは写し
- timeout は 120 秒。timeout したときは「投稿されている場合がある」と知らせ、お題一覧を新しいタブで開くリンクを出す（二重投稿の防止）
- 成功したら `router.replace` でお題詳細へ（戻るボタンで空のフォームに戻らない）
- ヘッダーの「お題を投稿」は `loading` 以外で常に出す

## 既知の制約

- 投稿中にセッションが失効すると、選んだ画像とタイトルは消える（7-2.6・7-3d で扱う。backlog に申し送り済み）

## 確認

- Vitest：`checkImageFile`・`toPostFormErrors`・`isBlankTitle`
- 手動：`RequireAuth` の確認 3 点、投稿・連打・送信中の離脱、16:9・3:4・正方形のプレビューと投稿後の表示、5MB 超・GIF・HEIC・ドラッグ＆ドロップ、入力エラーとフォーカス、375px のヘッダー、キーボード操作
- マージ後：本番で 1 件だけ投稿し、Cloudinary まで届くことを確かめる

Closes #26

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 9: マージ後の本番確認（ユーザーがマージしてから）**

1. Vercel の本番デプロイが成功したことを確かめる
2. `https://kotoe.vercel.app/posts/new` をアドレスバーから直接開き、ログイン後に 1 件だけ投稿する。お題詳細で画像が表示されれば、Rails → Cloudinary の本番の経路が通っている
3. 本番で作ったお題を残すか消すかは、ユーザーに確認する（消すなら discard。物理削除しない）
