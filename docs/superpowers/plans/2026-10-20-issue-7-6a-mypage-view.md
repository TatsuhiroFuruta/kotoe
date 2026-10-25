# マイページの表示（/mypage） 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ログイン中のユーザーが `/mypage` で、プロフィール（頭文字のアバター・名前・統計 3 つ）と 4 タブ（投稿したお題／自分の挑戦／下書き／お気に入り）を見られるようにする。あわせて、ヘッダーの名前を `/mypage` へのリンクにする。

**Architecture:** `/posts` と同じ作りにする。サーバーコンポーネントの `app/mypage/page.tsx` が `searchParams` を `parseMypageQuery()` で正規化し、`RequireAuth` の内側でクライアントの `MypageView` に渡す。タブの一覧は `MypageList` が `mypageApiPath()` から `useEffect` で取得し、統計は `ProfileHeader` が `GET /api/me` を別に取得する。画面の URL と API のパスは、どちらも `lib/mypage/mypage-query.ts` の純粋関数から作る。

**Tech Stack:** Next.js 16.2.10（App Router）／ React 19.2.4 ／ TypeScript ／ TailwindCSS 4 ／ Vitest（jsdom）／ Docker Compose。**新しい依存は追加しない。**

**Spec:** `docs/superpowers/specs/2026-10-20-issue-7-6a-mypage-view-design.md`

**Issue:** GitHub #27（`docs/issues_backlog.md` 7-6 → この PR で 7-6a / 7-6b に分ける）。**PR 本文は `Refs #27`**（`Closes` は 7-6b の PR に付ける）

**Branch:** `feat/mypage-view`（作成済み。設計書のコミット `2c85908` が載っている）

## Global Constraints

このプロジェクト全体の規約。**全タスクの要件に暗黙に含まれる。**

- **依存パッケージを追加しない。** `frontend/package.json` は変更しない。
- **`backend/` のコードは 1 行も変更しない。**
- **`frontend/src/app/globals.css` を変更しない**（過去の Turbopack stale はすべてこのファイルの変更で起きている。`frontend/AGENTS.md`）。色は既存のトークン（`bg-surface`・`bg-canvas`・`bg-line`・`border-line`・`text-ink`・`text-ink-muted`・`text-accent`・`text-danger`・`rounded-card` など）だけを使う。
- **`useSearchParams()` を使わない**（Vercel の本番ビルドだけ落ちる。7-2 の規約）。サーバーコンポーネントの `searchParams` prop を使う。
- **`dangerouslySetInnerHTML` を使わない。** 名前・タイトル・描写文は公開 UGC。`{value}` のまま置き、改行は `whitespace-pre-wrap`。
- **`href` は API が返す整数 id と固定の文字列からだけ組み立てる**（`postDetailHref` / `attemptDetailHref` / `mypageHref`）。
- **`useEffect` の本体で同期的に `setState` しない**（`set-state-in-effect` が error）。`PostList` と同じく、結果を `{ key, outcome }` で持ち、`key` の一致で現在の結果かを判定する。
- **`any` を使わない。**
- **文字列はダブルクォート。** コメントは日本語で、「なぜそうしたか」を書く。確かめていない「壊れたときの見え方」をコメントに書かない。
- **テストは `frontend/test/` に置き、`src/` の構造を写す。** コンポーネントのテストは書かない（E2E は 8-1）。
- **env ファイルの中身を表示しない。**
- コマンドはリポジトリのルートで実行する。`npm` / `npx` は `docker compose exec frontend <コマンド>` でコンテナ内で動かす。
- **コンテナ内で `next build` を実行しない。** ビルドの確認は PR の Vercel プレビューに任せる。
- コミットメッセージの末尾は `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` で止める（`Claude-Session:` 行やセッションリンクを書かない）。
- `git checkout` を使わない。ブランチも切り替えない（`feat/mypage-view` の上だけで作業する）。

## Review Focus

