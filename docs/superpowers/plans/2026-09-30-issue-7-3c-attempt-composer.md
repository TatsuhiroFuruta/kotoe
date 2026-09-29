# お題詳細の描写入力＋生成ポーリング 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** お題詳細で描写を書き、「保存」（下書き）と「画像を生成」（ジョブ起動）ができ、生成の結果（公開・失敗・打ち切り）がフォームの位置に出るようにする。コアループがフロントで一周する。

**Architecture:** 描写フォーム `AttemptComposer` を `PostDetail` の表彰台とみんなの挑戦の間に置く。7-3b の決定 2 により、この位置は並び替え・ページ送りでアンマウントされない。フォームは文面・下書き id・進行状態を `useState` で持ち、保存 → 生成 → ポーリングを順に組み立てる。ポーリングは React に依存しない `pollAttempt()` に置き、取得・待機・時計を差し替えて Vitest で検査する。フックはそれを包んでアンマウント時に中断するだけにする。文言は `attempt-messages.ts` に集める。結果の表示は、表示専用の `GenerationPanel` が担当する。

**Tech Stack:** Next.js 16.2.10（App Router）／ React 19.2.4（`useEffectEvent`）／ TypeScript ／ TailwindCSS 4 ／ Vitest（jsdom）／ Docker Compose。**新しい依存は追加しない。**

**Spec:** `docs/superpowers/specs/2026-09-29-issue-7-3c-attempt-composer-design.md`

**Issue:** GitHub #120（`docs/issues_backlog.md` 7-3c）

**Branch:** `feat/attempt-composer`（作成済み。設計書のコミット `ad026e5` が載っている）

## Global Constraints

このプロジェクト全体の規約。**全タスクの要件に暗黙に含まれる。**

- **依存パッケージを追加しない。** `frontend/package.json` は変更しない。
- **`backend/` のコードは 1 行も変更しない。** API は 4-2 / 4-3 / 4-4 のものをそのまま使う。
- **`frontend/src/app/globals.css` を変更しない。** 過去 4 回の Turbopack stale は、すべてこのファイルの変更で起きている（`frontend/AGENTS.md`）。色は既存のトークン（`bg-canvas` / `bg-surface` / `text-ink` / `text-ink-muted` / `border-line` / `bg-line` / `bg-accent` / `text-accent` / `border-accent` / `text-danger` / `border-danger` / `rounded-card`）だけを使う。`zinc-500` のような生のパレットと `dark:` は書かない。
- **`useSearchParams()` を使わない。** Vercel の本番ビルドだけが落ちる（7-2 の規約）。
- **`dangerouslySetInnerHTML` を使わない**（eslint の `react/no-danger` が error）。描写文は `{value}` で出し、改行は `whitespace-pre-wrap` で反映する。
- **`<img src>` に入れてよいのは `cloudinaryUrlOrNull()` の戻り値だけ。`<a href>` に入れてよいのは `cloudinaryDownloadUrlOrNull()` と `postDetailHref()` の戻り値だけ。** `next/image` は使わない（7-3a 決定 4）。
- **存在しないルートへリンクを置かない。** `/attempts/[id]`（7-4）と `/mypage`（7-6）へのリンクは作らない。
- **文字列はダブルクォート。** コメントは日本語で書き、「何をしているか」ではなく**「なぜそうしたか」**を書く（既存ファイルの書き方に合わせる）。
- **`any` を使わない。** API のレスポンスには型を付ける。
- **テストは `frontend/test/` に置き、`src/` の構造を写す。** コンポーネントのテストは書かない（CLAUDE.md のテスト方針。E2E は 8-1）。
- **env ファイルの中身を表示しない。** 環境変数を一時的に変えるときは、下の「環境変数の一時的な上書き」の override ファイルを使う。`.env.development` は開かない。
- コマンドはリポジトリのルートで実行する。`npm` / `npx` は `docker compose exec frontend <コマンド>` としてコンテナ内で動かす。
- コミットメッセージの末尾は `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` で止める（セッションリンクを書かない）。
- `git checkout` を使わない。ブランチも切り替えない（`feat/attempt-composer` の上だけで作業する）。

### 環境変数の一時的な上書き（Task 5 で使う）

compose は `environment:` を `env_file` より優先する。そのため、スクラッチパッドに override ファイルを置いて `-f` で重ねれば、`.env.development` に触れずに値を変えられる。**戻すときは `-f` を付けずに `docker compose up -d <サービス>` を実行する**（`restart` では env が反映されない。メモリの規約）。

## Review Focus

どのタスクの単体テストも直接は叩かないが、使う人が最初に踏みそうな入力・条件。それぞれの確認は、そのコードを持つタスクに入れてある。

1. **生成中に並び替え・ページ送りを押しても、書きかけの文面と生成中の表示が保たれ、ポーリングが止まらない** → Task 4 の配置（`PostDetail` の `current` 確定後の位置）、Task 5 の手動確認 14
2. **「画像を生成」の連打や、保存中に「画像を生成」を押しても、下書きが 2 つできたり生成が 2 回起動したりしない** → Task 4 の `busy` による disabled、Task 5 の手動確認（ダブルクリックと Rails のログ）
3. **保存したあとに書き換えてから「画像を生成」を押すと、新しい文面で生成される**（古い文面で枠を使わない）→ Task 4 の `text !== savedText` による自動保存、Task 5 の手動確認 2（結果パネルの描写文）
4. **生成中にお題から離れると、ポーリングが止まる**（離れたページが 3 秒ごとに叩き続けない）→ Task 3 のフックの中断と Task 3 のテスト（中断後は取得しない）、Task 5 の手動確認 12（Network タブ）
5. **失効したトークンで保存しても、書いた文面が消えない** → Task 4 の「入力欄は常に表示」と 401 の分岐、Task 5 の手動確認 13

## ファイル構成

| ファイル | 責務 | タスク |
|---|---|---|
| `frontend/src/lib/cloudinary.ts` | 内部関数 `deliveryUrl()` に検証を集め、`cloudinaryDownloadUrl()` / `cloudinaryDownloadUrlOrNull()` を足す | 1 |
| `frontend/test/lib/cloudinary.test.ts` | ダウンロード URL のテストを追加 | 1 |
| `frontend/src/types/api.ts` | `FailureReason` / `AttemptResponse` / `AttemptShowResponse` / `GenerationErrorBody`。`failure_reason` を絞る | 2 |
| `frontend/src/lib/attempts/attempt-messages.ts` | **新規**。文言・翻訳・「あと約 N 時間」・上限の定数 | 2 |
| `frontend/test/lib/attempts/attempt-messages.test.ts` | **新規** | 2 |
| `frontend/src/lib/attempts/poll-attempt.ts` | **新規**。`pollAttempt()`・`shouldConfirmGeneration()` | 3 |
| `frontend/test/lib/attempts/poll-attempt.test.ts` | **新規** | 3 |
| `frontend/src/lib/attempts/use-attempt-polling.ts` | **新規**。薄いフック | 3 |
| `frontend/src/components/attempts/generation-panel.tsx` | **新規**。結果パネル（表示だけ） | 4 |
| `frontend/src/components/attempts/attempt-composer.tsx` | **新規**。描写フォーム | 4 |
| `frontend/src/components/posts/post-detail.tsx` | コメントの位置にフォームを置く | 4 |
| `frontend/src/components/attempts/attempt-list.tsx` | 空状態のコメントだけを更新する | 4 |
| `docs/issues_backlog.md` | 7-3c の決定事項と申し送り | 5 |

---

### Task 1: `cloudinaryDownloadUrl()`

**Files:**
- Modify: `frontend/src/lib/cloudinary.ts`
- Test: `frontend/test/lib/cloudinary.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `cloudinaryDownloadUrl(publicId: string, options: { filename: string }): string`
  - `cloudinaryDownloadUrlOrNull(publicId: string, options: { filename: string }): string | null`（Task 4 の `GenerationPanel` が使う）

- [ ] **Step 1: 失敗するテストを書く**

`frontend/test/lib/cloudinary.test.ts` の import を差し替える。

```ts
import {
  cloudinaryDownloadUrl,
  cloudinaryDownloadUrlOrNull,
  cloudinaryUrl,
  cloudinaryUrlOrNull,
} from "@/lib/cloudinary";
```

ファイル末尾に追加する。

```ts
describe("cloudinaryDownloadUrl", () => {
  const DOWNLOAD = { filename: "kotoe-attempt-12" } as const;

  it("原寸の PNG を添付ファイルとして返す URL を組み立てる", () => {
    // 生成画像は WebP で保存している（4-3）。.webp のまま落とすと macOS のプレビューで
    // 開けない環境があるので f_png、ブラウザに表示させず保存させるので fl_attachment。
    expect(cloudinaryDownloadUrl("kotoe/production/attempts/abc", DOWNLOAD)).toBe(
      "https://res.cloudinary.com/demo/image/upload/f_png,fl_attachment:kotoe-attempt-12/kotoe/production/attempts/abc",
    );
  });

  it("縮小・切り抜きの変換を含めない（ダウンロードは原寸）", () => {
    const transformation = new URL(cloudinaryDownloadUrl("a/b", DOWNLOAD)).pathname.split("/")[4];

    expect(transformation).toBe("f_png,fl_attachment:kotoe-attempt-12");
  });

  it.each(["", "a,b", "a/b", "a:b", "a b", "..", "日本語", "a.png"])(
    "保存名 %j は受け付けない（変換文字列の区切りを混ぜさせない）",
    (filename) => {
      expect(() => cloudinaryDownloadUrl("a/b", { filename })).toThrow();
    },
  );

  it.each(["", "/a", "a//b", "a/../b"])(
    "public_id %j は cloudinaryUrl と同じく受け付けない",
    (publicId) => {
      expect(() => cloudinaryDownloadUrl(publicId, DOWNLOAD)).toThrow();
    },
  );

  it("public_id にどんな文字列が来てもオリジンは res.cloudinary.com に固定される", () => {
    // href に入る値なので、javascript: や別オリジンになってはいけない（CLAUDE.md の XSS）。
    for (const publicId of ["javascript:alert(1)", "data:text/html,x", "@evil.example"]) {
      expect(new URL(cloudinaryDownloadUrl(publicId, DOWNLOAD)).origin).toBe(
        "https://res.cloudinary.com",
      );
    }
  });

  it("cloud name が未設定なら例外を投げる", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "");

    expect(() => cloudinaryDownloadUrl("a/b", DOWNLOAD)).toThrow(
      "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME",
    );
  });
});

