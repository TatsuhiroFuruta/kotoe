# フロントエンドの前提整備（timeout・ボタンの共通化） 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apiRequest` が無限に待つのをやめ、15 秒で `ApiTimeoutError` にして「サーバーの応答がありません」と伝えられるようにする。あわせて主ボタンのクラス列 11 箇所を 1 本の関数に集める。**画面（ルート）は 1 つも作らない。**

**Architecture:** `api.ts` に `AbortSignal.timeout(timeoutMs)` を足し、呼び出し側の `signal` があれば `AbortSignal.any()` で合成して `fetch` に渡す。中断のうち `name === "TimeoutError"` のものだけを `ApiTimeoutError` に変換し、呼び出し側のキャンセル（`AbortError`）はそのまま流す。`error-messages.ts` が `ApiTimeoutError` を通信断とは別の文言に翻訳する。`AuthProvider` と `SiteHeader` は**変更しない**（復元の `catch` が理由を問わず `restoreFailedFor` を立て、`unreachable` の分岐が既にあるため、timeout を足すだけで全ページのヘッダーが 15 秒で操作可能になる）。ボタンは `buttonClasses()` というクラス文字列を返す純粋関数にし、コンポーネントにはしない。

**Tech Stack:** Next.js 16.2.10（App Router）／ TypeScript ／ TailwindCSS ／ Vitest 4.1.11（jsdom）／ Docker Compose。**新しい依存は追加しない。**

**Spec:** `docs/superpowers/specs/2026-09-22-issue-7-2-7-frontend-groundwork-design.md`

**Issue:** GitHub #113（`docs/issues_backlog.md` 7-2.7）

**Branch:** `feat/frontend-groundwork`（作成済み。設計書のコミット `54cea5e` / `7bc6322` / `bab4fd0` が載っている）

## Global Constraints

このプロジェクト全体の規約。**全タスクの要件に暗黙に含まれる。**

- **依存パッケージを追加しない。** `frontend/package.json` は変更しない。
- **`backend/` のコードは 1 行も変更しない。** この issue はフロントだけで閉じる。
- **`frontend/src/app/globals.css` を変更しない。** 過去 4 回の Turbopack stale はすべて
  このファイルの変更で起きている（`frontend/AGENTS.md`）。この issue は CSS を書かない。
- **文字列はダブルクォート。** コメントは日本語で、「何をしているか」ではなく
  **「なぜそうしたか」**を書く（既存ファイルの書き方に合わせる）。
- **`any` を使わない。** API レスポンスには型を付ける。
- **新しいルート（ページ）を作らない。** ナビの「探す」→ `/posts` とトップの CTA は
  この issue では**足さない**（7-3a に移してある。`/posts` が実在しないうちに置くと
  main を追跡している本番で 404 になる）。
- **`main` へ直接コミットしない。** 作業は `feat/frontend-groundwork` 上で行う。
- **テストは `frontend/test/` に置き、`src/` の構造を写す。** コンポーネントテストは書かない。
- **`vi.useFakeTimers()` を timeout の検査に使わない。** `AbortSignal.timeout` を制御できない
  （2026-09-22 実測。設計書「テスト」参照）。
- コマンドはリポジトリのルートで実行し、`npm` 系は `docker compose exec frontend <コマンド>` で
  コンテナ内で動かす（CLAUDE.md「よく使うコマンド」に合わせる）。
- コミットメッセージの末尾は `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` で止める
  （セッションリンクを書かない）。

## ファイル構成

| ファイル | 責務 | タスク |
|---|---|---|
| `frontend/src/components/ui/button.ts` | **新規**。ボタンのクラス文字列を組む純粋関数。React も DOM も知らない | 1 |
| `frontend/src/app/page.tsx` | ボタン 2 箇所を置き換える | 1 |
| `frontend/src/app/(auth)/login/page.tsx` | ボタン 1 箇所 | 1 |
| `frontend/src/app/(auth)/signup/page.tsx` | ボタン 1 箇所 | 1 |
| `frontend/src/components/dev/health-panel.tsx` | ボタン 2 箇所 | 1 |
| `frontend/src/lib/api.ts` | `ApiTimeoutError`・`timeoutMs`・`AbortSignal` の合成 | 2 |
| `frontend/test/lib/api.test.ts` | timeout の検査 4 件を追加 | 2 |
| `frontend/src/lib/auth/error-messages.ts` | `ApiTimeoutError` → 文言 | 3 |
| `frontend/test/lib/auth/error-messages.test.ts` | 文言の検査 1 件を追加 | 3 |
| `frontend/src/components/layout/site-header.tsx` | ボタン 4 箇所（1）＋ `unreachable` の文言（3） | 1・3 |
| `frontend/src/lib/auth/require-auth.tsx` | ボタン 1 箇所（1）＋ `unreachable` の文言（3） | 1・3 |