どの単体テストも直接は叩かないが、使う人が最初に踏みそうな入力・条件。それぞれの確認は、そのコードを持つタスクに入れてある。

1. **ログインしたまま `/mypage?tab=drafts` を直接ロード・リロードする。** ハイドレーションの経路は `<Link>` の遷移では通らない。`/login` へ飛ばされず、下書きタブが開くこと。→ Task 6 の手動確認 1
2. **前のタブの応答が届く前にタブを切り替える。** 遅れて届いた前のタブの応答が、新しいタブの下に描画されてはいけない（投稿の一覧を挑戦カードとして描くと落ちる）。→ Task 4 の「`key` に API パスを含める」と手動確認（ネットワークを Slow 3G にして連続で切り替える）
3. **削除済みのお題に付いた挑戦・下書き**（`post.title` と `post.image_public_id` が `null`）。落ちずに「お題は削除されました」と出て、リンクにならないこと。→ Task 5 の手動確認
4. **空白を含まない長い名前**（60 文字の英数字）。ヘッダーとプロフィールが横にはみ出さず、スマホ幅（375px）で横スクロールが出ないこと。→ Task 2・Task 3 の手動確認
5. **URL の書き換え**（`?tab=DRAFTS`、`?tab=drafts&tab=posts`、`?page=0`、`?page=1.5`）。例外を投げずに正規化されること。→ Task 1 のテスト

---

## ファイル構成

| ファイル | 種別 | 責務 |
|---|---|---|
| `frontend/src/lib/mypage/mypage-query.ts` | 新規 | タブ・ページと URL / API パスの相互変換（純粋関数） |
| `frontend/test/lib/mypage/mypage-query.test.ts` | 新規 | 上の Vitest |
| `frontend/src/lib/users/avatar-initial.ts` | 新規 | 名前から頭文字を取る（純粋関数） |
| `frontend/test/lib/users/avatar-initial.test.ts` | 新規 | 上の Vitest |
| `frontend/src/types/api.ts` | 変更 | `AttemptPostSummary` / `MyAttempt` / `MyAttemptsResponse` を足す |
| `frontend/src/components/ui/user-avatar.tsx` | 新規 | 頭文字の丸（ヘッダーとプロフィールで共用） |
| `frontend/src/components/layout/site-header.tsx` | 変更 | 名前の `<span>` を、アバター＋名前の `/mypage` リンクに |
| `frontend/src/app/mypage/page.tsx` | 新規 | `searchParams` の正規化と `RequireAuth` |
| `frontend/src/components/mypage/mypage-view.tsx` | 新規 | プロフィール・タブ・一覧を並べる |
| `frontend/src/components/mypage/profile-header.tsx` | 新規 | 名前と統計（`GET /api/me`） |
| `frontend/src/components/mypage/mypage-tabs.tsx` | 新規 | タブの `<Link>` の並び |
| `frontend/src/components/mypage/mypage-list.tsx` | 新規 | タブの一覧の取得・状態・空状態・ページ送り |
| `frontend/src/components/mypage/my-attempt-card.tsx` | 新規 | 自分の挑戦カード |
| `frontend/src/components/mypage/draft-card.tsx` | 新規 | 下書きカード |
| `docs/issues_backlog.md` | 変更 | 7-6 を 7-6a / 7-6b に分ける |

---

### Task 1: タブ・ページと URL の変換（mypage-query）と API の型

**Files:**
- Create: `frontend/src/lib/mypage/mypage-query.ts`
- Create: `frontend/test/lib/mypage/mypage-query.test.ts`
- Modify: `frontend/src/types/api.ts`（`PaginationMeta` の後ろ、`Attempt` の後ろに足す）