describe("cloudinaryDownloadUrlOrNull", () => {
  it("組み立てられるときは cloudinaryDownloadUrl と同じ URL を返す", () => {
    expect(cloudinaryDownloadUrlOrNull("a/b", { filename: "x" })).toBe(
      cloudinaryDownloadUrl("a/b", { filename: "x" }),
    );
  });

  it("組み立てられないときは null を返し、原因を console.error に残す", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(cloudinaryDownloadUrlOrNull("a/../b", { filename: "x" })).toBeNull();
    expect(cloudinaryDownloadUrlOrNull("a/b", { filename: "a,b" })).toBeNull();
    expect(consoleError).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 失敗することを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/cloudinary.test.ts`
Expected: FAIL（`cloudinaryDownloadUrl` が export されていない）

- [ ] **Step 3: 実装する**

`frontend/src/lib/cloudinary.ts` を次の形にする。**`cloudinaryUrl()` の振る舞いは変えない**（既存のテストがそのまま通ること）。

1. 冒頭のコメントの最後の段落（「ダウンロード用の URL（…）は、使う issue（7-3b / 7-4）で足す。」）を次に置き換える。

```ts
 * ダウンロード用の URL は cloudinaryDownloadUrl()（7-3c）。オリジンの固定と public_id の
 * 検証は内部の deliveryUrl() を共有する（同じ検証を 2 箇所に書かない）。
```

2. `cloudinaryUrl()` の本体から、クラウド名・public_id の検証と URL の組み立てを `deliveryUrl()` に移す。

```ts
/**
 * 配信 URL の組み立てと、その前提の検証。表示用・ダウンロード用の両方がここを通る。
 * caller はエラーメッセージに出す呼び出し元の名前（どちらの関数で落ちたかを残すため）。
 */
function deliveryUrl(publicId: string, transformation: string, caller: string): string {
  // 関数の中で読む（モジュールの先頭で読まない）。Next は
  // process.env.NEXT_PUBLIC_* という字面をビルド時に値へ置き換えるので
  // どちらでも本番は動くが、中で読めばテストが vi.stubEnv で差し替えられる。
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  if (!cloudName) {
    throw new Error("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME が設定されていません");
  }

  // public_id は kotoe/<env>/posts/<id> のように / を含む。/ はパスの区切りとして
  // 残し、セグメントごとにエンコードする（? や # が残ると public_id が途中で切れる）。
  //
  // 空・. ・.. のセグメントは拒否する。encodeURIComponent はこれらをそのまま残すので、
  // URL の正規化でパスを上へ辿られる。バックエンドが発行する public_id には
  // 現れないので、来たらデータの異常として落とす。
  const segments = publicId.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`${caller}: public_id の形式が不正です`);
  }
  const path = segments.map(encodeURIComponent).join("/");

  return `${ORIGIN}/${encodeURIComponent(cloudName)}/image/upload/${transformation}/${path}`;
}

export function cloudinaryUrl(publicId: string, { width, aspect }: CloudinaryOptions): string {
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(`cloudinaryUrl: 幅は正の整数で指定してください（${width}）`);
  }

  // f_auto で配信形式（AVIF / WebP など）をブラウザに合わせ、q_auto で画質を自動にする。
  const size =
    aspect === undefined ? `c_fit,w_${width},h_${width}` : `c_fill,ar_${aspect},w_${width}`;

  return deliveryUrl(publicId, `${size},f_auto,q_auto`, "cloudinaryUrl");
}
```

3. `cloudinaryUrlOrNull()` の下に追加する。

```ts
/**
 * 保存名に使ってよい文字。fl_attachment:<名前> は変換文字列の一部なので、区切り
 * （, / :）や空白が混ざると別の変換として解釈される。呼び出し側は kotoe-attempt-<id> を渡す。
 */
const FILENAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * 生成画像のダウンロード URL（4-3 からの申し送り）。
 *
 * - f_png：保存形式の WebP を PNG にする（.webp は macOS のプレビューで開けない環境がある）
 * - fl_attachment：Content-Disposition: attachment で返させる。<a download> は別オリジンでは
 *   効かないので、保存させるにはこれが要る
 * - 縮小しない（原寸 1024px）。表示用と変換が違うので派生画像は別になるが、押された回数しか作られない
 */
export function cloudinaryDownloadUrl(publicId: string, { filename }: { filename: string }): string {
  if (!FILENAME_PATTERN.test(filename)) {
    throw new Error(`cloudinaryDownloadUrl: 保存名は英数字・-・_ で指定してください（${filename}）`);
  }

  return deliveryUrl(publicId, `f_png,fl_attachment:${filename}`, "cloudinaryDownloadUrl");
}

/** 描画中に使う版。cloudinaryUrlOrNull() と同じ理由で、例外を null に丸めて原因を残す。 */
export function cloudinaryDownloadUrlOrNull(
  publicId: string,
  options: { filename: string },
): string | null {
  try {
    return cloudinaryDownloadUrl(publicId, options);
  } catch (error) {
    console.error("ダウンロード用の URL を組み立てられませんでした", error);
    return null;
  }
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/cloudinary.test.ts && docker compose exec frontend npx tsc --noEmit`
Expected: 既存と追加分がすべて PASS、型エラー 0

- [ ] **Step 5: ミューテーションで確かめる（確かめたら必ず元に戻す）**

`deliveryUrl()` の `segment === ".."` を消す → `a/../b` のテストが FAIL すること。`FILENAME_PATTERN` を `/^.+$/` にする → 保存名のテストが FAIL すること。どちらも戻したあと、Step 4 が再び PASS することを確かめる。

- [ ] **Step 6: コミット**

```bash
git add frontend/src/lib/cloudinary.ts frontend/test/lib/cloudinary.test.ts
git commit -m "feat: 生成画像のダウンロード URL を組み立てる cloudinaryDownloadUrl を足す

f_png と fl_attachment を付ける（4-3 からの申し送り）。オリジンの固定と
public_id の検証は表示用の cloudinaryUrl と内部関数で共有する。

Refs #120

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 型と文言（`attempt-messages.ts`）

**Files:**
- Modify: `frontend/src/types/api.ts`
- Create: `frontend/src/lib/attempts/attempt-messages.ts`
- Test: `frontend/test/lib/attempts/attempt-messages.test.ts`

**Interfaces:**
- Consumes: `ApiError`（`@/lib/api`）、`toRequestErrorMessage` / `SERVER_MESSAGE` / `NETWORK_MESSAGE`（`@/lib/request-error-messages`）
- Produces（Task 3・4 が使う）:
  - 型：`FailureReason`、`AttemptResponse = { attempt: Attempt }`、`AttemptShowResponse = { attempt: Attempt; post: PostSummary }`、`GenerationErrorBody`
  - 定数：`DESCRIPTION_MAX_LENGTH`（1000）、`DRAFT_SAVED_MESSAGE`、`DRAFT_GONE_MESSAGE`、`POST_GONE_MESSAGE`、`GENERATE_TARGET_GONE_MESSAGE`、`GENERATION_NOT_STARTED_MESSAGE`、`QUOTA_USED_NOTE`
  - 関数：`apiErrorCode(error: unknown): string | null`、`failureReasonMessage(reason: string | null): string`、`resetsInText(resetsAt: unknown, now: number): string | null`、`generationErrorMessage(error: unknown, now: number): string | null`、`descriptionFieldError(error: unknown): string | null`、`fallbackErrorMessage(error: unknown): string`

- [ ] **Step 1: 型を足す**

`frontend/src/types/api.ts` の `AttemptStatus` の下に追加する。

```ts
/**
 * 生成が失敗した理由（Attempt::FAILURE_REASONS）。文言はフロントの辞書
 * （lib/attempts/attempt-messages.ts）が持つ。未知の値が来ても表示は辞書側が丸める。
 */
export type FailureReason =
  | "content_policy"
  | "rate_limited"
  | "api_error"
  | "upload_failed"
  | "internal_error"
  | "generation_disabled";
```

`Attempt` の `failure_reason` を差し替える。

```ts
  /** failed のときだけ値が入る */
  failure_reason: FailureReason | null;
```

ファイル末尾に追加する。

```ts
/** POST /api/posts/:id/attempts・PATCH /api/attempts/:id・POST /api/attempts/:id/generate */
export type AttemptResponse = {
  attempt: Attempt;
};

/** GET /api/attempts/:id。published 以外は本人にしか見えず、それ以外は 404 */
export type AttemptShowResponse = {
  attempt: Attempt;
  post: PostSummary;
};

/**
 * 生成を起動できなかったときのボディ（422 / 503）。limit は個人の上限のときだけ、
 * resets_at（JST の翌 0 時を UTC の ISO 8601 で）は上限のときだけ付く。
 */
export type GenerationErrorBody = {
  error: string;
  limit?: number;
  resets_at?: string;
};
```

- [ ] **Step 2: 失敗するテストを書く**

`frontend/test/lib/attempts/attempt-messages.test.ts` を作る。

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, ApiTimeoutError } from "@/lib/api";
import {
  apiErrorCode,
  descriptionFieldError,
  fallbackErrorMessage,
  failureReasonMessage,
  generationErrorMessage,
  resetsInText,
} from "@/lib/attempts/attempt-messages";
import { NETWORK_MESSAGE, SERVER_MESSAGE, TIMEOUT_MESSAGE } from "@/lib/request-error-messages";

const NOW = Date.parse("2026-09-30T10:00:00Z");
const HOUR = 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("apiErrorCode", () => {
  it("ApiError のボディの error を返す", () => {
    expect(apiErrorCode(new ApiError(422, { error: "attempt_not_draft" }))).toBe("attempt_not_draft");
  });

  it.each([
    ["文字列でない error", new ApiError(422, { error: 1 })],
    ["JSON でないボディ", new ApiError(502, "<html>")],
    ["ApiError でない", new TypeError("Failed to fetch")],
  ])("%s なら null", (_label, error) => {
    expect(apiErrorCode(error)).toBeNull();
  });
});

describe("failureReasonMessage", () => {
  it.each([
    ["content_policy", "規約"],
    ["rate_limited", "混み合って"],
    ["api_error", "画像生成サービスでエラー"],
    ["upload_failed", "保存できませんでした"],
    ["internal_error", "サーバーでエラー"],
    ["generation_disabled", "一時停止"],
  ])("%s を翻訳する", (reason, fragment) => {
    expect(failureReasonMessage(reason)).toContain(fragment);
  });

  it("未知のコードでもコードを含めた文を返す（無言にしない）", () => {
    expect(failureReasonMessage("new_reason")).toContain("new_reason");
  });

  it("Object.prototype のキー名を辞書の値と取り違えない", () => {
    // `reason in FAILURE_MESSAGES` と書くと toString が関数として返り、画面に関数の文字列が出る。
    expect(failureReasonMessage("toString")).toContain("toString");
    expect(failureReasonMessage("toString")).toContain("生成できませんでした");
  });

  it("null でも文を返す", () => {
    expect(failureReasonMessage(null)).toContain("生成できませんでした");
  });
});

describe("resetsInText", () => {
  it("残りを時間単位で切り上げる", () => {
    expect(resetsInText(at(5 * HOUR), NOW)).toBe("あと約 5 時間で");
    expect(resetsInText(at(HOUR + 60_000), NOW)).toBe("あと約 2 時間で");
  });

  it("1 時間以下なら「1 時間以内に」", () => {
    expect(resetsInText(at(HOUR), NOW)).toBe("1 時間以内に");
    expect(resetsInText(at(59 * 60_000), NOW)).toBe("1 時間以内に");
  });

  it.each([
    ["過去", at(-1)],
    ["ちょうど今", at(0)],
    ["壊れた文字列", "not-a-date"],
    ["文字列でない", 12345],
    ["未指定", undefined],
  ])("%s なら null（壊れた値を文に出さない）", (_label, value) => {
    expect(resetsInText(value, NOW)).toBeNull();
  });
});

describe("generationErrorMessage", () => {
  it("個人の上限：回数と回復までの時間を入れる", () => {
    const error = new ApiError(422, {
      error: "generation_limit_reached",
      limit: 3,
      resets_at: at(5 * HOUR),
    });

    expect(generationErrorMessage(error, NOW)).toBe(
      "今日の生成回数（3 回）を使い切りました。あと約 5 時間で回復します",
    );
  });

  it("個人の上限：limit と resets_at が無い・壊れていれば、その部分を省く", () => {
    const error = new ApiError(422, { error: "generation_limit_reached", limit: "3", resets_at: "x" });

    expect(generationErrorMessage(error, NOW)).toBe("今日の生成回数を使い切りました。");
  });

  it("サービス全体の上限（503）", () => {
    const error = new ApiError(503, {
      error: "service_generation_limit_reached",
      resets_at: at(30 * 60_000),
    });

    expect(generationErrorMessage(error, NOW)).toBe(
      "本日はサービス全体の生成上限に達しました。1 時間以内に回復します",
    );
  });

  it("キルスイッチ（503）", () => {
    expect(generationErrorMessage(new ApiError(503, { error: "generation_disabled" }), NOW)).toContain(
      "一時停止",
    );
  });

  it.each([
    ["attempt_not_draft", new ApiError(422, { error: "attempt_not_draft" })],
    ["ステータスとコードの組み合わせが違う", new ApiError(422, { error: "generation_disabled" })],
    ["コードの無い 503", new ApiError(503, "<html>")],
    ["404", new ApiError(404, null)],
    ["通信断", new TypeError("Failed to fetch")],
  ])("対応しないもの（%s）は null（呼び出し側が別の扱いにする）", (_label, error) => {
    expect(generationErrorMessage(error, NOW)).toBeNull();
  });
});

