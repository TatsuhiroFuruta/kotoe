# 下書きの再開・生成と、挑戦の削除 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** マイページの下書きから、お題詳細の描写フォームに文面入りで戻って保存・生成できるようにする。あわせて、自分の挑戦・下書きをマイページと挑戦詳細から削除できるようにする。

**Architecture:** 受け口 `/posts/[id]?draft=<id>` の `draft` は、`page.tsx`（サーバーコンポーネント）が正規化して `PostDetail` → `AttemptComposer` に渡す。下書きの取得は `AttemptComposer` が `GET /api/attempts/:id` で行い、その応答から「開ける／開けない」を決める判定は純粋関数に切り出して Vitest で検査する。`?draft=` を URL から外す操作（`router.replace`）は、`sort` / `page` を知っている `PostDetail` が持ち、フォームにはコールバックで渡す。削除は「ボタン＋確認ダイアログ＋`DELETE`」を 1 つの部品 `DeleteAttemptButton` にまとめ、3 か所（下書きカード・自分の挑戦カード・挑戦詳細）で使う。

**Tech Stack:** Next.js 16.2.10（App Router）／ React 19.2.4 ／ TypeScript ／ TailwindCSS 4 ／ Vitest（jsdom）／ Docker Compose。**新しい依存は追加しない。**

**Spec:** `docs/superpowers/specs/2026-10-29-issue-7-6b-mypage-actions-design.md`

**Issue:** GitHub #141（`docs/issues_backlog.md` 7-6b）。**PR 本文は `Closes #141`**

**Branch:** `feat/mypage-actions`（作成済み。設計書のコミット `1a2a3c4` が載っている）

## Global Constraints

このプロジェクト全体の規約。**全タスクの要件に暗黙に含まれる。**

- **依存パッケージを追加しない。** `frontend/package.json` は変更しない。
- **`backend/` のコードは 1 行も変更しない。**
- **`frontend/src/app/globals.css` を変更しない**（過去の Turbopack stale はすべてこのファイルの変更で起きている。`frontend/AGENTS.md`）。色は既存のトークン（`bg-surface`・`bg-canvas`・`bg-line`・`border-line`・`border-danger`・`text-ink`・`text-ink-muted`・`text-accent`・`text-danger`・`rounded-card` など）だけを使う。ボタンは `buttonClasses()`（`components/ui/button.ts`）を使う。
- **`useSearchParams()` を使わない**（Vercel の本番ビルドだけ落ちる。7-2 の規約）。サーバーコンポーネントの `searchParams` prop を使う。
- **`dangerouslySetInnerHTML` を使わない。** 描写文・タイトルは公開 UGC。`{value}` のまま置く。
- **`href` は API が返す整数 id と固定の文字列からだけ組み立てる**（`postDetailHref` / `draftResumeHref` / `attemptDetailHref` / `mypageHref`）。
- **`useEffect` の本体で同期的に `setState` しない**（`set-state-in-effect` が error）。取得の結果は `{ key, outcome }` で持ち、`key` の一致で今の結果かを判定する（`PostList` / `ProfileHeader` と同じ形）。
- **ブラウザの `alert` / `confirm` を使わない**（Chrome 拡張での確認作業が止まる）。
- **`any` を使わない。** 文字列はダブルクォート。コメントは日本語で「なぜそうしたか」を書く。確かめていない「壊れたときの見え方」をコメントに書かない。
- **文言はフロントで持つ。** 描写・挑戦まわりは `src/lib/attempts/attempt-messages.ts` に定数で足す。
- **テストは `frontend/test/` に置き、`src/` の構造を写す。** コンポーネントのテストは書かない（E2E は 8-1）。
- コマンドはリポジトリのルートで実行する。`npm` / `npx` は `docker compose exec frontend <コマンド>` でコンテナ内で動かす。
- **コンテナ内で `next build` を実行しない。** ビルドの確認は PR の Vercel プレビューに任せる。
- コミットメッセージの末尾は `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` で止める（`Claude-Session:` 行やセッションリンクを書かない）。
- `git checkout` を使わない。ブランチも切り替えない（`feat/mypage-actions` の上だけで作業する）。
- **env ファイルの中身を表示しない。**

各タスクの最後に、次の 3 つを通してからコミットする（以下「いつもの検査」）。