**Interfaces:**
- Consumes: `firstParam` / `parsePositiveInt` / `RawSearchParams`（`@/lib/search-params`）
- Produces:
  - `export type MypageTab = "posts" | "attempts" | "drafts" | "favorites";`
  - `export const MYPAGE_TABS: readonly { tab: MypageTab; label: string }[]` … 表示順と見出し。`[{posts,"投稿したお題"},{attempts,"自分の挑戦"},{drafts,"下書き"},{favorites,"お気に入り"}]`
  - `export type MypageQuery = { tab: MypageTab; page: number };`
  - `export function parseMypageQuery(params: RawSearchParams): MypageQuery`
  - `export function mypageHref(query?: Partial<MypageQuery>): string` … 省いた項目は既定値（`posts`・1）
  - `export function mypageApiPath(query: MypageQuery): string` … `/api/me/<tab>` ＋ `?page=`（1 なら省く）。**`tab` はパスにだけ入れ、クエリに載せない**
  - `types/api.ts`：
    ```ts
    /** me/attempts・me/drafts の post。削除済みなら title と image_public_id は null（6-3） */
    export type AttemptPostSummary = { id: number; title: string | null; image_public_id: string | null; discarded: boolean };
    export type MyAttempt = Attempt & { post: AttemptPostSummary };
    /** GET /api/me/attempts・/api/me/drafts。どちらもキーは attempts */
    export type MyAttemptsResponse = { attempts: MyAttempt[]; meta: PaginationMeta };
    ```
    `me/posts`・`me/favorites` は既存の `PostsIndexResponse` を使う

- [ ] **Step 1: 失敗するテストを書く**（`posts-query.test.ts` の書き方に合わせ、`paramsOf` ヘルパも同じ形で置く）

```ts
describe("parseMypageQuery", () => {
  it("何も無ければ投稿したお題の 1 ページ目", () => {
    expect(parseMypageQuery({})).toEqual({ tab: "posts", page: 1 });
  });
  it.each(["posts", "attempts", "drafts", "favorites"])("%j はそのまま受け付ける", (tab) => {
    expect(parseMypageQuery({ tab }).tab).toBe(tab);
  });
  it.each(["DRAFTS", "draft", "", " drafts", "likes"])("%j は posts に丸める", (tab) => {
    expect(parseMypageQuery({ tab }).tab).toBe("posts");
  });
  it("配列で来たら先頭で判定する", () => {
    expect(parseMypageQuery({ tab: ["drafts", "posts"] }).tab).toBe("drafts");
  });
  it.each(["0", "-1", "1.5", "abc", ""])("page=%j は 1 に丸める", (page) => {
    expect(parseMypageQuery({ page }).page).toBe(1);
  });
  it("正の整数の page はそのまま使う", () => {
    expect(parseMypageQuery({ tab: "favorites", page: "3" })).toEqual({ tab: "favorites", page: 3 });
  });
});

describe("mypageHref", () => {
  it("既定値は省く", () => {
    expect(mypageHref()).toBe("/mypage");
    expect(mypageHref({ tab: "posts", page: 1 })).toBe("/mypage");
  });
  it("タブだけ渡すと 1 ページ目（タブの切り替えでページを引き継がない）", () => {
    expect(mypageHref({ tab: "drafts" })).toBe("/mypage?tab=drafts");
  });
  it("タブとページ", () => {
    expect(paramsOf(mypageHref({ tab: "attempts", page: 2 }))).toEqual({ tab: "attempts", page: "2" });
  });
  it("組み立てた URL を parse すると元に戻る", () => {
    const query: MypageQuery = { tab: "favorites", page: 4 };
    expect(parseMypageQuery(paramsOf(mypageHref(query)))).toEqual(query);
  });
});

describe("mypageApiPath", () => {
  it.each([
    [{ tab: "posts", page: 1 }, "/api/me/posts"],
    [{ tab: "attempts", page: 1 }, "/api/me/attempts"],
    [{ tab: "drafts", page: 2 }, "/api/me/drafts?page=2"],
    [{ tab: "favorites", page: 3 }, "/api/me/favorites?page=3"],
  ] as const)("%j → %s（tab はクエリに載せない）", (query, path) => {
    expect(mypageApiPath(query)).toBe(path);
  });
});

describe("MYPAGE_TABS", () => {
  it("表示順はデザインブリーフどおり", () => {
    expect(MYPAGE_TABS.map(({ tab }) => tab)).toEqual(["posts", "attempts", "drafts", "favorites"]);
  });
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/mypage/mypage-query.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: `mypage-query.ts` を実装し、`types/api.ts` に型を足す**

ファイル冒頭のコメントで「画面の URL と API のパスを同じモジュールから作る理由」を `posts-query.ts` に倣って書く。タブの判定は `MYPAGE_TABS` の値との完全一致。

- [ ] **Step 4: 通ることを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/mypage/mypage-query.test.ts && docker compose exec frontend npx tsc --noEmit`
Expected: PASS、型エラーなし