describe("descriptionFieldError", () => {
  it.each([
    ["blank", "描写を入力してください"],
    ["too_long", "1000 文字以内"],
  ])("%s を翻訳する", (code, fragment) => {
    expect(descriptionFieldError(new ApiError(422, { errors: { description: [code] } }))).toContain(
      fragment,
    );
  });

  it("未知のコードはコードを含めた文にする", () => {
    expect(
      descriptionFieldError(new ApiError(422, { errors: { description: ["too_short"] } })),
    ).toContain("too_short");
  });

  it.each([
    ["description 以外のフィールド", new ApiError(422, { errors: { base: ["x"] } })],
    ["errors の無い 422", new ApiError(422, { error: "attempt_not_draft" })],
    ["配列でない", new ApiError(422, { errors: { description: "blank" } })],
    ["422 以外", new ApiError(404, { errors: { description: ["blank"] } })],
    ["ApiError でない", new TypeError("Failed to fetch")],
  ])("%s は null", (_label, error) => {
    expect(descriptionFieldError(error)).toBeNull();
  });
});

describe("fallbackErrorMessage", () => {
  it("5xx・timeout・通信断は通信エラーの文言", () => {
    expect(fallbackErrorMessage(new ApiError(500, null))).toBe(SERVER_MESSAGE);
    expect(fallbackErrorMessage(new ApiTimeoutError(15_000))).toBe(TIMEOUT_MESSAGE);
    expect(fallbackErrorMessage(new TypeError("Failed to fetch"))).toBe(NETWORK_MESSAGE);
  });

  it("未知の 4xx はコード（無ければステータス）を含めた文にする（無言にしない）", () => {
    expect(fallbackErrorMessage(new ApiError(409, { error: "conflict_x" }))).toContain("conflict_x");
    expect(fallbackErrorMessage(new ApiError(400, null))).toContain("400");
  });
});
```

- [ ] **Step 3: 失敗することを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/attempts/attempt-messages.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 4: 実装する**

`frontend/src/lib/attempts/attempt-messages.ts` を作る。

```ts
// 挑戦（描写・生成）まわりの文言。バックはエラーコードだけを返し、日本語はここに集める
// （CLAUDE.md「メッセージ・エラー・i18n の責務」）。
//
// 通信そのものの失敗（timeout・通信断・5xx）の文言は lib/request-error-messages.ts にある。

import { ApiError } from "@/lib/api";
import { toRequestErrorMessage } from "@/lib/request-error-messages";
import type { FailureReason } from "@/types/api";

/**
 * 描写文の上限。backend の Attempt::MAX_DESCRIPTION_LENGTH と揃える。
 * 用途は文字数カウンターの表示だけで、判定はサーバーの 422 に任せる（7-3c 設計書「決定 9」）。
 */
export const DESCRIPTION_MAX_LENGTH = 1_000;

export const DRAFT_SAVED_MESSAGE = "下書きを保存しました";
export const DRAFT_GONE_MESSAGE =
  "この下書きは生成済みか削除されています。もう一度保存すると新しい下書きになります";
export const POST_GONE_MESSAGE = "このお題は削除されました";
export const GENERATE_TARGET_GONE_MESSAGE = "この下書きは削除されたか、お題が削除されています";
export const GENERATION_NOT_STARTED_MESSAGE = "生成を開始できませんでした。もう一度お試しください";

/** 失敗パネルに必ず添える。枠は enqueue 時に消費し、失敗しても戻らない（ドメインの重要ルール）。 */
export const QUOTA_USED_NOTE = "この生成で今日の生成回数を 1 回使いました";

const FAILURE_MESSAGES: Record<FailureReason, string> = {
  content_policy:
    "描写の内容が画像生成サービスの規約に触れたため、生成できませんでした。表現を変えて再挑戦してください",
  rate_limited:
    "画像生成サービスが混み合っていたため、生成できませんでした。時間をおいて再挑戦してください",
  api_error: "画像生成サービスでエラーが発生したため、生成できませんでした",
  upload_failed: "生成した画像を保存できませんでした",
  internal_error: "サーバーでエラーが発生したため、生成できませんでした",
  generation_disabled: "画像生成が一時停止されたため、生成できませんでした",
};

const DESCRIPTION_MESSAGES: Record<string, string> = {
  blank: "描写を入力してください",
  too_long: `描写は ${DESCRIPTION_MAX_LENGTH} 文字以内で入力してください`,
};

const HOUR_MS = 60 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 辞書に自前のキーとしてあるか。`key in record` は Object.prototype のキー（toString など）
 * にも true を返し、関数が文言として画面に出てしまう。
 */
function hasOwnKey<T extends object>(record: T, key: string): key is Extract<keyof T, string> {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** ApiError のボディの error（エラーコード）。無ければ null。 */
export function apiErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError) || !isRecord(error.body)) return null;
  return typeof error.body.error === "string" ? error.body.error : null;
}

/** failure_reason を 1 文にする。未知のコード・null でも必ず何かを返す（無言にしない）。 */
export function failureReasonMessage(reason: string | null): string {
  if (reason !== null && hasOwnKey(FAILURE_MESSAGES, reason)) return FAILURE_MESSAGES[reason];
  return `生成できませんでした（${reason ?? "理由不明"}）`;
}

/**
 * resets_at から「あと約 N 時間で」を作る。時間は切り上げ（「あと約 0 時間」を出さないため）。
 * 壊れた値・過去の時刻なら null を返し、呼び出し側はその節ごと省く。
 */
export function resetsInText(resetsAt: unknown, now: number): string | null {
  if (typeof resetsAt !== "string") return null;

  const resetsAtMs = Date.parse(resetsAt);
  if (Number.isNaN(resetsAtMs)) return null;

  const remaining = resetsAtMs - now;
  if (remaining <= 0) return null;
  if (remaining <= HOUR_MS) return "1 時間以内に";

  return `あと約 ${Math.ceil(remaining / HOUR_MS)} 時間で`;
}

/**
 * POST :generate の業務エラー（上限・キルスイッチ）を 1 文にする。
 * それ以外は null を返す。呼び出し側が 404・応答不明（7-3c 設計書「決定 10」）へ振り分ける。
 */
export function generationErrorMessage(error: unknown, now: number): string | null {
  if (!(error instanceof ApiError) || !isRecord(error.body)) return null;

  const { body } = error;
  const resets = resetsInText(body.resets_at, now);
  const recovery = resets === null ? "" : `${resets}回復します`;

  if (error.status === 422 && body.error === "generation_limit_reached") {
    const limit =
      typeof body.limit === "number" && Number.isInteger(body.limit) && body.limit > 0
        ? `（${body.limit} 回）`
        : "";
    return `今日の生成回数${limit}を使い切りました。${recovery}`;
  }

  if (error.status === 503 && body.error === "service_generation_limit_reached") {
    return `本日はサービス全体の生成上限に達しました。${recovery}`;
  }

  if (error.status === 503 && body.error === "generation_disabled") {
    return "現在、画像生成を一時停止しています。時間をおいて再度お試しください";
  }

  return null;
}

/** 保存の 422 のうち description のエラーを 1 文にする。入力欄の下に出す。該当しなければ null。 */
export function descriptionFieldError(error: unknown): string | null {
  if (!(error instanceof ApiError) || error.status !== 422) return null;
  if (!isRecord(error.body) || !isRecord(error.body.errors)) return null;

  const codes = error.body.errors.description;
  if (!Array.isArray(codes)) return null;

  const code = codes.find((candidate): candidate is string => typeof candidate === "string");
  if (code === undefined) return null;

  return hasOwnKey(DESCRIPTION_MESSAGES, code)
    ? DESCRIPTION_MESSAGES[code]
    : `描写の内容を確認してください（${code}）`;
}

/**
 * どの分岐にも当たらなかった失敗。4xx はコード（無ければステータス）を含めて出す
 * （無言にしない）。5xx・timeout・通信断は通信エラーの文言に揃える。
 */
export function fallbackErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status < 500) {
    return `操作を完了できませんでした（${apiErrorCode(error) ?? error.status}）`;
  }
  return toRequestErrorMessage(error);
}
```

- [ ] **Step 5: 通ることを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/attempts/attempt-messages.test.ts && docker compose exec frontend npx tsc --noEmit`
Expected: PASS、型エラー 0（`failure_reason` を絞ったことで、既存コードに型エラーが出ないこと）

- [ ] **Step 6: ミューテーションで確かめる（確かめたら必ず元に戻す）**

`resetsInText` の `remaining <= HOUR_MS` を `remaining < HOUR_MS` にする → 「ちょうど 1 時間」が FAIL すること。`Math.ceil` を `Math.round` にする → 「61 分 → 約 2 時間」が FAIL すること。`hasOwnKey(...)` を `reason in FAILURE_MESSAGES` にする → `toString` のテストが FAIL すること。どれも戻したあと、Step 5 が再び PASS することを確かめる。

- [ ] **Step 7: コミット**