`site-header.tsx` と `require-auth.tsx` を 2 つのタスクで触るのは、ボタンの置き換え
（見た目の話）と文言の変更（エラー表現の話）がレビューで別々に判断できるものだからである。
同じファイルだが別のコミットに分ける。

---

### Task 1: `buttonClasses()` を足し、11 箇所を置き換える

**Files:**
- Create: `frontend/src/components/ui/button.ts`
- Modify: `frontend/src/app/page.tsx:51-63`
- Modify: `frontend/src/app/(auth)/login/page.tsx:92-98`
- Modify: `frontend/src/app/(auth)/signup/page.tsx:100-106`
- Modify: `frontend/src/components/layout/site-header.tsx:52-105`
- Modify: `frontend/src/components/dev/health-panel.tsx:72-90`
- Modify: `frontend/src/lib/auth/require-auth.tsx:43-49`
- Test: なし（理由は下の「テストを書かない理由」）

**Interfaces:**
- Consumes: なし（このタスクが最初）
- Produces: `buttonClasses(options?: { variant?: "primary" | "secondary"; size?: "sm" | "md" | "lg" }): string`
  — `@/components/ui/button` から名前付きエクスポート。既定は `variant: "primary"` / `size: "md"`。

**テストを書かない理由：** 返り値のクラス文字列を照合するテストは実装をそのまま写経した
ものになり、6-1 で学んだ「green なのに何も守っていない」型に当てはまる
（`docs/superpowers/specs/2026-08-19-issue-6-1-best-attempts-design.md`）。
このタスクの検証は `npm run lint`・`npx tsc --noEmit`・ブラウザでの目視で行う。

- [ ] **Step 1: `buttonClasses()` を作る**

`frontend/src/components/ui/button.ts` を新規作成：

```ts
/**
 * 主ボタンの見た目を 1 箇所に集める。
 *
 * コンポーネントではなく「クラス文字列を返す関数」にしてある。現物 11 箇所の
 * うち 3 箇所は <Link> で、7-3a のページネーションとソートでさらに増える。
 * <Link> と <button> の両方を受ける部品にすると、href の有無で props の型を
 * 分ける必要があり、disabled のように片方にしか無い属性の扱いも決めることに
 * なる。クラスを配るだけなら、その問題がそもそも発生しない。
 */

type ButtonVariant = "primary" | "secondary";
type ButtonSize = "sm" | "md" | "lg";

/**
 * disabled:opacity-60 は <Link> には効かないが無害なので共通に置く。
 * <button> 側で付け忘れる余地を消すほうを採る。
 *
 * font-medium も共通に置く。現状 secondary の 5 箇所（ヘッダー 3・
 * HealthPanel 2）には無いので、それらはわずかに太くなる。primary にだけ
 * 入れると、ヒーローで隣り合う「新規登録」と「ログイン」が別の太さになり、
 * そちらのほうが事故に見えるため。
 */
const BASE_CLASSES = "rounded-card font-medium disabled:opacity-60";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-strong",
  secondary: "border border-line text-ink-muted hover:text-ink",
};

/**
 * padding だけを持ち、**文字サイズは持たせない**。require-auth と
 * health-panel は text-sm を併用しており、ここが text-base を持つと
 * font-size のクラスが 2 つ同時に当たる。Tailwind では詳細度が同じ
 * クラスの優先順位は生成された CSS の順序で決まり、className に書いた順では
 * 決まらないため、どちらが効くかがビルドに依存することになる。
 * 持たせなければ衝突自体が起きない。
 */
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5",
  md: "px-4 py-2",
  lg: "px-5 py-2.5",
};

export function buttonClasses({
  variant = "primary",
  size = "md",
}: { variant?: ButtonVariant; size?: ButtonSize } = {}): string {
  return `${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]}`;
}
```

- [ ] **Step 2: 型が通ることを確認する**

```bash
docker compose exec frontend npx tsc --noEmit
```

Expected: エラーなし（新規ファイルはまだ誰からも参照されていない）。

- [ ] **Step 3: `app/page.tsx` の 2 箇所を置き換える**

import を足す（`import Link from "next/link";` の下、`@/` 群の先頭）：

```tsx
import { buttonClasses } from "@/components/ui/button";
```

`<Link href="/signup">` の className：

```tsx
// 変更前
className="rounded-card bg-accent px-5 py-2.5 font-medium text-white hover:bg-accent-strong"
// 変更後
className={buttonClasses({ size: "lg" })}
```

`<Link href="/login">` の className：

```tsx
// 変更前
className="rounded-card border border-line px-5 py-2.5 font-medium text-ink-muted hover:text-ink"
// 変更後
className={buttonClasses({ variant: "secondary", size: "lg" })}
```