- [ ] **Step 5: コミット**

```bash
git add frontend/src/lib/mypage frontend/test/lib/mypage frontend/src/types/api.ts
git commit -m "feat: マイページのタブとページを URL と API パスに変換する関数を足す"
```

---

### Task 2: 頭文字のアバターと、ヘッダーからマイページへの入口

**Files:**
- Create: `frontend/src/lib/users/avatar-initial.ts`
- Create: `frontend/test/lib/users/avatar-initial.test.ts`
- Create: `frontend/src/components/ui/user-avatar.tsx`
- Modify: `frontend/src/components/layout/site-header.tsx`（ログイン中の名前の `<span>` と、冒頭のナビのコメント「7-6: アバター → /mypage」）

**Interfaces:**
- Produces:
  - `export function avatarInitial(name: string): string` … 前後の空白を落とした最初のコードポイント（`Array.from`）。ラテン文字は大文字にする。空なら `"?"`
  - `export function UserAvatar({ name, size }: { name: string; size: "sm" | "lg" }): JSX.Element` … 丸の中に頭文字。**`aria-hidden="true"`**。`sm` はヘッダー用（`size-7` 程度）、`lg` はプロフィール用（`size-16` 程度）。色は `bg-accent/10 text-accent` など既存トークン

- [ ] **Step 1: 失敗するテストを書く**

```ts
describe("avatarInitial", () => {
  it.each([
    ["山田", "山"],
    ["alice", "A"],
    ["  bob", "B"],
    ["😀smile", "😀"], // サロゲートペアを割らない
    ["", "?"],
    ["   ", "?"],
  ])("%j → %j", (name, initial) => {
    expect(avatarInitial(name)).toBe(initial);
  });
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/users/avatar-initial.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: `avatarInitial` と `UserAvatar` を実装する**

結合文字や ZWJ の絵文字が崩れうるのは飾りなので許容する、という判断（設計書の決定 7）をコメントに残す。

- [ ] **Step 4: 通ることを確かめる**

Run: `docker compose exec frontend npx vitest run test/lib/users/avatar-initial.test.ts`
Expected: PASS

- [ ] **Step 5: ヘッダーを書き換える**

`<span className="max-w-40 truncate ..." title={auth.user.name}>` を、`<Link href="/mypage" className="flex min-w-0 items-center gap-2 text-ink-muted hover:text-ink">` に置き換える。中身は `<UserAvatar name={auth.user.name} size="sm" />` と、`max-w-40 truncate` と `title` を引き継いだ名前の `<span>`。読み上げ名は名前だけになる（丸は `aria-hidden`）。冒頭のコメントの「7-6: アバター → /mypage」は、実装したので「7-7: ランキング」だけを残す。

- [ ] **Step 6: 型・lint とブラウザで確かめる**

Run: `docker compose exec frontend npx tsc --noEmit && docker compose exec frontend npm run lint`
Expected: エラーなし

ブラウザ（`http://localhost:3001`）：ログイン中のヘッダーに丸＋名前が出て、押すと `/mypage` に移る（ページは Task 3 まで 404 でよい）。**空白を含まない 60 文字の名前**のユーザーで、PC 幅とスマホ幅（375px）で横にはみ出さないこと。