```bash
git add frontend/src/types/api.ts frontend/src/lib/attempts/attempt-messages.ts frontend/test/lib/attempts/attempt-messages.test.ts
git commit -m "feat: 描写・生成のエラーコードと失敗理由を翻訳する attempt-messages を足す

上限到達の「あと約 N 時間」は resets_at から切り上げで組み立て、壊れた値は
節ごと省く。未知のコードもコードを含めた文にして無言にしない。

Refs #120

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: ポーリング（`pollAttempt`・`shouldConfirmGeneration`・フック）

**Files:**
- Create: `frontend/src/lib/attempts/poll-attempt.ts`
- Create: `frontend/src/lib/attempts/use-attempt-polling.ts`
- Test: `frontend/test/lib/attempts/poll-attempt.test.ts`

**Interfaces:**
- Consumes: `apiFetch` / `ApiError` / `ApiTimeoutError`（`@/lib/api`）、`apiErrorCode`（Task 2）、`Attempt` / `AttemptShowResponse`（Task 2）
- Produces（Task 4 が使う）:
  - `type PollOutcome = { kind: "settled"; attempt: Attempt } | { kind: "not_found" } | { kind: "timed_out" }`
  - `pollAttempt(attemptId: number, options: PollOptions): Promise<PollOutcome>`
  - `shouldConfirmGeneration(error: unknown): boolean`
  - `useAttemptPolling(target: { attemptId: number; immediate: boolean } | null, onOutcome: (outcome: PollOutcome, attemptId: number) => void): void`

- [ ] **Step 1: 失敗するテストを書く**

`frontend/test/lib/attempts/poll-attempt.test.ts` を作る。

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, ApiTimeoutError } from "@/lib/api";
import { pollAttempt, shouldConfirmGeneration } from "@/lib/attempts/poll-attempt";
import type { Attempt, AttemptStatus } from "@/types/api";

function attempt(status: AttemptStatus): Attempt {
  return {
    id: 7,
    description: "描写",
    generated_image_public_id: status === "published" ? "kotoe/test/attempts/7" : null,
    status,
    failure_reason: status === "failed" ? "api_error" : null,
    similarity_score: null,
    user: { id: 1, name: "テスト" },
    likes_count: 0,
    liked: false,
    created_at: "2026-09-30T00:00:00Z",
  };
}

/**
 * 時計・待機・取得を差し替える。待機は時計を進めるだけで実時間を使わない。
 * fetchTimes には「取得したときの時計の値」が順に入る。
 * 用意した応答を使い切ったあとの取得は Error を投げる。pollAttempt はそれを通信エラーとして
 * 続行するので、締め切りで必ず止まる（テストが無限に回らない）。
 */
function harness(responses: Array<Attempt | Error>) {
  let clock = 0;
  const fetchTimes: number[] = [];
  // 型引数で引数の形を与える（使わない引数を書くと no-unused-vars に掛かるため）。
  const fetchAttempt = vi.fn<(id: number, signal: AbortSignal) => Promise<Attempt>>(async () => {
    fetchTimes.push(clock);
    const next = responses.shift();
    if (next === undefined) throw new Error("用意した応答より多く取得した");
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = vi.fn<(ms: number, signal: AbortSignal) => Promise<void>>(async (ms) => {
    clock += ms;
  });
  return { fetchAttempt, sleep, now: () => clock, fetchTimes };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("pollAttempt", () => {
  it("既定では 3 秒待ってから取得し、generating の間は取得を繰り返す", async () => {
    const h = harness([attempt("generating"), attempt("generating"), attempt("published")]);

    const outcome = await pollAttempt(7, { signal: new AbortController().signal, ...h });

    expect(outcome).toEqual({ kind: "settled", attempt: attempt("published") });
    expect(h.fetchTimes).toEqual([3_000, 6_000, 9_000]);
    expect(h.fetchAttempt).toHaveBeenCalledWith(7, expect.any(AbortSignal));
  });

  it("immediate なら最初の 1 回は待たずに取得する（応答が不明だったときの確認）", async () => {
    const h = harness([attempt("generating"), attempt("published")]);

    await pollAttempt(7, { signal: new AbortController().signal, immediate: true, ...h });

    expect(h.fetchTimes).toEqual([0, 3_000]);
  });

  it.each(["failed", "draft"] as const)("%s も generating 以外なので settled で返す", async (status) => {
    const h = harness([attempt(status)]);

    const outcome = await pollAttempt(7, { signal: new AbortController().signal, ...h });

    expect(outcome).toEqual({ kind: "settled", attempt: attempt(status) });
  });

  it("通信断・5xx・timeout・401 では止まらずに続行する", async () => {
    // 生成は進んでいるのに一時的な失敗で「失敗しました」と言うと誤診になる。
    // 401 は実際には来ない（GET は認証不要で、失効したトークンは無視されて 404 になる）が、
    // 来ても止めない。
    const h = harness([
      new TypeError("Failed to fetch"),
      new ApiError(500, null),
      new ApiTimeoutError(15_000),
      new ApiError(401, { error: "unauthorized" }),
      attempt("published"),
    ]);

    const outcome = await pollAttempt(7, { signal: new AbortController().signal, ...h });

    expect(outcome.kind).toBe("settled");
    expect(h.fetchAttempt).toHaveBeenCalledTimes(5);
  });

  it("404 で止まり、それ以上取得しない", async () => {
    const h = harness([new ApiError(404, null), attempt("published")]);

    const outcome = await pollAttempt(7, { signal: new AbortController().signal, ...h });

    expect(outcome).toEqual({ kind: "not_found" });
    expect(h.fetchAttempt).toHaveBeenCalledTimes(1);
  });

  it("締め切りに達したら取得せずに timed_out を返す", async () => {
    const h = harness([attempt("generating"), attempt("generating"), attempt("published")]);

    const outcome = await pollAttempt(7, {
      signal: new AbortController().signal,
      deadlineMs: 9_000,
      ...h,
    });

    // 3 秒・6 秒で取得し、9 秒の時点で締め切り（>=）に達しているので取得しない。
    expect(outcome).toEqual({ kind: "timed_out" });
    expect(h.fetchTimes).toEqual([3_000, 6_000]);
  });

  it("締め切りの直前の取得は捨てない", async () => {
    const h = harness([attempt("generating"), attempt("generating"), attempt("published")]);

    const outcome = await pollAttempt(7, {
      signal: new AbortController().signal,
      deadlineMs: 9_001,
      ...h,
    });

    expect(outcome.kind).toBe("settled");
    expect(h.fetchTimes).toEqual([3_000, 6_000, 9_000]);
  });

  it("既定の締め切りは 6 分", async () => {
    const h = harness([]);

    const outcome = await pollAttempt(7, { signal: new AbortController().signal, ...h });

    expect(outcome).toEqual({ kind: "timed_out" });
    // 3 秒ごとに 360 秒の手前まで：3, 6, …, 357 秒の 119 回。
    expect(h.fetchAttempt).toHaveBeenCalledTimes(119);
  });

  it("前の取得が終わるまで次の待機に入らない（リクエストを重ねない）", async () => {
    let resolveFetch: (value: Attempt) => void = () => {};
    const sleep = vi.fn(async () => {});
    const fetchAttempt = vi.fn(
      () => new Promise<Attempt>((resolve) => (resolveFetch = resolve)),
    );

    const promise = pollAttempt(7, { signal: new AbortController().signal, sleep, fetchAttempt });
    // 取得を保留にしたまま、マイクロタスクを十分に回す。
    for (let i = 0; i < 10; i += 1) await Promise.resolve();

    expect(fetchAttempt).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(1);

    resolveFetch(attempt("published"));
    await expect(promise).resolves.toEqual({ kind: "settled", attempt: attempt("published") });
  });

  it("待機中に中断すると AbortError で reject し、取得しない（既定の待機）", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchAttempt = vi.fn(async () => attempt("published"));

    const promise = pollAttempt(7, { signal: controller.signal, fetchAttempt });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchAttempt).not.toHaveBeenCalled();
  });

  it("取得中に中断すると、失敗を通信エラーとして続行せずに reject する", async () => {
    const controller = new AbortController();
    const h = harness([]);
    // 本物の fetch と同じく、中断されたら signal.reason で reject する。
    h.fetchAttempt.mockImplementation(
      (_id, signal) =>
        new Promise<Attempt>((_resolve, reject) => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          queueMicrotask(() => controller.abort());
        }),
    );

    const promise = pollAttempt(7, { signal: controller.signal, immediate: true, ...h });

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(h.fetchAttempt).toHaveBeenCalledTimes(1);
  });
});

describe("shouldConfirmGeneration", () => {
  it.each([
    ["timeout", new ApiTimeoutError(15_000)],
    ["通信断", new TypeError("Failed to fetch")],
    ["500", new ApiError(500, null)],
    ["コードの無い 503（プロキシのエラーページ）", new ApiError(503, "<html>")],
    ["attempt_not_draft（もう generating になっている）", new ApiError(422, { error: "attempt_not_draft" })],
  ])("%s は応答が不明なので状態を確かめる", (_label, error) => {
    expect(shouldConfirmGeneration(error)).toBe(true);
  });

  it.each([
    ["個人の上限", new ApiError(422, { error: "generation_limit_reached" })],
    ["全体の上限", new ApiError(503, { error: "service_generation_limit_reached" })],
    ["キルスイッチ", new ApiError(503, { error: "generation_disabled" })],
    ["404", new ApiError(404, null)],
    ["401", new ApiError(401, { error: "unauthorized" })],
    ["想定外の例外", new Error("bug")],
  ])("%s は確かめない（起動していないことが確定している）", (_label, error) => {
    expect(shouldConfirmGeneration(error)).toBe(false);
  });
});
```

- [ ] **Step 2: 失敗することを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/attempts/poll-attempt.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: `poll-attempt.ts` を実装する**

```ts
// 生成中の挑戦を、終端状態になるまで追う（7-3c 設計書「決定 3」）。
//
// React を知らない非同期関数にしてあるのは、ここにだけ Vitest を書くため
// （React Testing Library を採用していないので、フックは検査できない）。
// 取得・待機・時計を引数で差し替えられる。

import { ApiError, ApiTimeoutError, apiFetch } from "@/lib/api";
import { apiErrorCode } from "@/lib/attempts/attempt-messages";
import type { Attempt, AttemptShowResponse } from "@/types/api";

/** 本番の生成は約 29 秒（4-3 の実測）。3 秒ならおよそ 10 回で済む。 */
export const POLL_INTERVAL_MS = 3_000;

/**
 * 打ち切り。最悪ケース（OpenAI の timeout 150 秒 × 2 回＋アップロードの再試行）が約 5 分。
 * 打ち切っても生成は失敗ではない（枠は消費済み）ので、画面は「まだ生成しています」と言う。
 */
export const POLL_DEADLINE_MS = 360_000;

export type PollOutcome =
  | { kind: "settled"; attempt: Attempt }
  | { kind: "not_found" }
  | { kind: "timed_out" };

export type PollOptions = {
  /** 中断したら AbortError（signal.reason）で reject する。アンマウントで止めるため */
  signal: AbortSignal;
  /** true なら最初の 1 回を待たずに取得する（生成の応答が不明だったときの確認。決定 10） */
  immediate?: boolean;
  intervalMs?: number;
  deadlineMs?: number;
  fetchAttempt?: (attemptId: number, signal: AbortSignal) => Promise<Attempt>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
};

async function fetchAttemptFromApi(attemptId: number, signal: AbortSignal): Promise<Attempt> {
  const { attempt } = await apiFetch<AttemptShowResponse>(`/api/attempts/${attemptId}`, { signal });
  return attempt;
}

/** 中断できる待機。中断されたら、その時点で signal.reason で reject する。 */
function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function pollAttempt(attemptId: number, options: PollOptions): Promise<PollOutcome> {
  const {
    signal,
    immediate = false,
    intervalMs = POLL_INTERVAL_MS,
    deadlineMs = POLL_DEADLINE_MS,
    fetchAttempt = fetchAttemptFromApi,
    sleep = sleepWithSignal,
    now = Date.now,
  } = options;
  const startedAt = now();
  let skipWait = immediate;

  for (;;) {
    // 前の取得が終わってから待機に入る。setInterval にしないのは、遅い応答が
    // 積み重なって同時に何本も飛ぶのを防ぐため。
    if (!skipWait) await sleep(intervalMs, signal);
    skipWait = false;
    if (signal.aborted) throw signal.reason;

    // 取得の前に判定する（締め切り直前の取得は捨てない）。
    if (now() - startedAt >= deadlineMs) return { kind: "timed_out" };

    try {
      const attempt = await fetchAttempt(attemptId, signal);
      if (signal.aborted) throw signal.reason;
      if (attempt.status !== "generating") return { kind: "settled", attempt };
    } catch (error) {
      // 自分で中断したものは通信エラーとして続行しない。
      if (signal.aborted) throw signal.reason;
      // 削除された。待っても変わらない。
      if (error instanceof ApiError && error.status === 404) return { kind: "not_found" };
      // それ以外（通信断・5xx・timeout）は続行する。一時的な失敗で「失敗しました」と
      // 言うと、生成は進んでいるのに誤診になる。
    }
  }
}

/** 起動していないことが確定している生成エラー。これらは確かめずに文で出す。 */
const DEFINITE_GENERATION_ERRORS = new Set([
  "generation_limit_reached",
  "service_generation_limit_reached",
  "generation_disabled",
]);

/**
 * POST :generate の失敗のうち、「実はサーバー側で起動済みかもしれない」もの（決定 10）。
 *
 * 応答だけが失われた場合（timeout・通信断・5xx）と、もう generating になっている場合
 * （attempt_not_draft）。これらを通常のエラーとして出すと、生成は進んでいて枠も減って
 * いるのに、画面は失敗と言うことになる。
 */
export function shouldConfirmGeneration(error: unknown): boolean {
  if (error instanceof ApiTimeoutError || error instanceof TypeError) return true;
  if (!(error instanceof ApiError)) return false;

  const code = apiErrorCode(error);
  if (code !== null && DEFINITE_GENERATION_ERRORS.has(code)) return false;
  if (error.status >= 500) return true;
  return error.status === 422 && code === "attempt_not_draft";
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/attempts/poll-attempt.test.ts && docker compose exec frontend npx tsc --noEmit`
Expected: PASS、型エラー 0