- [ ] **Step 4: `app/(auth)/login/page.tsx` の submit ボタンを置き換える**

import を足す（`@/components/ui/text-field` の**上**。eslint の import 順は
パスのアルファベット順）：

```tsx
import { buttonClasses } from "@/components/ui/button";
```

```tsx
// 変更前
className="mt-2 rounded-card bg-accent px-4 py-2 font-medium text-white hover:bg-accent-strong disabled:opacity-60"
// 変更後
className={`mt-2 ${buttonClasses()}`}
```

`mt-2` は**余白であってボタンの見た目ではない**ので `buttonClasses()` に入れず、
呼び出し側で並べる。

- [ ] **Step 5: `app/(auth)/signup/page.tsx` の submit ボタンを置き換える**

Step 4 とまったく同じ import と置き換えを行う（クラス文字列も同一）。

```tsx
import { buttonClasses } from "@/components/ui/button";
```

```tsx
// 変更前
className="mt-2 rounded-card bg-accent px-4 py-2 font-medium text-white hover:bg-accent-strong disabled:opacity-60"
// 変更後
className={`mt-2 ${buttonClasses()}`}
```

- [ ] **Step 6: `components/layout/site-header.tsx` の 4 箇所を置き換える**

import を足す：

```tsx
import { buttonClasses } from "@/components/ui/button";
```

`<Link href="/signup">`（1 箇所）：

```tsx
// 変更前
className="rounded-card bg-accent px-3 py-1.5 font-medium text-white hover:bg-accent-strong"
// 変更後
className={buttonClasses({ size: "sm" })}
```

ログアウト・再試行・ログアウト（**3 箇所。クラス文字列はすべて同一**）：

```tsx
// 変更前
className="rounded-card border border-line px-3 py-1.5 text-ink-muted hover:text-ink"
// 変更後
className={buttonClasses({ variant: "secondary", size: "sm" })}
```

文字サイズは親の `<nav className="flex items-center gap-3 text-sm">` から継承されるので、
`text-sm` を足す必要はない。

- [ ] **Step 7: `components/dev/health-panel.tsx` の 2 箇所を置き換える**

import を足す：

```tsx
import { buttonClasses } from "@/components/ui/button";
```

成功トースト・失敗トーストのボタン（**2 箇所。クラス文字列は同一**）：

```tsx
// 変更前
className="rounded-card border border-line px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
// 変更後
className={`${buttonClasses({ variant: "secondary", size: "sm" })} text-sm`}
```

ここは `<nav>` の中ではないので `text-sm` を自分で足す。`buttonClasses()` が
文字サイズを持たないので衝突しない。

- [ ] **Step 8: `lib/auth/require-auth.tsx` の再試行ボタンを置き換える**

import を足す：

```tsx
import { buttonClasses } from "@/components/ui/button";
```

```tsx
// 変更前
className="rounded-card bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong"
// 変更後
className={`${buttonClasses()} text-sm`}
```

- [ ] **Step 9: 複製が残っていないことを確認する**

```bash
docker compose exec frontend sh -c 'grep -rn "bg-accent px-\|border-line px-" src || echo "複製なし"'
```

Expected: `複製なし`

- [ ] **Step 10: 型・lint・既存テストを通す**

```bash
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run lint
docker compose exec frontend npm test
```

Expected: 3 つとも PASS（テストはこの時点で 8 ファイル・71 件すべて green のまま）。

- [ ] **Step 11: ブラウザで見た目を確認する**

`http://localhost:3001/` と `/login` と `/signup` を開き、

- ヒーローの「新規登録」「ログイン」が横並びで**同じ太さ**であること
- ヘッダーの「新規登録」が accent 色のままであること
- ログイン済みにして、ヘッダーの「ログアウト」がわずかに太くなる以外は変わらないこと

- [ ] **Step 12: コミット**