- [ ] **Step 7: コミット**

```bash
git add frontend/src/lib/users frontend/test/lib/users frontend/src/components/ui/user-avatar.tsx frontend/src/components/layout/site-header.tsx
git commit -m "feat: ヘッダーの名前を頭文字のアバター付きでマイページへのリンクにする"
```

**注意：** main をマージすると本番に出るので、Task 3 のページが同じ PR に入ることが前提（存在しないルートへのリンクを本番に置かない）。

---

### Task 3: /mypage のページ、プロフィールヘッダー、タブ

**Files:**
- Create: `frontend/src/app/mypage/page.tsx`
- Create: `frontend/src/components/mypage/mypage-view.tsx`
- Create: `frontend/src/components/mypage/profile-header.tsx`
- Create: `frontend/src/components/mypage/mypage-tabs.tsx`

**Interfaces:**
- Consumes: `parseMypageQuery` / `mypageHref` / `MYPAGE_TABS` / `MypageQuery`（Task 1）、`UserAvatar`（Task 2）、`RequireAuth`、`useAuth`、`apiFetch`、`toRequestErrorMessage`、`MeResponse`
- Produces:
  - `MypageView({ query }: { query: MypageQuery })` … クライアント。`useAuth()` が `authenticated` でなければ `null`（`RequireAuth` の内側なので実際には来ない）。`ProfileHeader` → `MypageTabs` → 一覧の順に並べる。一覧の位置は Task 4 で `MypageList` を入れるまで仮の空要素でよい
  - `ProfileHeader({ name }: { name: string })` … `GET /api/me` を自分で取る
  - `MypageTabs({ current }: { current: MypageTab })`

- [ ] **Step 1: `app/mypage/page.tsx` を作る**

`app/posts/page.tsx` と `app/posts/new/page.tsx` を合わせた形。`metadata.title` は `"マイページ"`。`searchParams: Promise<RawSearchParams>` を `await` して `parseMypageQuery` に通し、`<main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8"><RequireAuth><MypageView query={query} /></RequireAuth></main>`。`<h1>` は置かず、プロフィールの名前を見出しにする（`ProfileHeader` の名前を `<h1>`）。

- [ ] **Step 2: `ProfileHeader` を作る**

- 左に `<UserAvatar size="lg">`、右に名前（`<h1>`、`wrap-break-word`。空白なしの長い名前で折り返す）と統計
- 統計は `「投稿したお題 N」「挑戦 N」「獲得いいね N」`（`stats.posts_count` / `attempts_count` / `likes_received_count`）。数字は `font-medium text-ink tabular-nums`
- 取得の形は `PostList` と同じ（`AbortController`、`retryCount`、`{ key, outcome }`）。読み込み中は 3 つぶんの灰色の枠
- 失敗したら統計の位置に `toRequestErrorMessage(error)` と小さな「再試行」ボタン。**一覧には影響させない**（設計書の決定 8）
- 名前は `useAuth()` から渡された値を使う（`/api/me` の `name` を待たない）

- [ ] **Step 3: `MypageTabs` を作る**

`<nav aria-label="マイページのタブ">` に、`MYPAGE_TABS` の順で `<Link href={mypageHref({ tab })}>`（**page を渡さない**）。選択中は `aria-current="page"`、見た目は `SortToggle` と同じ `buttonClasses({ variant: active ? "primary" : "secondary", size: "sm" })`。スマホ幅で 4 つが収まらないときは `flex-wrap` で折り返す（横スクロールにしない）。tablist にしない理由（URL が変わるページ遷移で、矢印キーの約束と合わない）をコメントに書く。

- [ ] **Step 4: 型・lint とブラウザで確かめる**