```bash
docker compose exec frontend npm test
docker compose exec frontend npm run lint
docker compose exec frontend npx tsc --noEmit
```

期待：Vitest が全件 PASS、eslint と tsc がエラー 0。

## Review Focus

どの単体テストも直接は叩かないが、使う人が最初に踏みそうな入力・条件。それぞれの確認は、そのコードを持つタスクに入れてある。

1. **`/posts/[id]?draft=<id>` を直接ロード・リロードする**（Link 遷移ではなくアドレスバーから）。ハイドレーション中は認証が `loading` なので、そこで「未ログイン」や「開けない」と判断してはいけない。文面入りで開くこと。→ Task 3 の手動確認 1
2. **読み込み中に入力欄へ書き始める。** 下書きの応答が後から届いて、書いた文面を上書きしてはいけない。→ Task 3 Step 3 の「読み込み中は入力欄を `readOnly`」と手動確認 5（DevTools で Slow 3G）
3. **受け口から開いて生成 → 完成 → リロード。** `?draft=` が URL に残っていると、生成済みの下書きを開こうとして「開けませんでした」が出る。→ Task 3 の手動確認 3
4. **削除の「削除する」を連打する／送信中に Esc を押す。** `DELETE` が 2 回飛ぶと 2 回目が 404 になる（成功扱いなので実害は小さいが、トーストが 2 つ出る）。送信中は押せず、閉じられないこと。→ Task 4 の手動確認
5. **2 ページ目の最後の 1 枚を削除する。** 取り直すだけだと「このページには何もありません」が出る。1 つ前のページへ移ること。→ Task 5 の手動確認 4

---

## ファイル構成

| ファイル | 種別 | 責務 |
|---|---|---|
| `frontend/src/lib/posts/post-detail-query.ts` | 変更 | `parseDraftParam`・`draftResumeHref` を足す |
| `frontend/test/lib/posts/post-detail-query.test.ts` | 変更 | 上の Vitest |
| `frontend/src/lib/attempts/draft-resume.ts` | 新規 | 取得結果から「開ける／開けない／黙る／通信失敗」を決める純粋関数 |
| `frontend/test/lib/attempts/draft-resume.test.ts` | 新規 | 上の Vitest |
| `frontend/src/lib/attempts/attempt-messages.ts` | 変更 | 受け口と削除の文言 |
| `frontend/src/app/posts/[id]/page.tsx` | 変更 | `draft` を正規化して `PostDetail` へ |
| `frontend/src/components/posts/post-detail.tsx` | 変更 | `draftId` を `AttemptComposer` へ。`?draft=` を外すコールバック |
| `frontend/src/components/attempts/attempt-composer.tsx` | 変更 | 下書きの取得と初期値、ログイン導線の `next`、生成開始時の通知 |
| `frontend/src/components/ui/confirm-dialog.tsx` | 新規 | `<dialog>` の確認ダイアログ |
| `frontend/src/components/attempts/delete-attempt-button.tsx` | 新規 | 削除ボタン＋確認ダイアログ＋`DELETE` |
| `frontend/src/components/mypage/draft-card.tsx` | 変更 | 「続きを書く」「削除」 |
| `frontend/src/components/mypage/my-attempt-card.tsx` | 変更 | リンクの外に「削除」の行 |
| `frontend/src/components/mypage/mypage-list.tsx` | 変更 | 削除後の取り直し・前のページへ |
| `frontend/src/components/mypage/mypage-view.tsx` | 変更 | 統計の取り直しを中継 |
| `frontend/src/components/mypage/profile-header.tsx` | 変更 | `refreshKey` で取り直す |
| `frontend/src/components/attempts/attempt-detail.tsx` | 変更 | 本人のときだけ「削除」 |
| `docs/issues_backlog.md` | 変更 | 7-6b に設計書と決定事項を書く |

---

### Task 1: 受け口の URL（post-detail-query）

**Files:**
- Modify: `frontend/src/lib/posts/post-detail-query.ts`
- Test: `frontend/test/lib/posts/post-detail-query.test.ts`