```bash
git add frontend/src/components/ui/button.ts frontend/src/app frontend/src/components frontend/src/lib/auth/require-auth.tsx
git commit -m "$(cat <<'MSG'
refactor: 主ボタンのクラス列を buttonClasses に集める

primary 5 箇所・secondary 6 箇所に同じクラス列が複製されており、padding も
3 種に散っていた。7-3a のページネーションとソートで <Link> 側がさらに増える
ので、その前に 1 箇所へ集める。

コンポーネントではなくクラス文字列を返す関数にした。現物 11 箇所のうち
3 箇所が <Link> で、<Link> と <button> の両方の props を受ける部品にすると
href の有無で型を分けることになるため。

size に文字サイズを持たせていないのは、require-auth と health-panel の
text-sm と衝突したとき、どちらが効くかが CSS の生成順で決まって className の
順では決まらないため。

font-medium を共通に置いたので、ヘッダー 3 箇所と HealthPanel 2 箇所が
わずかに太くなる。primary にだけ入れるとヒーローで隣り合う 2 つが別の太さに
なるので、揃えるほうを採った。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 2: `apiRequest` に timeout を足す

**Files:**
- Modify: `frontend/src/lib/api.ts:18-25`（`ApiRequestInit`）、`:49-105`（`apiRequest`）
- Test: `frontend/test/lib/api.test.ts`（既存ファイルの末尾に `describe` を足す）

**Interfaces:**
- Consumes: なし（Task 1 とは独立。順序を入れ替えてもよい）
- Produces:
  - `class ApiTimeoutError extends Error { readonly timeoutMs: number }` — `@/lib/api` から
    名前付きエクスポート。`name` は `"ApiTimeoutError"`
  - `ApiRequestInit` に `timeoutMs?: number` が増える（既定 15000）

- [ ] **Step 1: 失敗するテストを書く**

`frontend/test/lib/api.test.ts` の先頭の import に `ApiTimeoutError` を足す：

```ts
import { ApiError, ApiTimeoutError, apiFetch, apiRequest } from "@/lib/api";
```

ファイル末尾（最後の `});` の**後ろ**）に、新しい `describe` を足す：

```ts
/**
 * 応答を返さない fetch のスタブ。signal を尊重し、中断されたら本物の fetch と
 * 同じく signal.reason で reject する。
 *
 * 既存の stubFetch は signal を無視して即座に解決するので、timeout の検査には
 * 使えない（タイマーが発火する前に応答が返ってしまう）。
 */