Run: `docker compose exec frontend npx tsc --noEmit && docker compose exec frontend npm run lint`
Expected: エラーなし

ブラウザ：
- ヘッダーの名前から `/mypage` に移り、アバター・名前・統計 3 つが出る。統計の値が `curl` で取った `GET /api/me` と一致する
- タブを押すと URL が `/mypage?tab=attempts` などに変わり、選択中の見た目が移る
- 未ログインで `/mypage` を開くと `/login?next=%2Fmypage` に送られる
- 長い名前のユーザーで、プロフィールが 375px 幅で横にはみ出さない
- 統計だけ失敗させる（DevTools の Network で `/api/me` をブロック）と、統計の位置にエラーと「再試行」が出る

- [ ] **Step 5: コミット**

```bash
git add frontend/src/app/mypage frontend/src/components/mypage
git commit -m "feat: マイページにプロフィールと統計、タブを出す"
```

---

### Task 4: タブの一覧（投稿したお題・お気に入り）と、空状態・範囲外・失敗

**Files:**
- Create: `frontend/src/components/mypage/mypage-list.tsx`
- Modify: `frontend/src/components/mypage/mypage-view.tsx`（仮の要素を `MypageList` に置き換える）

**Interfaces:**
- Consumes: `mypageApiPath` / `mypageHref` / `MypageQuery`（Task 1）、`MyAttemptsResponse`（Task 1）、`PostsIndexResponse`、`PostCard`、`Pagination`、`apiFetch`、`toRequestErrorMessage`
- Produces: `MypageList({ query }: { query: MypageQuery })`。挑戦・下書きのカードは Task 5 で差し込むので、この時点ではその 2 タブを「件数だけ出してカードは描かない」状態でよい

- [ ] **Step 1: `MypageList` を実装する**

- 取得は `PostList` と同じ形。**`requestKey` は `${mypageApiPath(query)}#${retryCount}`**。API パスにタブが入っているので、前のタブの応答は `key` が一致せず描画されない（Review Focus 2）
- 応答の型はタブで分かれるので、結果を判別共用体で持つ：
  ```ts
  type ListData =
    | { kind: "posts"; data: PostsIndexResponse }      // tab が posts / favorites
    | { kind: "attempts"; data: MyAttemptsResponse };  // tab が attempts / drafts
  ```
  取得時にタブから `kind` を決めて詰める。描画は `kind` で分岐する（`as` で型を曲げない）
- 状態ごとの表示（`PostList` の `PostGridSkeleton` / エラー＋「再試行」/ `EmptyState` を同じ見た目で）：
  - 読み込み中：12 枚のスケルトン（グリッドは `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6`）
  - 失敗：文言＋「再試行」
  - 範囲外（件数 0 でなく、このページが空）：「このページには何もありません」＋ `mypageHref({ tab: query.tab })` への「1 ページ目へ」
  - 空（`total_count === 0`）：下の表の文言と行き先のリンク（`buttonClasses()`）
  - あり：「全 N 件」、グリッド、`<Pagination hrefFor={(page) => mypageHref({ tab: query.tab, page })} />`

  | タブ | 文言 | リンク |
  |---|---|---|
  | posts | まだお題を投稿していません | 「お題を投稿」→ `/posts/new` |
  | attempts | まだ挑戦していません | 「お題を探す」→ `/posts` |
  | drafts | 保存した下書きはありません | 「お題を探す」→ `/posts` |
  | favorites | お気に入りしたお題はありません | 「お題を探す」→ `/posts` |

- 投稿したお題・お気に入りは `PostCard` を並べる

- [ ] **Step 2: 型・lint とブラウザで確かめる**

Run: `docker compose exec frontend npx tsc --noEmit && docker compose exec frontend npm run lint`
Expected: エラーなし