**Interfaces:**
- Produces:
  - `parseDraftParam(params: RawSearchParams): number | null` — `draft` を正の安全な整数だけ受け付ける（`parsePositiveInt(firstParam(params.draft))`）。`PostDetailQuery` には**足さない**（並び替え・ページ送りのリンクに下書きを引き継がないため。設計書 決定 2）
  - `draftResumeHref(postId: number, draftId: number): string` — `/posts/<postId>?draft=<draftId>`。`sort` / `page` は持たない

- [ ] **Step 1: 失敗するテストを書く**

```ts
describe("parseDraftParam", () => {
  it.each([["1", 1], ["34", 34], ["007", 7]])("%j は %d", (raw, expected) => {
    expect(parseDraftParam({ draft: raw })).toBe(expected);
  });
  it.each(["0", "-1", "1.5", "abc", "", "1e3", "99999999999999999999"])("%j は null", (raw) => {
    expect(parseDraftParam({ draft: raw })).toBeNull();
  });
  it("無ければ null", () => expect(parseDraftParam({})).toBeNull());
  it("複数あれば先頭（他のパラメータと同じ規則）", () => {
    expect(parseDraftParam({ draft: ["3", "4"] })).toBe(3);
  });
});

describe("draftResumeHref", () => {
  it("draft だけを載せる", () => {
    expect(draftResumeHref(12, 34)).toBe("/posts/12?draft=34");
  });
  it("parseDraftParam で元に戻る", () => {
    expect(parseDraftParam(paramsOf(draftResumeHref(12, 34)))).toBe(34);
  });
});

describe("postDetailHref は draft を載せない", () => {
  it("並び替えのリンクに下書きが引き継がれない", () => {
    expect(postDetailHref(12, { sort: "likes" })).toBe("/posts/12?sort=likes");
  });
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `docker compose exec frontend npm test -- test/lib/posts/post-detail-query.test.ts`
Expected: FAIL（`parseDraftParam` / `draftResumeHref` が export されていない）

- [ ] **Step 3: 2 つの関数を `post-detail-query.ts` に足す**（シグネチャは上の Interfaces）

- [ ] **Step 4: いつもの検査を通す**

- [ ] **Step 5: コミット**

```bash
git add frontend/src/lib/posts/post-detail-query.ts frontend/test/lib/posts/post-detail-query.test.ts
git commit -m "feat: 下書きの受け口の URL を組み立てる関数を足す"
```

---

### Task 2: 受け口の判定（draft-resume）と文言

**Files:**
- Create: `frontend/src/lib/attempts/draft-resume.ts`
- Modify: `frontend/src/lib/attempts/attempt-messages.ts`
- Test: `frontend/test/lib/attempts/draft-resume.test.ts`

**Interfaces:**
- Consumes: `ApiError`（`@/lib/api`）、`AttemptShowResponse`（`@/types/api`）
- Produces:

```ts
/** 受け口で下書きを取得した結果の扱い。設計書 決定 2。 */
export type DraftResumeOutcome =
  | { kind: "ready"; draftId: number; description: string } // 文面を入れて開く
  | { kind: "unavailable" } // 空のフォーム＋DRAFT_UNAVAILABLE_MESSAGE、?draft= を外す
  | { kind: "silent" } // 401（失効）。api.ts が処理済み。何も出さず ?draft= も残す
  | { kind: "failed"; message: string }; // 通信の失敗。toRequestErrorMessage のトースト、?draft= は残す

export function draftResumeFromResponse(
  response: AttemptShowResponse,
  expected: { postId: number; userId: number },
): DraftResumeOutcome;

export function draftResumeFromError(error: unknown): DraftResumeOutcome;
```

- `attempt-messages.ts` に足す定数（言い回しは整えてよい。設計書「文言」）：
  - `DRAFT_UNAVAILABLE_MESSAGE = "この下書きは開けませんでした"`
  - `ATTEMPT_DELETED_MESSAGE = "挑戦を削除しました"`
  - `DRAFT_DELETED_MESSAGE = "下書きを削除しました"`
  - `DELETE_ATTEMPT_TITLE = "この挑戦を削除しますか？"`
  - `DELETE_ATTEMPT_NOTE = "削除しても、今日の生成回数は戻りません"`
  - `DELETE_DRAFT_TITLE = "この下書きを削除しますか？"`

- [ ] **Step 1: 失敗するテストを書く**

フィクスチャは `AttemptShowResponse` の形（`attempt: { id: 34, status: "draft", description: "夕焼けの海", user: { id: 7, ... }, ... }`, `post: { id: 12, ... }`）を 1 つ作り、各ケースで 1 項目だけ変える。

```ts
const expected = { postId: 12, userId: 7 };