function stubHangingFetch() {
  const fetchMock = vi.fn<typeof fetch>(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("apiRequest の timeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // vi.useFakeTimers() は AbortSignal.timeout を制御できない（Node 側の
  // ネイティブ実装が動くため）。15 秒待つテストは書けないので、既定値が
  // 渡されていることだけを引数で検査する。
  it("既定で 15 秒を AbortSignal.timeout に渡す", async () => {
    const spy = vi.spyOn(AbortSignal, "timeout");
    stubFetch(jsonResponse({ posts: [] }));

    await apiFetch("/api/posts");

    expect(spy).toHaveBeenCalledWith(15_000);
  });

  // 実際に時間を経過させる検査は、小さな timeoutMs に上書きして実時間で行う。
  it("応答が返らなければ timeoutMs で ApiTimeoutError を投げる", async () => {
    stubHangingFetch();

    await expect(apiFetch("/api/posts", { timeoutMs: 20 })).rejects.toMatchObject({
      name: "ApiTimeoutError",
      timeoutMs: 20,
    });
  });

  // 合成の片方向。呼び出し側の signal だけを fetch へ渡す実装にすると、
  // signal を渡したリクエストだけが無限に待つようになる。
  it("呼び出し側が signal を渡していても timeout は効く", async () => {
    stubHangingFetch();
    const controller = new AbortController();

    await expect(
      apiFetch("/api/posts", { timeoutMs: 20, signal: controller.signal }),
    ).rejects.toBeInstanceOf(ApiTimeoutError);
  });

  // 合成のもう片方向。呼び出し側のキャンセルは失敗ではないので、
  // ApiTimeoutError に変換してはいけない（7-3b のポーリングがアンマウントの
  // たびにエラー文言を出すことになる）。
  it("呼び出し側が中断したときは AbortError がそのまま流れる", async () => {
    stubHangingFetch();
    const controller = new AbortController();

    const promise = apiFetch("/api/posts", { timeoutMs: 5_000, signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    await expect(promise).rejects.not.toBeInstanceOf(ApiTimeoutError);
  });
});
```

- [ ] **Step 2: テストが落ちることを確認する**

```bash
docker compose exec frontend npx vitest run test/lib/api.test.ts
```

Expected: FAIL。`ApiTimeoutError` が `@/lib/api` に無いため、まずインポートの
時点で落ちる（`does not provide an export named 'ApiTimeoutError'` のような
メッセージになる）。

- [ ] **Step 3: `api.ts` に `ApiTimeoutError` と既定値を足す**

`ApiError` クラスの**下**に足す：

```ts
/**
 * 応答を待つ既定の上限。
 *
 * Render の無料枠は約 15 分のアイドルでスリープし、次のアクセスの
 * コールドスタートに約 1 分かかる。15 秒は**必ずタイムアウトする**値だが、
 * それを承知で選んでいる。60 秒に合わせると「1 回で成功する代わりに最大
 * 60 秒無言で待つ」ことになり、押せるものがロゴだけの状態がほぼそのまま
 * 残るため。15 秒で unreachable に落とせば、待つか抜けるかをユーザーが
 * 選べる（設計書「決定 1」）。
 */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * 応答が上限内に返らなかったときのエラー。
 *
 * ApiError（2xx 以外）と同じく instanceof で判定できる形に揃える。
 * DOMException をそのまま流して name の文字列で判定する案は採らない。
 * api.ts が投げうるものの一覧が型から読めなくなるため。
 */
export class ApiTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`API request timed out after ${timeoutMs}ms`);
    this.name = "ApiTimeoutError";
  }
}
```

`ApiRequestInit` に 1 行足す：

```ts
export type ApiRequestInit = RequestInit & {
  /**
   * true なら Authorization ヘッダを載せない。sign_up / sign_in で使う。
   * 「まだトークンを持っていないはずだから省略できる」ではなく、
   * ログイン中に再ログインされても下の 401 判定を壊さないために明示する。
   */
  skipAuth?: boolean;

  /** 応答を待つ上限（ミリ秒）。既定は DEFAULT_TIMEOUT_MS。 */
  timeoutMs?: number;
};
```

- [ ] **Step 4: `apiRequest` に signal の合成と変換を入れる**

分割代入に `timeoutMs` を足す（`fetch` へそのまま渡さないため、`skipAuth` と
同じく取り除く）：

```ts
// 変更前
const { skipAuth, ...requestInit } = init ?? {};
// 変更後
const { skipAuth, timeoutMs = DEFAULT_TIMEOUT_MS, ...requestInit } = init ?? {};
```

`fetch` の呼び出しから `return` までを、次の形に差し替える（`if (token)` で
ヘッダを付ける行の**下**から）：

```ts
  if (token) headers.set("Authorization", `Bearer ${token}`);

  // 呼び出し側の signal と合成する。どちらか一方だけを fetch へ渡すと、
  // 7-3b のポーリングでどちらかが効かなくなる（timeout だけを渡せば
  // アンマウントで止められず、signal だけを渡せば無限に待つ）。
  // AbortSignal.any は先に中断したほうの reason をそのまま伝えるので、
  // 合成しても TimeoutError と AbortError の区別は失われない。
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = requestInit.signal
    ? AbortSignal.any([timeoutSignal, requestInit.signal])
    : timeoutSignal;

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, { ...requestInit, headers, signal });

    // Authorization を載せたリクエストが 401 を返した＝そのトークンが失効している。
    // 載せていないリクエストの 401 はログインの失敗（パスワード不一致）なので、
    // トークンを捨ててはいけない。Rails はどちらも 401 で返してくるため、
    // ステータスコードではなく「送信時に載せたか」で分ける。
    //
    // ここではリダイレクトしない。状態を落とすのは AuthProvider、
    // 画面遷移を決めるのは RequireAuth の仕事。認証不要ページで期限が切れても
    // ユーザーを画面から放り出さないため。
    //
    // 「今も同じトークンが入っているか」まで見るのは、token が送信時に
    // キャプチャした値だから。応答が返るまでの間に再ログインで別のトークンへ
    // 差し替わっていることがあり、そのとき古い 401 で新しいトークンを消すと、
    // ログイン成功直後に未ログインへ戻される（複数の API を並行で叩く
    // マイページで踏む）。
    if (response.status === 401 && token && tokenStore.get() === token) {
      tokenStore.clear();
    }

    const data = await parseBody(response);

    if (!response.ok) throw new ApiError(response.status, data);

    return { data: data as T, response };
  } catch (error) {
    // 中断のうち TimeoutError だけを変換する。呼び出し側のキャンセル
    // （AbortError）は失敗ではなく、文言を出す相手でもない。
    //
    // instanceof DOMException と書かないのは、DOMException をグローバルに
    // 持たない実行環境で ReferenceError になるため。DOMException は Error を
    // 継承しているので、この形なら環境に依存せず同じ結果になる。
    //
    // try が parseBody まで包んでいるのは、signal がボディのストリーム読み取りも
    // 中断するため。fetch だけを包むと、本文を読んでいる最中の中断を拾えない。
    // ApiError はここを素通りする。
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new ApiTimeoutError(timeoutMs);
    }
    throw error;
  }
}
```

`apiRequest` の JSDoc（`/** 低レベル。Response ごと返す。… */`）は変更しない。

- [ ] **Step 5: テストが通ることを確認する**

```bash
docker compose exec frontend npx vitest run test/lib/api.test.ts
```

Expected: PASS（`api.test.ts` が既存 15 件 ＋ 新規 4 件 = 19 件）。

- [ ] **Step 6: 型と lint を通す**

```bash
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run lint
```

Expected: どちらもエラーなし。

- [ ] **Step 7: コミット**

```bash
git add frontend/src/lib/api.ts frontend/test/lib/api.test.ts
git commit -m "$(cat <<'MSG'
feat: apiRequest に timeout を足す（既定 15 秒）