jsdom の `AbortSignal` で `signal.reason` が `undefined` になり、「待機中に中断」のテストが `name` の照合で落ちた場合：`controller.abort()` を `controller.abort(new DOMException("Aborted", "AbortError"))` に変えて動かす。**実装は変えない**（テストの前提を合わせるだけ）。そのうえで、この事実を計画の末尾「実装時の差分」に書き残す。

- [ ] **Step 5: ミューテーションで確かめる（確かめたら必ず元に戻す）**

1 つずつ壊し、テストが FAIL することを確かめる。

- `now() - startedAt >= deadlineMs` の `>=` を `>` にする →「締め切りに達したら」が FAIL
- `if (!skipWait)` を `if (true)` にする →「immediate なら」が FAIL
- `return { kind: "not_found" }` の行を消す →「404 で止まり」が FAIL
- `await fetchAttempt(...)` の `await` を外す（型エラーは `as unknown as Attempt` で黙らせる）→「重ねない」か「既定では 3 秒待って」が FAIL
- `sleepWithSignal()` の `signal.addEventListener("abort", onAbort, { once: true });` を消す →「待機中に中断すると」が FAIL（reject されずにテストが timeout する）

catch 内と待機後にある `if (signal.aborted) throw signal.reason;` は、互いに補い合う防御なので、片方だけを消してもテストは赤くならない（中断は必ずどちらかで拾われる）。ミューテーションの対象にしない。

すべて戻したあと、Step 4 が再び PASS することを確かめる。

- [ ] **Step 6: フックを実装する**

`frontend/src/lib/attempts/use-attempt-polling.ts` を作る。

```ts
import { useEffect, useEffectEvent } from "react";

import { type PollOutcome, pollAttempt } from "@/lib/attempts/poll-attempt";

/**
 * pollAttempt を画面につなぐ薄いフック（7-3c 設計書「決定 3」）。
 *
 * target が null の間は何もしない。attemptId・immediate が変わるかアンマウントされたら
 * 走っているポーリングを中断する（お題から離れたページが 3 秒ごとに叩き続けないように）。
 *
 * 「もう一度確認」は、いったん target を null にして（stalled）から同じ attemptId で
 * 渡し直す。間に null を挟むので、同じ値でも effect は走り直す。
 *
 * onOutcome は useEffectEvent で包む。依存配列に入れると、呼び出し側が再描画のたびに
 * 作り直す関数のせいでポーリングが毎回やり直しになる。
 */
export function useAttemptPolling(
  target: { attemptId: number; immediate: boolean } | null,
  onOutcome: (outcome: PollOutcome, attemptId: number) => void,
): void {
  const handleOutcome = useEffectEvent(onOutcome);
  const attemptId = target?.attemptId ?? null;
  const immediate = target?.immediate ?? false;

  useEffect(() => {
    if (attemptId === null) return;

    const controller = new AbortController();

    pollAttempt(attemptId, { signal: controller.signal, immediate })
      .then((outcome) => handleOutcome(outcome, attemptId))
      .catch((error: unknown) => {
        // 自分で中断した（アンマウント・対象の変更）ものは失敗ではない。
        if (controller.signal.aborted) return;
        // pollAttempt は中断以外で reject しない作りだが、想定外の例外で「生成中…」の
        // まま固まらないように、打ち切りとして扱う（「もう一度確認」が出る）。
        console.error("生成状況の確認で想定外のエラーが発生しました", error);
        handleOutcome({ kind: "timed_out" }, attemptId);
      });

    return () => controller.abort();
  }, [attemptId, immediate]);
}
```

- [ ] **Step 7: 型と lint を確かめる**

Run: `docker compose exec frontend npx tsc --noEmit && docker compose exec frontend npm run lint`
Expected: エラー 0。`useEffectEvent` について react-hooks の lint が警告を出した場合は、その文面を読んでから判断する。**`eslint-disable` で黙らせない。**

- [ ] **Step 8: コミット**

```bash
git add frontend/src/lib/attempts/poll-attempt.ts frontend/src/lib/attempts/use-attempt-polling.ts frontend/test/lib/attempts/poll-attempt.test.ts
git commit -m "feat: 生成中の挑戦を終端状態まで追う pollAttempt とフックを足す

3 秒間隔・6 分で打ち切り。前の応答を待ってから次を送り、通信エラーでは
続行、404 で止まる。生成の応答が不明なときに状態を確かめるかの判定
（shouldConfirmGeneration）も置く。

Refs #120

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 結果パネルと描写フォーム、お題詳細への組み込み

**Files:**
- Create: `frontend/src/components/attempts/generation-panel.tsx`
- Create: `frontend/src/components/attempts/attempt-composer.tsx`
- Modify: `frontend/src/components/posts/post-detail.tsx`（コメントの位置）
- Modify: `frontend/src/components/attempts/attempt-list.tsx`（空状態のコメント 1 行）

**Interfaces:**
- Consumes：Task 1〜3 の成果すべて、`useAuth()`（`status: "loading" | "authenticated" | "unauthenticated" | "unreachable"`）、`postDetailHref(id)`、`toast.success` / `toast.error`、`SESSION_EXPIRED_MESSAGE`、`buttonClasses({ variant, size })`
- Produces:
  - `GenerationPanel({ state, onStartOver, onRecheck })`
  - `AttemptComposer({ postId, onPublished })`

- [ ] **Step 1: 結果パネルを作る**

`frontend/src/components/attempts/generation-panel.tsx`

```tsx
import { buttonClasses } from "@/components/ui/button";
import { QUOTA_USED_NOTE, failureReasonMessage } from "@/lib/attempts/attempt-messages";
import { cloudinaryDownloadUrlOrNull, cloudinaryUrlOrNull } from "@/lib/cloudinary";
import type { Attempt } from "@/types/api";

// 一覧・表彰台と同じ変換にすると、Cloudinary の派生画像を共有できる（7-3b 設計書「決定 4」）。
const IMAGE_WIDTH = 640;

export type GenerationPanelState =
  | { kind: "generating" }
  | { kind: "published"; attempt: Attempt }
  | { kind: "failed"; attempt: Attempt }
  | { kind: "timed_out" }
  | { kind: "not_found" };

const LEAVE_NOTE = "ページを離れても生成は続きます。完成するとみんなの挑戦に表示されます";

/**
 * 生成の結果（7-3c 設計書「決定 8」）。表示だけを担当し、状態は AttemptComposer が持つ。
 *
 * 読み上げは AttemptComposer の role="status" が短い文で行う。パネル全体を live region に
 * すると、画像の代替テキストやボタンのラベルまで読み上げられるため。
 */
export function GenerationPanel({
  state,
  onStartOver,
  onRecheck,
}: {
  state: GenerationPanelState;
  onStartOver: () => void;
  onRecheck: () => void;
}) {
  return (
    <div className="rounded-card border border-line bg-canvas p-4">
      {state.kind === "generating" && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="aspect-square w-full animate-pulse rounded-card bg-line sm:w-48" />
          <div className="flex flex-col gap-1">
            <p className="font-medium text-ink">生成中…</p>
            <p className="text-sm text-ink-muted">{LEAVE_NOTE}</p>
          </div>
        </div>
      )}

      {state.kind === "published" && (
        <PublishedResult attempt={state.attempt} onStartOver={onStartOver} />
      )}

      {state.kind === "failed" && (
        <div className="flex flex-col gap-3">
          <p className="text-danger">{failureReasonMessage(state.attempt.failure_reason)}</p>
          <p className="text-sm text-ink-muted">{QUOTA_USED_NOTE}</p>
          <StartOverButton onClick={onStartOver} />
        </div>
      )}

      {state.kind === "timed_out" && (
        // 枠は消費済みで、生成は失敗していないかもしれない。「失敗」とは言わない。
        <div className="flex flex-col gap-3">
          <p className="text-ink">まだ生成しています。完成するとみんなの挑戦に表示されます</p>
          <div>
            <button
              type="button"
              onClick={onRecheck}
              className={`${buttonClasses({ variant: "secondary", size: "sm" })} text-sm`}
            >
              もう一度確認
            </button>
          </div>
        </div>
      )}

      {state.kind === "not_found" && (
        // 生成中の JWT 失効でも 404 になる（本人以外に generating は見えない）。
        // その場合も生成は進むので、完成すれば一覧に出ることを添える（設計書「決定 3」）。
        <div className="flex flex-col gap-3">
          <p className="text-ink">
            生成中の挑戦が見つかりませんでした。完成していればみんなの挑戦に表示されます
          </p>
          <StartOverButton onClick={onStartOver} />
        </div>
      )}
    </div>
  );
}