it("本人の draft で、お題が一致すれば ready", () => {
  expect(draftResumeFromResponse(response(), expected)).toEqual({
    kind: "ready", draftId: 34, description: "夕焼けの海",
  });
});
it.each(["generating", "published", "failed"] as const)("status が %s なら unavailable", (status) => {
  expect(draftResumeFromResponse(response({ status }), expected)).toEqual({ kind: "unavailable" });
});
it("別のお題の下書きなら unavailable", () => {
  expect(draftResumeFromResponse(response({ postId: 99 }), expected)).toEqual({ kind: "unavailable" });
});
it("本人でなければ unavailable（公開済みは他人にも返るため）", () => {
  expect(draftResumeFromResponse(response({ userId: 8 }), expected)).toEqual({ kind: "unavailable" });
});

it("404 は unavailable", () => {
  expect(draftResumeFromError(new ApiError(404, {}))).toEqual({ kind: "unavailable" });
});
it("401 は silent（api.ts が失効を処理する。トーストを重ねない）", () => {
  expect(draftResumeFromError(new ApiError(401, {}))).toEqual({ kind: "silent" });
});
it.each([500, 503])("%d は failed（再読み込みで試せるよう ?draft= を残す）", (status) => {
  expect(draftResumeFromError(new ApiError(status, {})).kind).toBe("failed");
});
it("ApiError 以外（通信断・timeout）も failed", () => {
  expect(draftResumeFromError(new TypeError("Failed to fetch")).kind).toBe("failed");
});
```

`ApiError` のコンストラクタ引数は `src/lib/api.ts` の実物に合わせる（上は形の例）。

- [ ] **Step 2: 失敗を確かめる**

Run: `docker compose exec frontend npm test -- test/lib/attempts/draft-resume.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: `draft-resume.ts` を実装し、文言を `attempt-messages.ts` に足す**

`failed` の `message` は `toRequestErrorMessage(error)`（`@/lib/request-error-messages`）。

- [ ] **Step 4: いつもの検査を通す**

- [ ] **Step 5: コミット**

```bash
git add frontend/src/lib/attempts/draft-resume.ts frontend/src/lib/attempts/attempt-messages.ts frontend/test/lib/attempts/draft-resume.test.ts
git commit -m "feat: 下書きの受け口で開けるかどうかを決める関数と文言を足す"
```

---

### Task 3: お題詳細の受け口（描写フォームへの初期値）

**Files:**
- Modify: `frontend/src/app/posts/[id]/page.tsx`
- Modify: `frontend/src/components/posts/post-detail.tsx`
- Modify: `frontend/src/components/attempts/attempt-composer.tsx`

**Interfaces:**
- Consumes: Task 1 の `parseDraftParam` / `draftResumeHref` / `postDetailHref`、Task 2 の `draftResumeFromResponse` / `draftResumeFromError` / `DRAFT_UNAVAILABLE_MESSAGE`
- Produces:
  - `PostDetail({ postId, query, draftId }: { postId: number; query: PostDetailQuery; draftId: number | null })`
  - `AttemptComposer({ postId, onPublished, resumeDraftId, onResumeEnd }: { postId: number; onPublished: () => void; resumeDraftId: number | null; onResumeEnd: () => void })`

- [ ] **Step 1: `page.tsx` で `parseDraftParam(await searchParams)` を取り、`PostDetail` に `draftId` として渡す**

`searchParams` は 1 回だけ await して `parsePostDetailQuery` と共用する。

- [ ] **Step 2: `PostDetail` に `onResumeEnd` を作り、`AttemptComposer` に `resumeDraftId={draftId}` と一緒に渡す**

`onResumeEnd` は `router.replace(postDetailHref(postId, query), { scroll: false })`。`query` の `sort` / `page` は残る。`PostDetail` の取得の `requestKey` は `postDetailApiPath` から作っているので、`?draft=` を外しても再取得は起きない（起きたら設計書の想定外なので報告する）。