apiRequest は timeout も AbortSignal も持たず、応答が来るまで無限に待って
いた。Render の無料枠は約 15 分でスリープし、コールドスタートに約 1 分
かかるため、有効なトークンを持つ再訪ユーザーは GET /api/me が返るまで
status: "loading" に留まり、最大 1 分間ヘッダーがスケルトンのまま・
トップの CTA も出ない状態になっていた。

15 秒はコールドスタートを吸収しない値だが、あえてそうしている。60 秒
待たせるより、15 秒で unreachable に落として再試行・ログアウトを押せる
状態にするほうを採った。SiteHeader は既に unreachable の分岐を持って
いるので、AuthProvider も SiteHeader も変更していない。

呼び出し側の signal とは AbortSignal.any で合成する。7-3b のポーリングが
アンマウント時に自分でキャンセルするため、どちらか一方では足りない。
中断のうち TimeoutError だけを ApiTimeoutError に変換し、呼び出し側の
キャンセル（AbortError）はそのまま流す。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 3: タイムアウトの文言を足し、`unreachable` の文言を直す

**Files:**
- Modify: `frontend/src/lib/auth/error-messages.ts:7`（import）、`:41-43`（定数）、`:98-105`（分岐）
- Modify: `frontend/src/components/layout/site-header.tsx:82`
- Modify: `frontend/src/lib/auth/require-auth.tsx:42`
- Test: `frontend/test/lib/auth/error-messages.test.ts`

**Interfaces:**
- Consumes: Task 2 の `ApiTimeoutError`（`@/lib/api` から）
- Produces: なし（このタスクが最後の実装）

- [ ] **Step 1: 失敗するテストを書く**

`frontend/test/lib/auth/error-messages.test.ts` の import を差し替える：

```ts
import { ApiError, ApiTimeoutError } from "@/lib/api";
```

「fetch 自体の失敗（TypeError）を通信エラーとして扱う」の**直前**に足す
（通信断の隣に置くことで、2 つが別物であることが読んで分かる）：

```ts
  it("タイムアウトを通信断とは別の文言に翻訳する", () => {
    // Render のコールドスタート（約 60 秒）でここに来るのが最多になる。
    // そのとき回線は正常なので「通信環境を確認してください」は誤診になる。
    // ユーザーにできる正しい行動は「少し待って、もう一度」。
    const result = toAuthFormErrors(new ApiTimeoutError(15_000));

    expect(result.formError).toBe(
      "サーバーの応答がありません。起動中の可能性があるので、少し待ってから再度お試しください",
    );
    expect(result.fieldErrors).toEqual({});
  });
```

- [ ] **Step 2: テストが落ちることを確認する**

```bash
docker compose exec frontend npx vitest run test/lib/auth/error-messages.test.ts
```

Expected: FAIL。`ApiTimeoutError` は `ApiError` でも `TypeError` でもないので
末尾の分岐に落ち、`formError` が `"認証に失敗しました。時間をおいて再度お試しください"`
になる（**この issue が直そうとしている誤診そのもの**が、ここで実際に見える）。

- [ ] **Step 3: `error-messages.ts` に文言と分岐を足す**

import を差し替える：

```ts
import { ApiError, ApiTimeoutError } from "@/lib/api";
```

`NETWORK_MESSAGE` の**上**に定数を足す：

```ts
const TIMEOUT_MESSAGE =
  "サーバーの応答がありません。起動中の可能性があるので、少し待ってから再度お試しください";
const NETWORK_MESSAGE = "サーバーに接続できませんでした。通信環境を確認してください";
```

`toAuthFormErrors` の**先頭**に分岐を足す：

```ts
export function toAuthFormErrors(error: unknown): AuthFormErrors {
  // タイムアウトを通信断と分ける。abort の reject 値は DOMException で
  // TypeError ではないため、この分岐が無いと末尾に落ちて
  // 「認証に失敗しました」になる。パスワードは正しいのに、訂正しようの
  // ない誤診を出すことになる。
  if (error instanceof ApiTimeoutError) {
    return { formError: TIMEOUT_MESSAGE, fieldErrors: {} };
  }

  if (error instanceof ApiError) {
```

- [ ] **Step 4: テストが通ることを確認する**

```bash
docker compose exec frontend npx vitest run test/lib/auth/error-messages.test.ts
```

Expected: PASS（`error-messages.test.ts` が既存 7 件 ＋ 新規 1 件 = 8 件）。

- [ ] **Step 5: `unreachable` の文言を 2 箇所直す**

`frontend/src/components/layout/site-header.tsx`：

```tsx
// 変更前
<span className="text-ink-muted">サーバーに接続できません</span>
// 変更後
<span className="text-ink-muted">サーバーの応答がありません</span>
```

`frontend/src/lib/auth/require-auth.tsx`：

```tsx
// 変更前
<p className="text-ink-muted">サーバーに接続できませんでした。</p>
// 変更後
<p className="text-ink-muted">サーバーの応答がありません。</p>
```