ブラウザ：
- 投稿したお題・お気に入りが出て、件数が統計（投稿したお題）と一致する
- お題を 13 件以上持つユーザーで、ページ送りが `?page=2` に移り、タブを切り替えると 1 ページ目に戻る
- `?page=99` で「このページには何もありません」と「1 ページ目へ」
- 何も持たない新規ユーザーで、4 タブすべてに空状態の文言とリンクが出る
- DevTools で Slow 3G にし、タブを素早く連続で切り替えても、最後に押したタブの中身だけが出て、エラーにもならない（Review Focus 2）
- backend を止めて「再試行」が出て、起動し直して押すと戻る

- [ ] **Step 3: コミット**

```bash
git add frontend/src/components/mypage
git commit -m "feat: マイページのタブの一覧と空状態を出す"
```

---

### Task 5: 自分の挑戦カードと下書きカード

**Files:**
- Create: `frontend/src/components/mypage/my-attempt-card.tsx`
- Create: `frontend/src/components/mypage/draft-card.tsx`
- Modify: `frontend/src/components/mypage/mypage-list.tsx`（`kind: "attempts"` の描画で、タブが `attempts` なら `MyAttemptCard`、`drafts` なら `DraftCard`）

**Interfaces:**
- Consumes: `MyAttempt`（Task 1）、`cloudinaryUrlOrNull`、`attemptDetailHref`、`attemptCardLabel`
- Produces: `MyAttemptCard({ attempt }: { attempt: MyAttempt })`、`DraftCard({ draft }: { draft: MyAttempt })`

- [ ] **Step 1: `MyAttemptCard` を実装する**（`AttemptCard` の作りを写し、`AttemptCard` 自体は変えない）

- 中身：再現画像（`cloudinaryUrlOrNull(generated_image_public_id, { width: 640, aspect: "1:1" })`、`null` なら同寸の空枠）、描写文（`line-clamp-3 whitespace-pre-wrap wrap-break-word`）、お題の行、`いいね N`。**投稿者名は出さない**
- お題の行：`post.discarded` が false なら `お題：{post.title}`（`truncate`）、true なら `お題は削除されました`（`text-ink-muted`）
- `post.discarded` が false：`<Link href={attemptDetailHref(attempt.id)} aria-label={attemptCardLabel(attempt)}>` でカード全体を包む（`AttemptCard` と同じ見た目・フォーカスリング）
- `post.discarded` が true：**リンクにしない**。同じ `<article>` を `<Link>` なしで描き、hover の色変化も付けない。理由（挑戦詳細 API が `Post.kept.find` で 404 にする）をコメントに書く
- 画像の `alt` は `"あなたの再現画像"`（`GenerationPanel` と同じ）

- [ ] **Step 2: `DraftCard` を実装する**

- 中身：お題のサムネイル（`cloudinaryUrlOrNull(post.image_public_id, { width: 640, aspect: "4:3" })`。`post.discarded` または `null` なら同寸の空枠）、お題の行（`MyAttemptCard` と同じ出し分け）、描写文（3 行まで）
- **リンクにしない。** 理由（お題詳細へ移ると空の描写フォームが開き、保存した文面が消えたように見える。導線は 7-6b で受け口と一緒に作る）をコメントに書く
- 画像の `alt` はお題のタイトル。削除済みなら空枠に `role="img" aria-label="削除されたお題"`

- [ ] **Step 3: 型・lint とブラウザで確かめる**

Run: `docker compose exec frontend npx tsc --noEmit && docker compose exec frontend npm run lint`
Expected: エラーなし

ブラウザ（データの用意：お題詳細で描写を「保存」して下書きを作り、別の描写で「画像を生成」して公開済みの挑戦を作る。そのあと別ユーザーのお題に付いた挑戦・下書きを作り、そのお題を投稿者として `DELETE /api/posts/:id` で削除する）：
- 自分の挑戦：再現画像・描写文・お題名・いいね数が出て、押すと挑戦詳細に移る。件数が統計の「挑戦」と一致する
- 下書き：お題のサムネイル・タイトル・描写文が出て、押しても移らない
- 削除済みのお題に付いた挑戦・下書き：「お題は削除されました」と出て、リンクにならず、落ちない（Review Focus 3）
- お題の画像に 16:9 と 3:4 の画像を混ぜ（開発データは 64px の正方形しか無いので、`sips` などで作って投稿する）、下書きのサムネイルが 4:3 に切り抜かれて灰色の帯が出ないこと