- [ ] **Step 3: `AttemptComposer` に下書きの取得を足す**

- 取得は `auth.status === "authenticated"` かつ `resumeDraftId !== null` のときだけ（`loading` / `unauthenticated` / `unreachable` では取得しない。設計書「認証状態ごとの扱い」）。`GET /api/attempts/${resumeDraftId}` を `apiFetch<AttemptShowResponse>` で、`AbortController` 付きで取る
- 結果は `draftResumeFromResponse(data, { postId, userId: auth.user.id })` / `draftResumeFromError(error)` で決め、`{ key, outcome }` で持つ（`key` は `resumeDraftId`）
- `ready`：`draftId`・`text`・`savedText` に入れる（開いた直後は「保存済み」）。`.then` の中で set する（effect の本体で同期 set しない）
- `unavailable`：`toast.error(DRAFT_UNAVAILABLE_MESSAGE)` のあと `onResumeEnd()`
- `failed`：`toast.error(outcome.message)`。`onResumeEnd()` は呼ばない
- `silent`：何もしない
- **読み込み中**（`authenticated` で、今の `resumeDraftId` の結果がまだ無い間）：テキスト欄を `readOnly` にし、「保存」「画像を生成」を押せなくする。書き始めた文面が応答で上書きされるのを防ぐため（Review Focus 2）
- 一度 `ready` を適用したら、その後 `resumeDraftId` が `null` に変わっても（`?draft=` を外した結果）文面と `draftId` を消さない

- [ ] **Step 4: 生成が始まったら `?draft=` を外す**

`phase.kind` が `"polling"` に入ったとき、`resumeDraftId !== null` なら `onResumeEnd()` を呼ぶ（202・`shouldConfirmGeneration`・`attempt_not_draft` の合流の 3 経路すべてが `polling` を通るため、1 か所で受ける。設計書 決定 2「生成を始めたら」）。`useEffect` から呼んでよい（親のルーター操作で、自分の state は変えない）。

- [ ] **Step 5: ログイン導線の `next` を受け口にする**

`attempt-composer.tsx:428` の `postDetailHref(postId)` を、`resumeDraftId !== null` なら `draftResumeHref(postId, resumeDraftId)` にする。

- [ ] **Step 6: いつもの検査を通す**

- [ ] **Step 7: 手動確認**（`docker compose up`、ログインはユーザーに依頼してよい。下書きは画面から「保存」で作る）

1. ログインしたまま `/posts/<id>?draft=<自分の下書き id>` を**アドレスバーから**開く → 文面入り、「保存済み」
2. 書き直して「保存」→ `/mypage?tab=drafts` で同じカードの文面が新しく、枚数は増えていない
3. もう一度開いて「画像を生成」→ 生成中に入った時点で URL から `?draft=` が消える → 完成後にリロードしてもトーストが出ない
4. 他人の下書き id・生成済みの id・別のお題の下書き id・`99999` を手書き → 空のフォーム＋「この下書きは開けませんでした」、URL から `?draft=` が消える（`?sort=likes` を付けていれば残る）
5. DevTools で Slow 3G にして 1 を開く → 読み込み中は入力できず、応答後に文面が入る
6. ログアウトして 1 の URL を開く → 「ログインして描写する」、トーストなし → 押してログイン → 受け口に戻り文面入りで開く

- [ ] **Step 8: コミット**

```bash
git add frontend/src/app/posts/[id]/page.tsx frontend/src/components/posts/post-detail.tsx frontend/src/components/attempts/attempt-composer.tsx
git commit -m "feat: お題詳細で ?draft= の下書きを描写フォームに入れて開く"
```

---

### Task 4: 確認ダイアログと削除ボタン

**Files:**
- Create: `frontend/src/components/ui/confirm-dialog.tsx`
- Create: `frontend/src/components/attempts/delete-attempt-button.tsx`

**Interfaces:**
- Consumes: Task 2 の削除の文言、`apiFetch` / `ApiError`、`fallbackErrorMessage`、`toast`、`buttonClasses`
- Produces:

```ts
export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  note?: string;
  confirmLabel: string; // "削除する"
  pending: boolean; // true の間は「削除する」を押せず、Esc・「やめる」でも閉じない
  error: string | null; // ダイアログの中に role="alert" で出す
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element;

export function DeleteAttemptButton(props: {
  attemptId: number;
  kind: "attempt" | "draft";
  onDeleted: () => void;
}): JSX.Element;
```