`site-header.tsx` の `unreachable` ブロックの先頭コメント（`unreachable で
「ログイン」を出さないのが要点。…`）の末尾に 1 文足す：

```tsx
            この状態には timeout 経由で来るのが最多になる（Render のコールド
            スタート）。文言を「接続できません」から「応答がありません」に
            寄せてあるのはそのため。通信断の場合にも当てはまるので、
            経路ごとの出し分けはしない（unreachable は理由を持っていない）。
```

- [ ] **Step 6: 全テスト・型・lint を通す**

```bash
docker compose exec frontend npm test
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run lint
```

Expected: 3 つとも PASS（テストは合計 76 件）。

- [ ] **Step 7: コミット**

```bash
git add frontend/src/lib/auth/error-messages.ts frontend/test/lib/auth/error-messages.test.ts frontend/src/components/layout/site-header.tsx frontend/src/lib/auth/require-auth.tsx
git commit -m "$(cat <<'MSG'
feat: タイムアウトを通信断と区別した文言にする

abort の reject 値は DOMException（name: "TimeoutError"）で TypeError では
ないため、error-messages.ts の末尾に落ちて「認証に失敗しました」になって
いた。コールドスタート中にログインした人に、パスワードは正しいのに訂正
しようのない誤診を出すことになる。

回線は正常なので「通信環境を確認してください」も誤診になる。ユーザーに
できる正しい行動は「少し待って、もう一度」なので、文言はそれを言う。

あわせて unreachable の文言 2 箇所も「接続できません」から「応答が
ありません」に寄せた。この状態には timeout 経由で来るのが最多になるが、
通信断の場合にも当てはまる表現なので、経路ごとの出し分けはしない
（unreachable は理由を持っていない。区別は 7-2.6 の範囲）。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
)"
```

---

### Task 4: 実物で確認し、レビューを通して PR を出す

**Files:** なし（確認のみ。指摘が出たら該当タスクのファイルを直す）

**Interfaces:**
- Consumes: Task 1・2・3 のすべて
- Produces: PR

- [ ] **Step 1: 起動して、backend を「宙吊り」にする**

```bash
docker compose up -d
docker compose pause backend
```

**`stop` ではなく `pause` を使うこと（2026-09-22 実測で判明）。** `stop` は
listen ソケットごと消えるので接続が即座に拒否され、`fetch` は TypeError で
**すぐに**失敗する。それは従来からある通信断の経路であって、**timeout の経路を
1 ミリ秒も通らない**。`pause` は cgroup でプロセスを凍結するだけなので listen
ソケットが残り、カーネルが TCP 接続を受けたまま応答が返らない ——
Render のコールドスタートと同じ形になる。

実測での裏取り：`pause` した backend に対して `AbortSignal.any([AbortSignal.timeout(15000), controller.signal])`
付きの `fetch` を投げると、**15.0 秒後に `name: "TimeoutError"`** で reject した。
スタブではなく本物の宙吊り接続でも、ユニットテストが前提にしている形と
同じになる。

- [ ] **Step 2: ログイン済みの状態で 15 秒の挙動を見る**

前提：ブラウザの localStorage に有効なトークンが入っていること
（`kotoe.auth.token`）。**トークンが無いと `/api/me` を投げないので、この確認は
成立しない。** 入っていなければ、先に `docker compose unpause backend` して
ログインしてから `docker compose pause backend` し直す。

`http://localhost:3001/` をリロードし、次を確認する：

| 確認すること | 期待 |
|---|---|
| ヘッダーの初期表示 | スケルトン（灰色のバー） |
| **15 秒後** | 「サーバーの応答がありません」＋「再試行」＋「ログアウト」 |
| それ以上待っても変わらないこと | 1 分待っても同じ（無限に待たない） |

- [ ] **Step 3: ログインフォームの文言を見る**

backend を pause したまま `http://localhost:3001/login` を開き、適当な値で送信する。

Expected: 15 秒後に「**サーバーの応答がありません。起動中の可能性があるので、
少し待ってから再度お試しください**」が出る。「認証に失敗しました」や
「通信環境を確認してください」が出たら実装が誤っている。

- [ ] **Step 4: 復帰を確認する**

```bash
docker compose unpause backend
```

ヘッダーの「再試行」を押し、ユーザー名が表示される状態に戻ること。

- [ ] **Step 5: ボタンの見た目を通しで見る**

`/`・`/login`・`/signup` を、未ログインとログイン済みの両方で開く。
Task 1 Step 11 で見た内容に加え、HealthPanel のトースト確認ボタン 2 つが
他のボタンと揃っていることを見る。

- [ ] **Step 6: コードレビューを通す**

```
/code-review
```