function PublishedResult({ attempt, onStartOver }: { attempt: Attempt; onStartOver: () => void }) {
  const publicId = attempt.generated_image_public_id;
  const src =
    publicId === null ? null : cloudinaryUrlOrNull(publicId, { width: IMAGE_WIDTH, aspect: "1:1" });
  const downloadHref =
    publicId === null
      ? null
      : cloudinaryDownloadUrlOrNull(publicId, { filename: `kotoe-attempt-${attempt.id}` });
  const alt = "あなたの再現画像";

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      {src === null ? (
        <div role="img" aria-label={alt} className="aspect-square w-full rounded-card bg-line sm:w-64" />
      ) : (
        // next/image ではなく <img>（7-3a 設計書「決定 4」）。
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className="aspect-square w-full rounded-card bg-line object-cover sm:w-64"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="font-medium text-ink">画像が完成し、みんなの挑戦に公開されました</p>
        {/*
          自分が書いた描写文だが、公開 UGC と同じく {value} のまま置く。改行は whitespace-pre-wrap
          （<br> に置き換えると XSS になる。CLAUDE.md）。
        */}
        <p className="line-clamp-4 text-sm whitespace-pre-wrap wrap-break-word text-ink-muted">
          {attempt.description}
        </p>
        <div className="flex flex-wrap gap-2">
          {downloadHref !== null && (
            // download 属性は付けない（別オリジンでは効かない）。fl_attachment で保存させる。
            <a
              href={downloadHref}
              className={`${buttonClasses({ variant: "secondary", size: "sm" })} text-sm`}
            >
              ダウンロード（PNG）
            </a>
          )}
          <StartOverButton onClick={onStartOver} />
        </div>
      </div>
      {/* 7-4：/attempts/[id] ができたら、ここに比較ビューへのリンクを足す。 */}
    </div>
  );
}

function StartOverButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${buttonClasses({ variant: "secondary", size: "sm" })} text-sm`}
    >
      新しく描写する
    </button>
  );
}
```

- [ ] **Step 2: 描写フォームを作る**

`frontend/src/components/attempts/attempt-composer.tsx`

```tsx
"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";

import {
  GenerationPanel,
  type GenerationPanelState,
} from "@/components/attempts/generation-panel";
import { buttonClasses } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import {
  apiErrorCode,
  DESCRIPTION_MAX_LENGTH,
  descriptionFieldError,
  DRAFT_GONE_MESSAGE,
  DRAFT_SAVED_MESSAGE,
  fallbackErrorMessage,
  GENERATE_TARGET_GONE_MESSAGE,
  GENERATION_NOT_STARTED_MESSAGE,
  generationErrorMessage,
  POST_GONE_MESSAGE,
} from "@/lib/attempts/attempt-messages";
import { type PollOutcome, shouldConfirmGeneration } from "@/lib/attempts/poll-attempt";
import { useAttemptPolling } from "@/lib/attempts/use-attempt-polling";
import { useAuth } from "@/lib/auth/auth-context";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/error-messages";
import { postDetailHref } from "@/lib/posts/post-detail-query";
import { toast } from "@/lib/toast/toast-store";
import type { Attempt, AttemptResponse } from "@/types/api";

/**
 * フォームの進行状態。状態遷移は reducer に切り出さない（7-3c 設計書「決定 7」）。
 * polling の immediate は「応答が不明だったので最初の 1 回を待たずに確かめる」（決定 10）。
 */
type Phase =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "starting" }
  | { kind: "polling"; attemptId: number; immediate: boolean }
  | { kind: "published"; attempt: Attempt }
  | { kind: "failed"; attempt: Attempt }
  | { kind: "stalled"; attemptId: number; reason: "timed_out" | "not_found" };

type SaveResult = { ok: true; attemptId: number } | { ok: false };

const PLACEHOLDER = "色・形・配置・雰囲気など、見えるものを言葉で書いてみましょう";

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

function panelStateOf(phase: Phase): GenerationPanelState | null {
  switch (phase.kind) {
    case "polling":
      return { kind: "generating" };
    case "published":
    case "failed":
      return phase;
    case "stalled":
      return { kind: phase.reason };
    default:
      return null;
  }
}

/** 読み上げ用の短い文。パネル全体を live region にしない理由は GenerationPanel を参照。 */
function announcementOf(phase: Phase): string {
  switch (phase.kind) {
    case "starting":
      return "生成を開始しています";
    case "polling":
      return "生成中です";
    case "published":
      return "画像が完成しました";
    case "failed":
      return "生成できませんでした";
    case "stalled":
      return phase.reason === "timed_out" ? "まだ生成しています" : "生成中の挑戦が見つかりませんでした";
    default:
      return "";
  }
}

/**
 * 描写フォーム（7-3c）。「保存」＝下書きの作成・更新、「画像を生成」＝ジョブの起動
 * （CLAUDE.md「ドメインの重要ルール」）。生成が成功したら即公開で、結果はこのフォームの
 * 下のパネルに出す（決定 8）。
 *
 * 下書き id は画面の中だけで持つ（決定 1）。入力欄は認証状態によらず常に出し、ボタン
 * 領域だけを出し分ける（決定 4。失効でアンマウントされると書きかけの文面が消えるため）。
 */
export function AttemptComposer({
  postId,
  onPublished,
}: {
  postId: number;
  onPublished: () => void;
}) {
  const auth = useAuth();
  const [text, setText] = useState("");
  const [draftId, setDraftId] = useState<number | null>(null);
  const [savedText, setSavedText] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const textareaId = `${baseId}-description`;
  const fieldErrorId = `${baseId}-description-error`;
  const counterId = `${baseId}-description-counter`;

  useAttemptPolling(phase.kind === "polling" ? phase : null, handlePollOutcome);

  const busy = phase.kind === "saving" || phase.kind === "starting" || phase.kind === "polling";
  const isSaved = draftId !== null && text === savedText;
  const overLimit = text.length > DESCRIPTION_MAX_LENGTH;
  const panelState = panelStateOf(phase);

  function clearMessages() {
    setFormError(null);
    setFieldError(null);
  }

  function forgetDraft() {
    setDraftId(null);
    setSavedText(null);
  }

  /**
   * 下書きの作成（POST）か更新（PATCH）。savedText には、応答時点の text ではなく
   * **送った文面**を入れる（保存中にも入力できるため）。
   */
  async function persistDraft(): Promise<SaveResult> {
    const sending = text;
    const body = JSON.stringify({ attempt: { description: sending } });
    const isUpdate = draftId !== null;

    try {
      const { attempt } = isUpdate
        ? await apiFetch<AttemptResponse>(`/api/attempts/${draftId}`, { method: "PATCH", body })
        : await apiFetch<AttemptResponse>(`/api/posts/${postId}/attempts`, { method: "POST", body });
      setDraftId(attempt.id);
      setSavedText(sending);
      return { ok: true, attemptId: attempt.id };
    } catch (error: unknown) {
      showSaveError(error, isUpdate);
      return { ok: false };
    }
  }

  function showSaveError(error: unknown, isUpdate: boolean) {
    // 失効。文面は残す（入力欄は常に表示）。ボタン領域はログイン導線に変わる。
    if (isUnauthorized(error)) {
      toast.error(SESSION_EXPIRED_MESSAGE);
      return;
    }

    const field = descriptionFieldError(error);
    if (field !== null) {
      setFieldError(field);
      return;
    }

    // 別タブで生成・削除された、またはお題が削除された下書き。次の保存は新しい下書きになる。
    if (
      isUpdate &&
      error instanceof ApiError &&
      (error.status === 404 || apiErrorCode(error) === "attempt_not_draft")
    ) {
      forgetDraft();
      setFieldError(DRAFT_GONE_MESSAGE);
      return;
    }

    if (!isUpdate && error instanceof ApiError && error.status === 404) {
      setFormError(POST_GONE_MESSAGE);
      return;
    }

    setFormError(fallbackErrorMessage(error));
  }

  async function handleSave() {
    clearMessages();
    setPhase({ kind: "saving" });
    const result = await persistDraft();
    setPhase({ kind: "idle" });
    // 押しても画面が変わらない操作なので、成功をトーストで伝える（7-2.5）。
    if (result.ok) toast.success(DRAFT_SAVED_MESSAGE);
  }

  /**
   * 未保存の変更があれば保存してから起動する（決定 2）。生成はサーバーに保存された文面を
   * 使うので、保存せずに起動すると古い文面で生成され、枠が 1 つ消える。
   */
  async function handleGenerate() {
    clearMessages();
    setPhase({ kind: "starting" });

    let attemptId = draftId;
    if (attemptId === null || text !== savedText) {
      const result = await persistDraft();
      if (!result.ok) {
        setPhase({ kind: "idle" });
        return;
      }
      attemptId = result.attemptId;
    }

    try {
      const { attempt } = await apiFetch<AttemptResponse>(`/api/attempts/${attemptId}/generate`, {
        method: "POST",
      });
      setPhase({ kind: "polling", attemptId: attempt.id, immediate: false });
    } catch (error: unknown) {
      showGenerateError(error, attemptId);
    }
  }

  function showGenerateError(error: unknown, attemptId: number) {
    if (isUnauthorized(error)) {
      toast.error(SESSION_EXPIRED_MESSAGE);
      setPhase({ kind: "idle" });
      return;
    }

    // 上限・キルスイッチ。挑戦は draft のままなので、回復後にまた押せる。
    const message = generationErrorMessage(error, Date.now());
    if (message !== null) {
      setFormError(message);
      setPhase({ kind: "idle" });
      return;
    }

    if (error instanceof ApiError && error.status === 404) {
      forgetDraft();
      setFormError(GENERATE_TARGET_GONE_MESSAGE);
      setPhase({ kind: "idle" });
      return;
    }

    // 応答が不明（サーバー側では起動済みかもしれない）。挑戦を取得して確かめる（決定 10）。
    if (shouldConfirmGeneration(error)) {
      setPhase({ kind: "polling", attemptId, immediate: true });
      return;
    }

    setFormError(fallbackErrorMessage(error));
    setPhase({ kind: "idle" });
  }

  function handlePollOutcome(outcome: PollOutcome, attemptId: number) {
    if (outcome.kind === "not_found" || outcome.kind === "timed_out") {
      setPhase({ kind: "stalled", attemptId, reason: outcome.kind });
      return;
    }

    const { attempt } = outcome;
    if (attempt.status === "published" || attempt.status === "failed") {
      // 終端状態の挑戦は二度と draft に戻らない。次の保存・生成は新しい下書きにする。
      // 文面は残す（少し直して再挑戦できるように。決定 6）。
      forgetDraft();
      setPhase(
        attempt.status === "published"
          ? { kind: "published", attempt }
          : { kind: "failed", attempt },
      );
      if (attempt.status === "published") onPublished();
      return;
    }

    // draft：確かめた結果、起動していなかった。下書きはそのまま使える。
    setFormError(GENERATION_NOT_STARTED_MESSAGE);
    setPhase({ kind: "idle" });
  }

  function startOver() {
    setPhase({ kind: "idle" });
    textareaRef.current?.focus();
  }

  function recheck() {
    if (phase.kind !== "stalled") return;
    setPhase({ kind: "polling", attemptId: phase.attemptId, immediate: true });
  }

  const describedBy = [fieldError !== null ? fieldErrorId : null, counterId]
    .filter((id): id is string => id !== null)
    .join(" ");

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-card border border-line bg-surface p-4 sm:p-6"
    >
      <h2 id={headingId} className="text-lg font-semibold text-ink">
        描写を書く
      </h2>

      {formError !== null && (
        <p role="alert" className="rounded-card border border-danger p-3 text-sm text-danger">
          {formError}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={textareaId} className="sr-only">
          描写文
        </label>
        <textarea
          id={textareaId}
          ref={textareaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={6}
          placeholder={PLACEHOLDER}
          aria-invalid={fieldError === null ? undefined : true}
          aria-describedby={describedBy}
          className="resize-y rounded-card border border-line bg-canvas px-3 py-2 text-ink outline-none focus:border-accent"
        />
        <div className="flex items-start justify-between gap-3 text-sm">
          {fieldError !== null ? (
            <p id={fieldErrorId} className="text-danger">
              {fieldError}
            </p>
          ) : (
            <span />
          )}
          {/*
            表示だけ。判定はサーバーの 422 に任せる（決定 9）。aria-live にしない
            （1 文字ごとに読み上げられる）。text.length は UTF-16 の単位なので、絵文字などで
            サーバーより多く数えることがあるが、多めの側のずれなので「超えていない」表示で
            422 になることは無い。
          */}
          <p
            id={counterId}
            className={`shrink-0 tabular-nums ${overLimit ? "text-danger" : "text-ink-muted"}`}
          >
            {text.length} / {DESCRIPTION_MAX_LENGTH}
          </p>
        </div>
      </div>

      {auth.status === "unauthenticated" ? (
        <div className="flex sm:justify-end">
          <Link
            href={`/login?next=${encodeURIComponent(postDetailHref(postId))}`}
            className={`${buttonClasses({ variant: "primary" })} text-center`}
          >
            ログインして描写する
          </Link>
        </div>
      ) : (
        // スマホ幅は縦に積み、主役の「画像を生成」を上にする（flex-col-reverse）。
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={handleSave}
            // loading の間は押せない（ログイン中か確定していない）。unreachable は押せる。
            disabled={busy || auth.status === "loading" || isSaved}
            className={buttonClasses({ variant: "secondary" })}
          >
            {phase.kind === "saving" ? "保存中…" : isSaved ? "保存済み" : "保存"}
          </button>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={busy || auth.status === "loading"}
            className={buttonClasses({ variant: "primary" })}
          >
            {phase.kind === "starting"
              ? "生成を開始しています…"
              : phase.kind === "polling"
                ? "生成中…"
                : "画像を生成"}
          </button>
        </div>
      )}

      <p role="status" className="sr-only">
        {announcementOf(phase)}
      </p>

      {panelState !== null && (
        <GenerationPanel state={panelState} onStartOver={startOver} onRecheck={recheck} />
      )}
    </section>
  );
}
```

- [ ] **Step 3: お題詳細に組み込む**

`frontend/src/components/posts/post-detail.tsx`：

import に追加する（既存の import の並びに合わせ、`@/components/attempts/attempt-list` の直前に置く）。

```tsx
import { AttemptComposer } from "@/components/attempts/attempt-composer";
```

次のコメントブロックを置き換える。

```tsx
      {/*
        7-3c：描写フォームはここに入る。current が確定した後はこの位置が再取得で
        アンマウントされないので、書きかけの文面と生成中のポーリングが保たれる。
      */}
```

置き換え後：

```tsx
      {/*
        current が確定した後は、この位置が再取得でアンマウントされない（決定 2）。
        書きかけの文面と生成中のポーリングは並び替え・ページ送りをまたいで保たれる。
        公開されたら詳細を取り直して、表彰台とみんなの挑戦に反映する（7-3c 決定 6）。
      */}
      <AttemptComposer postId={postId} onPublished={retry} />
```

`frontend/src/components/attempts/attempt-list.tsx` のコメント 1 行を置き換える。

```tsx
    // 描写への導線は 7-3c（描写フォームがこのセクションの上に入る）。
```

→

```tsx
    // 描写フォームはこのセクションのすぐ上にある（7-3c）。ここに別の導線は置かない。
```

- [ ] **Step 4: 型・lint・テスト・本番ビルドを確かめる**

```bash
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run lint
docker compose exec frontend npm test
docker compose exec frontend npm run build
```

Expected: すべてエラー 0・全件 PASS・ビルド成功。

**ビルドの後は、dev サーバーの `.next` が本番ビルドで上書きされている**。`docker compose exec frontend rm -rf .next && docker compose restart frontend` で戻してから次に進む（`frontend/AGENTS.md`）。

- [ ] **Step 5: 画面が出ることだけを先に確かめる**

`http://localhost:3001/posts/<既存のお題の id>` を開き、表彰台（あれば）とみんなの挑戦の間に「描写を書く」が出ること、1 文字入れるとカウンターが `1 / 1000` になることを確かめる。詳細な確認は Task 5 で行う。

- [ ] **Step 6: コミット**

```bash
git add frontend/src/components/attempts/generation-panel.tsx frontend/src/components/attempts/attempt-composer.tsx frontend/src/components/posts/post-detail.tsx frontend/src/components/attempts/attempt-list.tsx
git commit -m "feat: お題詳細に描写フォームを置き、保存・生成・結果の表示までつなぐ

「画像を生成」は未保存の変更を保存してから起動し、結果（生成中・公開・失敗・
打ち切り）はフォームの下のパネルに出す。生成の応答が不明なときは挑戦を
取得して確かめ、実際には進んでいる生成を失敗と言わない。

Refs #120

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 実物での確認・ドキュメント・レビュー・PR

**Files:**
- Modify: `docs/issues_backlog.md`

**Interfaces:**
- Consumes: Task 1〜4 の成果すべて
- Produces: PR（`Closes #120`）

- [ ] **Step 1: 確認の準備**

1. ログインできるユーザーと、お題が 1 件以上あることを確かめる。
2. **確認中は生成回数の上限を上げておく。** 手順の中で 6 回以上生成するため、既定の 3 回では途中で詰まる。スクラッチパッド（以下 `$SCRATCH`）に次を置く。

```bash
cat > "$SCRATCH/compose.7-3c-limit.yml" <<'EOF'
services:
  backend:
    environment:
      KOTOE_DAILY_GENERATION_LIMIT: "100"
EOF
docker compose -f docker-compose.yml -f "$SCRATCH/compose.7-3c-limit.yml" up -d backend
```

3. 描写文の先頭には必ず `[7-3c確認]` を付ける（Step 3 で片づけるため）。

- [ ] **Step 2: 手動確認（全部に ✓ が付くまで先に進まない）**

`http://localhost:3001/posts/<id>` で確かめる。Rails のログは `docker compose logs -f backend` で見る。

1. [ ] **保存**：`[7-3c確認] 赤い丸` と入れて「保存」→ 「下書きを保存しました」のトースト → ボタンが「保存済み」で押せない → 1 文字足すと「保存」に戻る → もう一度押すと、Rails のログが `PATCH /api/attempts/<id>` になる（POST ではない）
2. [ ] **未保存のまま生成**：文面を `[7-3c確認] 青い四角` に書き換えて、すぐ「画像を生成」→ ボタンが「生成を開始しています…」→「生成中…」、パネルにプレースホルダーと「ページを離れても生成は続きます…」→ 数秒で公開パネル → **パネルの描写文が「青い四角」**（書き換えた文面で生成された）→ みんなの挑戦（新着順）の先頭に同じ挑戦が現れ、ヒーローはスケルトンに戻らない
3. [ ] **再現度順・2 ページ目でも結果が見える**：「再現度順」にしてから生成 → 公開パネルに画像が出る（一覧の末尾に回っても、押した場所で結果が見える）
4. [ ] **ダウンロード**：「ダウンロード（PNG）」→ 画面は遷移せず `kotoe-attempt-<id>.png` が保存される → macOS のプレビューで開ける
5. [ ] **新しく描写する**：パネルが閉じ、文面が残り、入力欄にフォーカスが移る → 「保存」→ Rails のログが **POST**（新しい下書き）
6. [ ] **文字数**：1,001 文字を貼る（`'[7-3c確認]' + 'あ'.repeat(992)` を DevTools のコンソールで作ってコピー）→ カウンターが赤 → 「保存」で入力欄の下に「描写は 1000 文字以内で入力してください」、トーストは出ない
7. [ ] **空で保存** → 入力欄の下に「描写を入力してください」
8. [ ] **連打**：「画像を生成」をダブルクリック → Rails のログで `POST .../generate` が 1 本だけ
9. [ ] **上限**：override の値を `"1"` に書き換えて `docker compose -f docker-compose.yml -f "$SCRATCH/compose.7-3c-limit.yml" up -d backend` → 生成 → フォームの上に「今日の生成回数（1 回）を使い切りました。あと約 N 時間で回復します」（N は JST の 0 時までを切り上げた値）→ 値を `"100"` に戻して同じコマンドを再実行
10. [ ] **キルスイッチ**：`$SCRATCH/compose.7-3c-off.yml` に `backend.environment.KOTOE_GENERATION_ENABLED: "false"` を書き、2 つの override を重ねて backend を上げる（`-f docker-compose.yml -f ...-limit.yml -f ...-off.yml`）→ 生成 → 「現在、画像生成を一時停止しています…」→ 限度の override だけに戻す
11. [ ] **打ち切り → もう一度確認**：`frontend/src/lib/attempts/poll-attempt.ts` の `POLL_DEADLINE_MS` を一時的に `15_000` にする（**コミットしない**）→ `docker compose stop worker` → 生成 → 約 15 秒で「まだ生成しています…」と「もう一度確認」→ `docker compose start worker` → 「もう一度確認」→ 公開パネル → **`POLL_DEADLINE_MS` を `360_000` に戻し、`git diff` が空であることを確かめる**
12. [ ] **失敗**：`docker compose stop worker` → 生成（生成中パネル）→ `$SCRATCH/compose.7-3c-worker-off.yml` に `worker.environment.KOTOE_GENERATION_ENABLED: "false"` を書き、`docker compose -f docker-compose.yml -f "$SCRATCH/compose.7-3c-worker-off.yml" up -d worker` → 失敗パネルに「画像生成が一時停止されたため、生成できませんでした」と「この生成で今日の生成回数を 1 回使いました」→ `docker compose up -d worker` で戻す。**生成中にお題一覧へ移動すると、Network タブで `/api/attempts/<id>` への取得が止まる**ことも、このときに確かめる（Review Focus 4）
13. [ ] **失効**：7-3b の手順で期限切れトークンを作り、Local Storage のトークンを差し替える → 文面を変えて「保存」→ 「セッションの有効期限が切れました…」のトースト → **文面が残ったまま**、ボタン領域が「ログインして描写する」に変わる

```bash
docker compose exec -T backend bin/rails runner 'u = User.first; print JWT.encode({ "sub" => u.id.to_s, "scp" => "user", "jti" => SecureRandom.uuid, "exp" => 1.hour.ago.to_i, "iat" => 2.hours.ago.to_i }, ENV.fetch("JWT_SECRET_KEY"), "HS256")'
```

14. [ ] **生成中の並び替え**：`docker compose stop worker` → 生成 → 生成中のまま「再現度順」「次へ」を押す → 文面と生成中パネルが残り、ページは `#attempts-heading` の位置に留まる → `docker compose start worker` → 公開パネル
15. [ ] **応答不明（attempt_not_draft → 確かめる）**：「保存」だけする → 次のコマンドで、その下書きを裏で `generating` にする → 文面を変えずに「画像を生成」→ 422 `attempt_not_draft` のあと、失敗と言わずに生成中パネルになる → 下の 2 本目で公開にする → 公開パネル

```bash
# 1 本目：直近の [7-3c確認] の下書きを generating にする（ジョブは積まない）
docker compose exec -T backend bin/rails runner 'a = Attempt.kept.draft.where("description LIKE ?", "[7-3c確認]%").order(:id).last; a.update!(status: :generating, generated_at: Time.current); puts a.id'
# 2 本目：その挑戦を公開にする（生成画像はお題画像を流用）
docker compose exec -T backend bin/rails runner 'a = Attempt.kept.generating.where("description LIKE ?", "[7-3c確認]%").order(:id).last; a.update!(status: :published, generated_image_public_id: a.post.image_public_id); puts a.id'
```

16. [ ] **応答不明（通信断 → 確かめる → 起動していなかった）**：DevTools → Network → 右クリックの「Block request URL」で `*/generate` をブロック → 生成 → フォームの上に「生成を開始できませんでした。もう一度お試しください」→ ブロックを外して「画像を生成」→ 公開まで進む
17. [ ] **認証の出し分け**：ログアウト → 入力欄は出ていて、ボタンの位置に「ログインして描写する」→ 押すと `/login?next=%2Fposts%2F<id>` → ログイン後にお題へ戻る。**ログイン済みでお題を直接ロード・リロード**しても「保存」「画像を生成」が出る（メモリの教訓）。`docker compose pause backend` でリロード → `unreachable` の状態で「保存」を押すと、約 15 秒後にフォームの上に通信エラー → `unpause`
18. [ ] **レイアウト**：スマホ幅（375px）で横スクロールが出ず、「画像を生成」が「保存」の上にある。縦長・横長のお題画像（7-3b の手順で 16:9・3:4 を作ったお題があればそれ）でフォームの位置が崩れない
19. [ ] **キーボード**：Tab だけで入力 → 保存 → 生成 → ダウンロード → 新しく描写する、まで操作できる。VoiceOver（任意）で「生成中です」「画像が完成しました」が読み上げられる

- [ ] **Step 3: 片づける**

```bash
docker compose exec -T backend bin/rails runner '
attempts = Attempt.kept.where("description LIKE ?", "[7-3c確認]%")
Like.where(attempt_id: attempts.select(:id)).delete_all
count = attempts.count
attempts.find_each(&:discard!)
puts "discarded: #{count}"
'
docker compose up -d backend worker
rm "$SCRATCH"/compose.7-3c-*.yml
git status --short
```

Expected：`discarded:` の件数が出る。backend と worker は override なしで作り直される。`git status` に意図しない変更が無い（特に `poll-attempt.ts`）。

- [ ] **Step 4: backlog を更新する**

`docs/issues_backlog.md`：

1. **7-3c の節**（`### 🟢 7-3c. お題詳細の描写入力＋生成ポーリング` から、次の `### 🟢 7-4.` の直前まで）を次に置き換える。

```markdown
### 🟢 7-3c. お題詳細の描写入力＋生成ポーリング
- 依存：**7-3b**, 4-2, 4-3, 7-2.5（「保存しました」のトースト）, 7-2.7（`AbortSignal` の合成）
- GitHub：#120
- 設計書：`docs/superpowers/specs/2026-09-29-issue-7-3c-attempt-composer-design.md`
- タスク：描写入力（「保存」／「画像を生成」の 2 ボタン）、生成ポーリング、生成中・成功・失敗・
  上限到達の状態、生成画像のダウンロード URL。
- **ドメインの必守ルール**：「保存」＝下書き（`status: draft`）の作成・更新、「画像を生成」＝
  ジョブ起動。生成が成功したら**即公開**（結果を見てから公開を選ぶ導線は作らない）。
- **7-3c で決めたこと（後続が乗る前提）**：
  - 描写フォームは `components/attempts/attempt-composer.tsx`。`PostDetail` の表彰台とみんなの
    挑戦の間にあり、並び替え・ページ送りでアンマウントされない
  - **下書き id は画面の中（`useState`）だけで持つ**。リロード・移動で失われる（再開は 7-6）
  - **「画像を生成」は未保存の変更を自動で保存してから起動する**（古い文面で枠を使わない）
  - ポーリングは `lib/attempts/poll-attempt.ts`（React を知らない関数）＋`use-attempt-polling.ts`。
    3 秒間隔・6 分で打ち切り・通信エラーでは続行・404 で停止・前の応答を待ってから次を送る
  - **生成の応答が不明（timeout・通信断・5xx・`attempt_not_draft`）なら、挑戦を取得して確かめる**
    （`shouldConfirmGeneration()`）。実際には進んでいる生成を「失敗」と言わない
  - **結果はフォームの下のパネルに出す**（`generation-panel.tsx`）。再現度順・2 ページ目で見ていても
    押した場所で結果が見える。公開済みパネルに画像・ダウンロード・「新しく描写する」
  - 入力欄は認証状態によらず常に表示し、ボタン領域だけを出し分ける
  - 文字数はカウンターだけ出し、判定はサーバーの 422 に任せる（`DESCRIPTION_MAX_LENGTH` は表示用）
  - 文言は `lib/attempts/attempt-messages.ts`（`failure_reason` 6 種・上限・「あと約 N 時間」）
  - ダウンロードは `cloudinaryDownloadUrl()`（`f_png,fl_attachment:<名前>`、原寸）
- 完了条件：お題を開いて描写し、生成（即公開）して結果が表示されるコアループが動く。
```

2. **7-4 の節**の「**7-3b からの申し送り**：」の箇条書きの末尾に 1 項目足す。

```markdown
  - **7-3c からの申し送り**：公開済みの結果パネル（`components/attempts/generation-panel.tsx` の
    `PublishedResult`）に、比較ビュー `/attempts/[id]` へのリンクを足す（コメントで場所がある）
```

3. **4-5 の節**の `- 先に決めること：**どこに出すか**。` の行の直前に足す。

```markdown
- **7-3c の実装後の状況**：生成中・失敗は、生成を起動した画面にいる間だけ結果パネルに出る。
  画面を離れると `failed` はどこにも出ない（上の「何が困るか」は変わらない）
```

4. **7-2.6 の節**の「先に決めること」の 3 の末尾に足す。

```markdown
     7-3c の時点では、未ログインで書いた文面・失効時の文面は、ログイン画面へ移ると失われる
     （入力欄は失効でアンマウントされないが、ログイン画面への遷移で消える）
```

5. **7-6 の節**の「**7-3b / 7-3c からの申し送り**：」の「編集」ボタンの項目の末尾に足す。

```markdown
    受け口を作るときは、`AttemptComposer` に初期値（`draftId` と文面）を渡す口を足す
```

- [ ] **Step 5: 全体の検証**

```bash
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run lint
docker compose exec frontend npm test
git diff --stat main -- backend
```

Expected：すべてエラー 0・全件 PASS。`git diff --stat main -- backend` は何も出力しない（rspec / rubocop は CI に任せる）。

- [ ] **Step 6: コミット**

```bash
git add docs/issues_backlog.md
git commit -m "docs: 7-3c の決定事項と、7-4・4-5・7-2.6・7-6 への申し送りを backlog に記録する

Refs #120

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: プッシュ前にコードレビューを通す**

プッシュ前に `/code-review high` を回す（superpowers の最終レビューとは別物なので、両方通す。メモリの規約）。指摘は `superpowers:receiving-code-review` に沿って検証してから直し、直したものは規約どおりにコミットする。

- [ ] **Step 8: プッシュして PR を出す**

この PR のマージで #120 の完了条件（描写 → 生成 → 即公開 → 結果の表示）を満たすので `Closes #120`。

```bash
git push -u origin feat/attempt-composer
gh pr create --title "7-3c. お題詳細の描写入力＋生成ポーリング" --body "$(cat <<'EOF'
## 概要

お題詳細で描写を書き、「保存」（下書き）と「画像を生成」ができるようにした。生成の結果（生成中・公開・失敗・打ち切り）はフォームの下のパネルに出る。フロントでコアループ（描写 → 生成 → 即公開 → 結果）が一周する。バックエンドの変更は無い。

設計書：`docs/superpowers/specs/2026-09-29-issue-7-3c-attempt-composer-design.md`

## 決めたこと

- 「画像を生成」は**未保存の変更を自動で保存してから起動する**（保存せずに押すと古い文面で生成され、枠が 1 つ消えるため）
- ポーリングは React を知らない `pollAttempt()` に置き、Vitest で検査した（3 秒間隔・6 分で打ち切り・通信エラーでは続行・404 で停止・リクエストを重ねない）
- **生成の応答が不明なら挑戦を取得して確かめる**（timeout・通信断・5xx・`attempt_not_draft`）。サーバー側で起動済みの生成を「失敗」と言わないため
- **結果はフォームの下のパネルに出す**。再現度順や 2 ページ目で見ていても、押した場所で結果が見える。ダウンロードは原寸の PNG（`f_png,fl_attachment`）
- 入力欄は認証状態によらず常に表示する（失効で書きかけの文面を消さない）
- 文字数はカウンターの表示だけで、判定はサーバーの 422 に任せる
- 失敗パネルには「この生成で今日の生成回数を 1 回使いました」を必ず添える（枠は戻らない）

## 見た目が変わるところ

- お題詳細の表彰台とみんなの挑戦の間に「描写を書く」が入る

## 確認したこと

- Vitest：poll-attempt（間隔・immediate・続行・404・締め切りの境界・重ねない・中断）、attempt-messages（失敗理由・上限・「あと約 N 時間」の境界）、cloudinary（ダウンロード URL・保存名の検証）。主要な分岐はミューテーションで赤くなることを確認
- 手動（ローカル、dummy 生成）：保存と PATCH、未保存のまま生成、再現度順で生成、ダウンロード（プレビューで開ける）、文字数、空、連打、上限、キルスイッチ、打ち切りと「もう一度確認」、失敗、失効、生成中の並び替え、応答不明の 2 経路、認証の出し分け（直接ロード・unreachable）、スマホ幅、キーボード操作

## マージ前のチェックリスト

- [ ] CI（rubocop / rspec / frontend）が green
- [ ] プレビュー URL でお題詳細にフォームが出る（本番はお題 0 件のため、実データでの確認は 7-5 以降）

Closes #120

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 9: プレビュー URL で確認する**

PR に付いた Vercel のプレビュー URL を開き、`/posts` と、（プレビューが向く backend にお題があれば）お題詳細が壊れていないこと・フォームが出ることを確かめて、PR のチェックリストを埋める。**プレビュー・本番では生成しない**（実費と生成枠を使う。本番での生成確認は 7-5 以降に 1 回だけ）。

---

## Self-Review（記入済み）

**1. 設計書の網羅：**

| 設計書の節 | タスク |
|---|---|
| 決定 1（下書き id は `useState`） | 4（`draftId` / `persistDraft` の POST・PATCH の分岐） |
| 決定 2（未保存なら自動保存してから生成） | 4（`handleGenerate`）、5（手動 2） |
| 決定 3（`pollAttempt` とフック、3 秒・6 分・続行・404・重ねない、既知の穴） | 3（テストとミューテーション）、4（`not_found` の文言） |
| 決定 4（入力欄は常に表示、ボタン領域の出し分け） | 4、5（手動 13・17） |
| 決定 5（エラーの置き場所の表） | 2（翻訳）、4（`showSaveError` / `showGenerateError`）、5（手動 6・7・9・10・13） |
| 決定 6（終端状態で下書きを捨て、文面は残す。公開で詳細を取り直す） | 4（`handlePollOutcome` / `onPublished={retry}`）、5（手動 2・5） |
| 決定 7（純粋関数・reducer にしない） | 1・2・3 |
| 決定 8（結果パネル） | 4（`GenerationPanel`）、5（手動 3・11・12） |
| 決定 9（カウンターだけ） | 2（`DESCRIPTION_MAX_LENGTH`）、4、5（手動 6） |
| 決定 10（応答不明なら確かめる） | 3（`shouldConfirmGeneration`）、4、5（手動 15・16） |
| `cloudinaryDownloadUrl()` | 1、4、5（手動 4） |
| 型 | 2 |
| 画面・XSS | 4、Global Constraints |
| テスト | 1・2・3 |
| 手動確認 | 5 |
| ドキュメントの後始末 | 5（Step 4） |

**2. プレースホルダ：** なし。

**3. 型の一貫性：** `cloudinaryDownloadUrlOrNull(publicId, { filename })`（Task 1 → 4）、`FailureReason` / `AttemptResponse` / `AttemptShowResponse`（Task 2 → 3・4）、`apiErrorCode` / `DESCRIPTION_MAX_LENGTH` / 各メッセージ定数と関数（Task 2 → 3・4）、`PollOutcome` / `pollAttempt` / `shouldConfirmGeneration`（Task 3 → 4）、`useAttemptPolling(target, onOutcome(outcome, attemptId))`（Task 3 → 4）、`GenerationPanelState`（`generating` / `published` / `failed` / `timed_out` / `not_found`。Task 4 内）。名前と引数の形が一致していることを確認した。

**4. Review Focus：** 5 項目すべてに、確認を持つタスクを割り当てた（1 → Task 4・5 手動 14、2 → Task 4・5 手動 8、3 → Task 4・5 手動 2、4 → Task 3 のフックとテスト・5 手動 12、5 → Task 4・5 手動 13）。

**設計書からの意図的な差分（3 件）：**
- 設計書の `phase.polling` は「もう一度確認」で増やす `round` を持つが、計画では持たない。「もう一度確認」は `stalled`（フックの対象が `null`）を経由してから同じ `attemptId` で `polling` に戻るので、`round` が無くても effect は走り直す（`use-attempt-polling.ts` のコメントに記載）。
- 設計書は `phase` に `stalled`（`timed_out` / `not_found`）を置き、パネルの状態は別の型（`GenerationPanelState`）に写す形にした。パネルは表示だけを担当するので、`attemptId` を知らなくてよい。
- 設計書の手動確認 11（backend を pause して応答不明を作る）は、タイミングが合わず再現しにくい。そこで、`rails runner` で下書きを裏で `generating` にする手順（`attempt_not_draft` の経路。手動 15）と、DevTools のリクエストブロック（通信断の経路。手動 16）の 2 本に置き換えた。

## 実装時の差分

（実装中に計画から外れたことがあれば、ここに追記する）