- `ConfirmDialog`：ネイティブの `<dialog>`。`open` が真になったら `showModal()`、偽で `close()`。Esc は `cancel` イベントで受け、`pending` 中は `preventDefault()`。キャンセルのボタンは「やめる」
- `DeleteAttemptButton`：`<button type="button">削除</button>`（`buttonClasses({ variant: "secondary", size: "sm" })`）＋`ConfirmDialog`。文言は `kind` で選ぶ（挑戦：`DELETE_ATTEMPT_TITLE`＋`DELETE_ATTEMPT_NOTE`、下書き：`DELETE_DRAFT_TITLE` だけ）
- 「削除する」で `apiFetch(`/api/attempts/${attemptId}`, { method: "DELETE" })`。**204 と 404 は成功扱い**（404 はもう無い。設計書 決定 4）→ `toast.success(ATTEMPT_DELETED_MESSAGE | DRAFT_DELETED_MESSAGE)` → `onDeleted()`。401 はダイアログを閉じるだけ（api.ts が失効を処理済み）。それ以外は `fallbackErrorMessage(error)` を `error` に入れ、ダイアログは開いたまま
- 「やめる」で閉じたら、開いた「削除」ボタンへフォーカスを戻す（成功時はボタンごと消えるので戻さない）

- [ ] **Step 1: 2 つの部品を作る**（コンポーネントのテストは書かない）

- [ ] **Step 2: いつもの検査を通す**

- [ ] **Step 3: 手動確認は Task 5 でまとめて行う**（この時点ではどこにも置かれていない）

- [ ] **Step 4: コミット**

```bash
git add frontend/src/components/ui/confirm-dialog.tsx frontend/src/components/attempts/delete-attempt-button.tsx
git commit -m "feat: 挑戦・下書きの削除ボタンと確認ダイアログを足す"
```

---

### Task 5: マイページのカードにボタンを置く

**Files:**
- Modify: `frontend/src/components/mypage/draft-card.tsx`
- Modify: `frontend/src/components/mypage/my-attempt-card.tsx`
- Modify: `frontend/src/components/mypage/mypage-list.tsx`
- Modify: `frontend/src/components/mypage/mypage-view.tsx`
- Modify: `frontend/src/components/mypage/profile-header.tsx`

**Interfaces:**
- Consumes: Task 1 の `draftResumeHref`、Task 4 の `DeleteAttemptButton`、`mypageHref`
- Produces:
  - `DraftCard({ draft, onDeleted }: { draft: MyAttempt; onDeleted: () => void })`
  - `MyAttemptCard({ attempt, onDeleted }: { attempt: MyAttempt; onDeleted: () => void })`
  - `MypageList({ query, onItemDeleted }: { query: MypageQuery; onItemDeleted: () => void })`
  - `ProfileHeader({ name, refreshKey }: { name: string; refreshKey: number })` — `refreshKey` を `requestKey` に含めて取り直す

- [ ] **Step 1: `DraftCard` の下端にボタンの行を足す**

「続きを書く」は `<Link href={draftResumeHref(post.id, draft.id)}>`（`buttonClasses({ variant: "primary", size: "sm" })`）、隣に `<DeleteAttemptButton attemptId={draft.id} kind="draft" onDeleted={onDeleted} />`。**`post.discarded` のときは「続きを書く」を出さない**。ファイル冒頭のコメント（「下書きを開く導線は 7-6b で作る」）を今の作りに合わせて直す。

- [ ] **Step 2: `MyAttemptCard` を組み替える**

`<article>` の中に、`<Link>`（画像と本文。お題が削除済みならリンク無しの `<div>`）と、その下に削除の行（`<DeleteAttemptButton kind="attempt" />`）を並べる。今の `CARD_CLASSES` とホバーの見た目はリンク部分に残す。

- [ ] **Step 3: `MypageList` で削除後の取り直しを行う**

カードに渡す `onDeleted`：今のページの件数が 1 で `query.page > 1` なら `router.replace(mypageHref({ tab: query.tab, page: query.page - 1 }))`、そうでなければ `setRetryCount((c) => c + 1)`。どちらの場合も `onItemDeleted()` を呼ぶ。