指摘は `superpowers:receiving-code-review` の手順で扱う。**自己レビューでは
自分の前提を疑えない**ため、push の前に必ず挟む。

- [ ] **Step 7: push して PR を出す**

```bash
git push -u origin feat/frontend-groundwork
gh pr create --title "7-2.7. フロントエンドの前提整備（timeout・ボタンの共通化）" --body "$(cat <<'MSG'
`docs/issues_backlog.md` 7-2.7。7-3a / 7-3b が乗る足場を敷く回で、**画面（ルート）は 1 つも作らない**。

設計書：`docs/superpowers/specs/2026-09-22-issue-7-2-7-frontend-groundwork-design.md`

## 何が変わるか

- `apiRequest` が無限に待つのをやめ、**既定 15 秒**で `ApiTimeoutError` になる
- タイムアウトが通信断と区別された文言になる（今は「認証に失敗しました」に落ちる）
- 主ボタンのクラス列 11 箇所が `buttonClasses()` 経由になる

## なぜ 15 秒か（コールドスタートは約 60 秒なのに）

あえて吸収していない。60 秒に合わせると「1 回で成功する代わりに最大 60 秒無言で待つ」ことになり、7-2 の申し送り 1（押せるものがロゴだけ）がほぼそのまま残る。15 秒で `unreachable` に落とせば、`SiteHeader` が既に持っている再試行・ログアウトが出るので、待つか抜けるかをユーザーが選べる。`AuthProvider` も `SiteHeader` も変更していない。

## 見た目が変わる箇所

`font-medium` を共通に置いたので、**ヘッダー 3 箇所（ログアウト・再試行・ログアウト）と HealthPanel 2 箇所がわずかに太くなる**。primary にだけ入れるとヒーローで隣り合う「新規登録」と「ログイン」が別の太さになるため、揃えるほうを採った。

## 確認したこと

- backend を pause した状態で 15 秒後にヘッダーが `unreachable` に変わる
- その状態のログインフォームが「サーバーの応答がありません。起動中の…」を出す
- backend を戻して「再試行」でログイン状態に復帰する
- `npm test`（77 件）／ `npm run lint` ／ `npx tsc --noEmit` が green

## 依存

**先に `docs/split-issue-7-3` をマージしてください。** backlog 側の 7-2.7 の項はそちらに入っています。

Closes #113

🤖 Generated with [Claude Code](https://claude.com/claude-code)
MSG
)"
```

- [ ] **Step 8: Vercel のプレビュー URL で見る**

CLAUDE.md「動作確認・デプロイの進め方」②。PR に付くプレビュー URL を開き、
ボタンの見た目が崩れていないことを確認する。**プレビューは本番の backend
（Render）を向いている**ので、スリープしていれば Step 2 と同じ状態が実物で
再現する。そこで 15 秒後に再試行ボタンが出れば、この issue の目的が本番相当の
環境で達成できている。

---

## Self-Review（記入済み）

**1. Spec coverage**

| 設計書の節 | 実装するタスク |
|---|---|
| 決定 1（既定 15 秒・上書き可） | Task 2 Step 3・4、テスト 2 件 |
| 決定 2（`signal` の合成） | Task 2 Step 4、テスト 2 件 |
| 決定 3（`ApiTimeoutError`） | Task 2 Step 3 |
| 決定 4（文言を分ける・`unreachable` 2 箇所） | Task 3 Step 3・5 |
| 決定 5（`buttonClasses`・size に文字サイズを持たせない） | Task 1 Step 1 |
| 決定 6（`font-medium` を共通に） | Task 1 Step 1、確認は Step 11 |
| テスト（api 4 件・文言 1 件・buttonClasses は書かない） | Task 2 Step 1、Task 3 Step 1 |
| 動作確認 4 項目 | Task 4 Step 2〜5 |
| 作らないもの（ナビ・CTA・RequireAuth のページ・リトライ） | Global Constraints に明記 |

**2. Placeholder scan**：なし。すべてのコード片は貼って動く形で書いてある。

**3. Type consistency**

- `buttonClasses({ variant, size })` … Task 1 の定義と、Step 3〜8 の 11 箇所の
  呼び出しで引数名・値が一致している
- `ApiTimeoutError` … Task 2 で `readonly timeoutMs` を持つ形で定義し、
  Task 2 のテストが `timeoutMs: 20`、Task 3 が `new ApiTimeoutError(15_000)` で使う
- `DEFAULT_TIMEOUT_MS` … Task 2 の中だけで使う（エクスポートしない）。
  テストは値を直接は読まず、`AbortSignal.timeout` の引数で確認する
- 文言 `"サーバーの応答がありません。起動中の可能性があるので、少し待ってから再度お試しください"`
  … Task 3 Step 1（テスト）と Step 3（実装）と Task 4 Step 3（手動確認）で同一