- [ ] **Step 4: コミット**

```bash
git add frontend/src/components/mypage
git commit -m "feat: マイページに自分の挑戦カードと下書きカードを出す"
```

---

### Task 6: backlog の書き換えと通しの確認

**Files:**
- Modify: `docs/issues_backlog.md`（7-6 の節 1018 行付近、背骨 1189 行付近、3-3 の「フロント側」232 行付近）

- [ ] **Step 1: 7-6 を 7-6a / 7-6b に分ける**

- `### 🟢 7-6. マイページ（/mypage）` を 2 つの節にする：
  - `### 🟢 7-6a. マイページの表示`：依存（7-1, 6-3, 4-4）、タスク（プロフィール＋統計、4 タブの表示、空状態、ヘッダーからの入口）、設計書へのパス、完了条件「4 タブと統計が表示される」。GitHub #27 を 7-6b と共有することを書く
  - `### 🟢 7-6b. 下書きの再開・生成と、挑戦の削除`：依存 7-6a。今の 7-6 にある「この依存の理由」「4-4 の申し送り」「7-3b / 7-3c からの申し送り」をここへ移す。決定 2（下書きの再開はお題詳細で、`GET /api/attempts/:id` で検証できる）を足す。完了条件は今の「下書きから生成に進める」と「自分の挑戦・下書きを削除できる」
- 背骨の `→（7-6）→` を `→（7-6a → 7-6b）→` にし、まとめの箇条に「7-6 は表示と操作に分けてある（7-3 と同じく PR の大きさを揃えるため）」を 1 行足す
- 3-3 の「フロント側：…（**7-6 に含める**か、別 issue にする）」を、「7-6 には含めなかった（7-6a 設計書 決定 3）。3-3 で『投稿したお題』タブに導線を足す」に直す
- `grep -n "7-6" docs/issues_backlog.md` で、他に「7-6」を指している箇所（7-3c・7-4 の申し送りなど）が 7-6a / 7-6b のどちらを指すべきかを見て直す。下書きの再開・削除・生成中の表示は 7-6b

- [ ] **Step 2: テスト・型・lint をまとめて回す**

Run: `docker compose exec frontend npx tsc --noEmit && docker compose exec frontend npm run lint && docker compose exec frontend npm test`
Expected: すべて通る

- [ ] **Step 3: 通しの手動確認**

1. **ログインしたまま `/mypage?tab=drafts` を直接ロード、続けてリロード。** `/login` に飛ばされず、下書きタブが開く（Review Focus 1）
2. `/mypage?tab=drafts` を開いたまま、DevTools でトークンを壊して（`localStorage` の値を書き換えて）リロードする → ログイン画面に送られ、ログインし直すと `/mypage?tab=drafts` に戻る
3. URL を `?tab=DRAFTS`・`?tab=drafts&tab=posts`・`?page=0` に書き換えて開き、落ちずに正規化された表示になる（Review Focus 5）
4. スマホ幅（375px）で 4 タブすべてを開き、横スクロールが出ない

- [ ] **Step 4: コミット**

```bash
git add docs/issues_backlog.md
git commit -m "docs: 7-6 を表示（7-6a）と操作（7-6b）に分けて backlog に書く"
```

- [ ] **Step 5: プッシュ前のレビュー**

`superpowers:requesting-code-review` の最終レビューと、`/code-review high` の**両方**を通す（別物）。指摘を直したら、その差分にもう一度 `/code-review high` をかける。PR 本文は `Refs #27`（`Closes` にしない）。