- [ ] **Step 4: `MypageView` に `statsRefresh` の state を持ち、`ProfileHeader` の `refreshKey` と `MypageList` の `onItemDeleted`（`+1`）をつなぐ**

- [ ] **Step 5: いつもの検査を通す**

- [ ] **Step 6: 手動確認**

1. 下書きタブ：「続きを書く」で受け口に移る。「戻る」で下書きタブに戻る（7-6a 決定 4）
2. 下書きを削除 → ダイアログは「この下書きを削除しますか？」で回数の注記なし → 「削除する」でカードが消え、トースト
3. 自分の挑戦を削除 → 注記「削除しても、今日の生成回数は戻りません」→ カードが消え、統計の挑戦数（いいねがあれば獲得いいねも）が減る
4. 下書きを 13 件以上にして 2 ページ目の最後の 1 枚を削除 → 1 ページ目に移る（Review Focus 5）
5. お題が削除済みの下書き：「削除」だけが出る。削除できる。お題が削除済みの挑戦も削除できる
6. キーボードだけで：Tab で「削除」→ Enter でダイアログ → Esc で閉じ、「削除」にフォーカスが戻る
7. 「削除する」を素早く 2 回押す → `DELETE` は 1 本だけ（DevTools の Network）、トーストは 1 つ（Review Focus 4）
8. 自分の挑戦カードの画像を押すと挑戦詳細へ、「削除」を押しても挑戦詳細へは移らない

- [ ] **Step 7: コミット**

```bash
git add frontend/src/components/mypage
git commit -m "feat: マイページの下書き・挑戦カードに続きを書く・削除を置く"
```

---

### Task 6: 挑戦詳細の削除

**Files:**
- Modify: `frontend/src/components/attempts/attempt-detail.tsx`

**Interfaces:**
- Consumes: Task 4 の `DeleteAttemptButton`、`mypageHref`

- [ ] **Step 1: ボタンの行（`attempt-detail.tsx:120`）の末尾に、`isOwner` のときだけ `<DeleteAttemptButton attemptId={attempt.id} kind="attempt" onDeleted={...} />` を置く**

`onDeleted` は `router.replace(mypageHref({ tab: "attempts" }))`（「戻る」で消した挑戦の画面に戻らないように。設計書 決定 4）。

- [ ] **Step 2: いつもの検査を通す**

- [ ] **Step 3: 手動確認**

1. 自分の挑戦の詳細：「削除」が出る → 削除 → `/mypage?tab=attempts` に移り、トーストが出て、一覧から消えている → 「戻る」で消した挑戦の画面に戻らない
2. 他人の挑戦・未ログイン：「削除」が出ない

- [ ] **Step 4: コミット**

```bash
git add frontend/src/components/attempts/attempt-detail.tsx
git commit -m "feat: 挑戦詳細から自分の挑戦を削除できるようにする"
```

---

### Task 7: backlog への記録と通しの確認

**Files:**
- Modify: `docs/issues_backlog.md`（7-6b の項）

- [ ] **Step 1: 7-6b の項に `設計書：docs/superpowers/specs/2026-10-29-issue-7-6b-mypage-actions-design.md` と決定事項を 1 行ずつ足す**

足す決定：「続きを書く」1 つにまとめた（決定 1）／削除はマイページと挑戦詳細だけで、お題詳細の `AttemptCard` は触らない（決定 3。ブリーフ 3-B から外れる）／開けない下書きは空のフォーム＋トースト 1 種で `?draft=` を外す（決定 2）。

- [ ] **Step 2: 通しの確認**

いつもの検査に加えて `docker compose exec backend bundle exec rspec` と `docker compose exec backend bundle exec rubocop` が通ること（バックエンドは変えていないが、CLAUDE.md の「コミット前に通す」に従う）。ブラウザで Task 3・5・6 の手動確認 1 番だけをもう一度通す。

- [ ] **Step 3: コミット**

```bash
git add docs/issues_backlog.md
git commit -m "docs: 7-6b の設計書と決定事項を backlog に記録する"
```

PR 作成の前に `/code-review high` を通す（プロジェクトの運用）。PR 本文は `Closes #141`。
