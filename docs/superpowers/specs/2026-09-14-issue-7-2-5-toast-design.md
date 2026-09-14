# issue 7-2.5 フラッシュメッセージ（トースト）の共通部品 設計

- 対象 issue：`docs/issues_backlog.md` 7-2.5（GitHub #104）
- 依存：7-2（デザイントークンと共通レイアウト）
- 作成日：2026-09-14
- 前提：`docs/superpowers/specs/2026-09-07-issue-7-2-layout-auth-screens-design.md`（デザイントークン、`TextField` のエラー表示、`SHOW_HEALTH_PANEL` の出し分け）
- 前提：CLAUDE.md「メッセージ・エラー・i18n の責務」（フラッシュメッセージはフロントの責務。Rails の `flash` は使わない）

## この issue で作るもの

**画面遷移を伴わない操作の結果**をユーザーに伝える共通部品。CLAUDE.md が 0-2 の時点から定めている「フロントがトーストを出す」を、実際に置く場所として作る。

- React を知らないトーストのストア（キュー管理・自動消去）
- それを購読して描画するビューポート（ルートレイアウトに 1 つ）
- 呼び出し口 `toast.success(...)` / `toast.error(...)`

バックエンドは一切変更しない。**依存パッケージも追加しない**。変更はすべて `frontend/` に閉じる。

消費する予定の issue：7-3（保存した／生成を開始した／生成に失敗した）、7-4（通報しました）、7-5（お題を投稿しました）、7-6（削除しました）、7-2.6（セッション失効）。

## 7-3 の前に置く理由

7-3 の描写入力には「保存」（下書き作成）があり、**押しても画面が変わらない**。通知が無いと保存されたか分からず、ドメインの必守ルール（「保存」＝下書き／「画像を生成」＝ジョブ起動の 2 ボタン）の片方が無反応に見える。

## 決めたこと

### 1. 依存を足さず自前で書く

`issues_backlog` の「先に決めること 1」。候補を実測した。

| | min+gzip | 依存 | CSS の入り方 |
|---|---|---|---|
| `sonner@2.0.8` | 9.4 KB | 0 | JS 内に CSS 文字列を持ち、`document.createElement("style")` で実行時に head へ注入 |
| `react-hot-toast@2.6.0` | 約 5.2 KB（本体 3.9 ＋ goober 1.3） | goober / csstype | goober（ランタイム CSS-in-JS）が同じく `<style>` を実行時注入 |
| 自前 | 約 1 KB 相当 | 0 | Tailwind ユーティリティ ＋ `globals.css` に `@keyframes` 数行 |

サイズ差（4〜9 KB）は決め手にならない。自前を選ぶ理由は次の 3 つ。

**(a) CSP（issue 8-5）を先に削らない。** 両ライブラリとも実行時に `<style>` 要素を挿入するため、8-5 で `style-src 'unsafe-inline'` を開けることになる。CLAUDE.md は「トークンを `localStorage` に置いており、XSS を踏めば盗まれる前提。第二の防御としての CSP は issue 8-5」と書いている。ここで `unsafe-inline` 前提のライブラリを入れると、その第二の防御を実装前に削ることになる。nonce を受け取る口は両者とも無い。

**(b) デザイントークンの二重管理を避ける。** 7-2 で `bg-surface` / `border-line` / `rounded-card` / `text-danger` / `text-accent` を決めた。ライブラリはそれぞれ独自の CSS 変数系を持つので、同じ色を 2 箇所で定義することになる。

**(c) 7-2 の判断と揃う。** 7-2 はフォームで依存を足さない判断をしている。トーストは自前で書く量が多い（ポータル・スタック・自動消去・アニメーション）ので同じ結論になるとは限らないが、下の「作らないもの」で機能を削った結果、実装量は 3 ファイル・180 行程度に収まる。

**代償**：スワイプで消す、スタックの折り畳みアニメーション、promise トーストは持たない。Kotoe の用途（「保存しました」1 行）には要らないと判断した。

> **2026-09-14 改訂**：当初はホバーでの一時停止も持たない判断だったが、コードレビューの指摘を受けて入れた（下記 8）。

### 2. 種別は `success` / `error` の 2 つ

`issues_backlog` の「先に決めること 2」。消費予定の issue が実際に出す文言を並べると、必要なのはこの 2 つだけだった。

| issue | 出す通知 | 種別 |
|---|---|---|
| 7-3 | 「下書きを保存しました」「画像の生成を開始しました」 | success |
| 7-3 | 生成失敗（`failed`） | error |
| 7-4 | 「通報しました」 | success |
| 7-5 | 「お題を投稿しました」 | success |
| 7-6 | 「削除しました」 | success |
| 7-2.6 | 「セッションの有効期限が切れました」 | error |

`info` は「どの issue が使うか」が今言えないので作らない。後から足すのはユニオン型に 1 語とスタイル 1 行。

**種別は色だけで区別しない。** 色覚特性のあるユーザーに緑と赤の判別を要求しないため、アイコンと読み上げ用の接頭辞を併せて持つ（上記 6）。

### 3. 表示は最大 3 件。同じ文言の連打は抑制しない

`issues_backlog` のタスク「同じメッセージの連打を抑制するか決める」。**抑制しない**。4 件目が来たら 1 件を押し出す。

> **2026-09-14 改訂**：押し出す対象を「最も古いもの」から「**最も早く消えるもの**」に変えた（下記 9）。寿命が同じもの同士では最古になるので、この節の趣旨は変わらない。

理由は読み上げにある。`aria-live` は「DOM のテキストが変化したこと」で読み上げるため、**同じ文言を 1 件に統合して置き換える方式だと、2 回目以降はテキストが変わらず無音になる**。画面には見えているのに読み上げ環境には存在しない、という状態は、この issue のタスク（スクリーンリーダーへの通知）が避けたいものそのものである。

積み上げ方式なら新しいノードが増えるので確実に読まれる。3 回保存したなら 3 回通知するのは事実にも忠実で、キュー管理も「追加して上限で切る」だけになりテストしやすい。抑制は必要と分かってから足せる。

### 4. ストアは React の外に置く（`useSyncExternalStore` で購読）

トーストの一覧をモジュールスコープのオブジェクトに持ち、ビューポートが `useSyncExternalStore` で購読する。**このリポジトリの `tokenStore`（`src/lib/auth/token-store.ts`）と同型**で、`auth-context.tsx` が既に同じ形で購読している。

React Context ＋ `useReducer` にしなかった理由は 2 つ。

**(a) React の外から呼べる。** 7-2.6（セッション失効）は `api.ts` が 401 を検知する場所で通知を出したくなる。`api.ts` は React ではないので、Context だとそこから呼べず、通知の仕組みをもう一つ作ることになる。ストアにしておけば 7-2.6 の選択肢が狭まらない（**何を通知するかは 7-2.6 で決める。本 issue では呼ばない**）。

**(b) キュー管理が React 非依存の純粋ロジックになる。** CLAUDE.md の「純粋なロジックが切り出せたら Vitest」に直接乗り、レンダリング抜きで検証できる。Context に閉じるとテストにコンポーネントのレンダリングが要り、CLAUDE.md が「MVP では入れない」としている React Testing Library に近づく。

**弱点と対処**：モジュールスコープの可変状態なので、理屈上はサーバーでリクエスト間を跨ぐ。`tokenStore` と同じく `getServerSnapshot()` を空配列固定にし、`toast.*` はイベントハンドラ／effect からしか呼ばれない（＝ `"use client"` 境界の内側でしか実行されない）ことで塞ぐ。

### 5. 自動消去のタイマーはストアが持つ

`toast.success()` した時点でストアが `setTimeout` を張る。ビューポート側に `useEffect` で置く設計もあるが、ストアに寄せると**この機能のロジックが 1 ファイルに閉じ、`vi.useFakeTimers()` だけでレンダリング抜きに全部テストできる**。ビューポートは配列を並べるだけの部品になる。

表示時間は種別で変える。

| 種別 | 表示時間 |
|---|---|
| `success` | 4 秒 |
| `error` | 8 秒 |

`error` を長くするのは、失敗は読んで判断する必要がある（「生成に失敗しました」→ もう一度押すか決める）のに対し、成功は認識するだけで済むため。同じ 4 秒だと失敗の文面を読み切る前に消える。どちらも手動で閉じられる。

### 6. ライブリージョンは空でも DOM に居続ける

ライブリージョンは `<ol>` ではなく**外側の `<div>` に置く**。`role` を明示すると要素本来のロールが置き換わるため、`<ol role="status">` は list でなくなり、中の `<li>` が list を持たない listitem として浮く（ARIA の required context 違反）。アクセシビリティツリーで確認した挙動は次のとおり。

```
<ol role="status">        → status > listitem, listitem   （list が消える）
<div role="status"><ol>   → status > list > listitem      （正しい）
```

そのうえで、ビューポートは `toasts.length === 0` のときも描き続ける。スクリーンリーダーはライブリージョンを DOM に見つけた時点で監視を始めるため、**リージョンと中身が同時に現れると読み上げを取りこぼす**。

`role="status"` に加えて **`aria-atomic="false"` を明示する**。`role="status"` の `aria-atomic` の既定値は `true` で、そのままだと 2 件目が出たときに領域全体（＝ 1 件目も含めて）読み直される。3 件スタックを選んだ以上ここは効く。

### 7. フォームのバリデーションエラーはトーストで出さない

`issues_backlog` が「7-2 のフォームエラーとは別物。兼用しないこと」と釘を刺している箇所。種別に `error` を持たせると兼用したくなるので、線を明文化する。

| | 置き場所と寿命 | 担当 |
|---|---|---|
| フォームのエラー | 入力欄の直下に**留まる** | 7-2 の `TextField` の `error` prop |
| フラッシュメッセージ | 画面の隅に出て**自動で消える** | 本 issue |

**判定基準：入力を直すために読む必要があるものは、数秒で消える場所に置かない。**

### 8. 触れている間は自動消去を止める（2026-09-14 追加）

当初は「ホバーで一時停止」を作らない判断だったが、コードレビューで**フォーカスを持つ要素が消える**問題が指摘され、実機で確認した結果これを入れた。

閉じるボタンにフォーカスした状態で自動消去が走ると、`<li>` ごと DOM から消えるため `document.activeElement` が `<body>` に落ちる（実測で確認）。キーボード操作の人は次の Tab でページ先頭からやり直しになる。マウスでも、「×」に手を伸ばしている途中で消えるとクリックが背後のページに落ちる（7-3 のお題一覧なら意図しない遷移になる）。

「出るときにフォーカスを奪わない」（上記 6 の実装方針）と「**消えるときにフォーカスを壊さない**」は別の問題で、当初の設計は前者しか押さえていなかった。

止める仕組みを 1 つ作れば、マウスとキーボードの両方に同じものを繋げる。ストアに `pause(id)` / `resume(id)` を足し、ビューポートが `mouseenter` / `mouseleave` / `focus` / `blur` の 4 つで呼ぶ。**再開時に経過した分は戻さない**（離れるたびに寿命が延びると隅に居座り続ける）。

4 つのイベントが同じ判定関数を通るのが要点。片方のイベントだけで `pause` / `resume` を決めると、マウスとキーボードが同時に関わるとき（フォーカスしたままマウスを外す等）に片方の解除でもう片方を無視する。毎回 2 つの条件（ホバー・フォーカス）を見て決める。

**ホバーの状態は `matches(":hover")` で読まず、イベントから受け取る。** `mouseleave` の中で `:hover` を読むと、ブラウザがホバー状態を境界イベントより先に更新するかどうかに依存する（タッチ端末の sticky hover では、タップした要素が次のタップまで `:hover` を保持する）。**読み違えたときの被害が非対称**なのが理由で、

| 誤判定 | 結果 |
|---|---|
| 触れているのに `pause` しない | タイマーが進むだけ。次のイベントで自然に直る |
| 離れたのに `resume` しない | **そのトーストが永久に消えない。** ストアに寿命の上限は無く、`×` を押す以外に戻す手段が無い |

`mouseenter` / `mouseleave` はそれ自体が「入った」「出た」を確定させているので、そちらを信じる（`hovered` を `true` / `false` で渡す）。`focus` / `blur` ではホバーの状態が分からないので `:hover` を読むが、そこで読み違えても後から来る `mouseleave` が `hovered=false` で確定させるため戻れる。

### 9. 押し出すのは「最も早く消えるもの」（2026-09-14 改訂）

最古を押し出すと、**`error` に 8 秒を与えた意味が消える**。`error` を出した直後に `success` を 3 回出すと、`error` は 3 秒ほどで押し出されて読めない（実測で確認）。7-3 は「保存」と「画像を生成」が隣り合うので、8 秒以内に 3 回押すのは普通の操作になる。

残り時間が最も短いものを捨てる。寿命が同じもの同士では最も古いものになるので、これまでの「最古を押し出す」を包含する。

候補から外すものが 2 つある。

**(a) いま追加したもの。** 寿命の短い新着（`success` 4 秒）が寿命の長い既存（`error` 8 秒）に負けて即座に消えると、直前の操作への反応が出ないままになり、この機能の目的そのものを損なう。

**(b) 一時停止中のもの（上記 8）。** 止めているのは触れている間だけで、そこで捨てると「手の下で消える」ことになり、**押し出しが `pause` を打ち消す**。しかも止めた瞬間の残り時間が小さいトーストほど真っ先に捨てられるので、実際に起きる。`remainingMs()` は停止中に `Number.POSITIVE_INFINITY` を返す（タイマーを持たないものと同じ扱い）。候補がすべて停止中でも、比較が `<` なので victim は最古に落ち着き、退化しない。

## 実装の構え

### 追加するファイル

```
frontend/src/lib/toast/toast-store.ts          ← React を知らないストア
frontend/src/components/ui/toast-viewport.tsx  ← "use client"。購読して描画
frontend/test/lib/toast/toast-store.test.ts    ← Vitest（node 環境）
```

`lib/toast/` とディレクトリを切るのは `lib/auth/` に揃えるため（`lib/api.ts` は単独ファイルだが、7-2.6 でエラーコード → トースト文言の対応表が隣に来る見込みがある）。

### `toast-store.ts`

```ts
export type ToastType = "success" | "error";
export type Toast = { id: number; type: ToastType; message: string };

const MAX_VISIBLE = 3;
const DURATION_MS: Record<ToastType, number> = { success: 4000, error: 8000 };

// 呼ぶ側（各画面。7-2.6 以降は api.ts も）
export const toast = {
  success(message: string): void;
  error(message: string): void;
  dismiss(id: number): void;
  // 以下 2 つは ToastViewport がホバー／フォーカスの出入りで呼ぶ（上記 8）
  pause(id: number): void;
  resume(id: number): void;
};

// 描く側（ToastViewport だけが使う）
export const toastStore = {
  subscribe(listener: () => void): () => void;
  get(): readonly Toast[];
  getServerSnapshot(): readonly Toast[];
};
```

`tokenStore` と同じく、**どのメソッドも `this` を使わない**。呼び出し側が `useSyncExternalStore(toastStore.subscribe, toastStore.get, ...)` のようにメソッドを関数として切り離して渡すため、`this` を書いた瞬間に壊れる。

**`get()` は参照を安定させる。** `useSyncExternalStore` は戻り値を `Object.is` で比較するので、毎回新しい配列を返すと無限再レンダリングになる。`tokenStore` は戻り値が文字列なのでこの問題が無いが、配列では踏む。

```ts
const EMPTY: readonly Toast[] = [];
let toasts: readonly Toast[] = EMPTY;   // 変更時だけ新しい配列に差し替える
function get() { return toasts; }        // ← 同じ参照を返す
```

`getServerSnapshot()` も同じ `EMPTY` 定数を返す（`[]` リテラルを毎回作ると同じ罠にかかる）。

**タイマーは残り時間つきで持つ。** 一時停止（上記 8）と、押し出す対象の選定（上記 9）の両方が残り時間を要求する。

```ts
type TimerState =
  | { running: true; handle: ReturnType<typeof setTimeout>; expiresAt: number }
  | { running: false; remainingMs: number };

const timers = new Map<number, TimerState>();
```

判別可能な共用体にするのは、`running` の真偽と `expiresAt` の有無が必ず一致することを型で保証するため（`expiresAt!` の非 null アサーションを書かずに済む）。

`clearTimeout` するのは次の 3 箇所で、**すべて必要**。

1. 手動で閉じたとき
2. 4 件目に押し出されたとき
3. `pause()` したとき

2 を忘れると、既に消えた通知のタイマーが数秒後に発火して無関係な id を消しにいく。**このとき配列の見た目は正しいままなので、配列を検査するテストでは気づけない**（だからテストは動いているタイマーの本数を見る）。

### `toast-viewport.tsx`

```tsx
"use client";

export function ToastViewport() {
  const toasts = useSyncExternalStore(
    toastStore.subscribe,
    toastStore.get,
    toastStore.getServerSnapshot,
  );

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50"
    >
      <ol className="flex flex-col gap-2 sm:ml-auto sm:w-96">
        {toasts.map((t) => (
          <li
            key={t.id}
            onMouseEnter={(e) => handleEngagement(e, t.id, true)}
            onMouseLeave={(e) => handleEngagement(e, t.id, false)}
            onFocus={(e) => handleEngagement(e, t.id, e.currentTarget.matches(":hover"))}
            onBlur={(e) => handleEngagement(e, t.id, e.currentTarget.matches(":hover"))}
            className="pointer-events-auto ..."
          >...</li>
        ))}
      </ol>
    </div>
  );
}

// 上記 8。ホバーの状態はイベントから受け取り、:hover を読まない。
function handleEngagement(
  event: SyntheticEvent<HTMLLIElement>,
  id: number,
  hovered: boolean,
): void {
  const engaged = hovered || event.currentTarget.contains(document.activeElement);

  if (engaged) toast.pause(id);
  else toast.resume(id);
}
```

**ライブリージョンは外側の `<div>`。** 理由は上記 6。位置指定も `<div>` に持たせ、`<ol>` は `sm:ml-auto sm:w-96` で右へ寄せる（`sm` 未満では親いっぱいに広がる）。

**`createPortal` は使わない。** ポータルが要るのは祖先に `transform` / `filter` / `contain` があって `position: fixed` の基準がずれる場合だが、`<body class="flex min-h-full flex-col">` にも `SiteHeader` / `SiteFooter` にもそれらは無いので `fixed` がビューポート基準で効く。ポータルを足すと SSR とハイドレーションの整合を自前で面倒みることになる。

**コンテナに `pointer-events-none`、個々のトーストに `pointer-events-auto`。** 上記 6 の通りこの領域は空のときも DOM に居続けるため、これが無いと画面右下が常時クリック不能になる。

各トーストが持つもの：

- アイコン（インライン SVG・`aria-hidden="true"`）。`success` は `text-accent`、`error` は `text-danger`
- `<span className="sr-only">` の接頭辞「成功：」／「エラー：」。**読み上げ環境ではこれが唯一の種別の手がかり**になる
- 本文
- 閉じるボタン（`aria-label="通知を閉じる"`、`onClick={() => toast.dismiss(t.id)}`）

**フォーカスは奪わない。** トーストが出た瞬間に入力欄からフォーカスが飛ぶと、7-3 で描写文を書いている最中に操作不能になる。**壊しもしない**（上記 8）。

トーストの文言はすべてフロントの辞書（固定文字列）で UGC は入らない。`{message}` と普通に書くので `whitespace-pre-wrap` も `dangerouslySetInnerHTML` も不要。

### 色

`globals.css` に **success 相当のトークンが無い**。新しく `--color-success` を足さず、成功のアイコンには既存の `--color-accent`（青緑・白との比 5.47:1）を使う。トークンを 1 つ増やすより、デザインブリーフ 0 の「アクセントカラー 1 色」の方針に沿うため。エラーは既存の `--color-danger`。カード面は `bg-surface` / `border-line` / `rounded-card`。

**`dark:` は書かない**（7-2 の決定）。

### アニメーション

`globals.css` に入場のキーフレームを足す（下から `0.5rem`・150ms・フェード）。`prefers-reduced-motion: reduce` で無効化する。

**退場アニメーションは作らない。** 消えるときにフェードさせるには「消える途中」という状態をストアに足し、実際の削除を遅らせる必要がある。上記 5 で「ロジックは全部ストアに閉じてテストできる」と決めた設計に、見た目のためだけの状態が 1 つ増える。パッと消えるのは許容し、必要になったら足す。

## テスト

### Vitest（`test/lib/toast/toast-store.test.ts`）

ファイル先頭に `// @vitest-environment node`。ストアは DOM を触らないので jsdom は不要（`vitest.config.mts` のコメントが定めている切り替え方に沿う）。タイマーは `vi.useFakeTimers()`。

モジュールスコープの状態はテスト間で持ち越されるので、`token-store.test.ts` と同じく `beforeEach` で初期化する。テスト専用の export は足さず、公開 API だけで戻せる。

```ts
beforeEach(() => {
  vi.useFakeTimers();
  for (const t of toastStore.get()) toast.dismiss(t.id);
});
```

書くケース：

1. `success` / `error` で `type` が付く
2. **4 件目で最古が押し出され、残り 3 件は投入順で並ぶ**
3. `success` は 4 秒、`error` は 8 秒で自動消去される
4. **押し出されたトーストのタイマーが、後から別のトーストを消しにこない**
5. `dismiss(id)` はその 1 件だけ消し、他は残る
6. `get()` は変化が無ければ同じ参照を返す
7. `getServerSnapshot()` は毎回同じ参照を返す
8. `subscribe` した listener が 追加 / 手動削除 / 自動消去 で呼ばれ、`unsubscribe` 後は呼ばれない
9. `pause()` すると自動消去が止まる
10. `resume()` は `pause()` した時点の残り時間から再開する（経過した分は戻らない）
11. **上限を超えたとき、最も早く消えるものを捨てる**（`error` が `success` 3 件に押し出されない）
12. **いま追加したトーストは押し出しの候補にしない**

13. **一時停止中のトーストは押し出しの候補にしない**

11 と 12 は対になっている。11 だけを実装すると、寿命の短い新着（`success` 4 秒）が寿命の長い既存（`error` 8 秒）に負けて即座に消える。12 はその退化を止めるためのテストで、2 番（寿命が同じもの同士は最古が消える）とも両立する。

**2 番は投入順と五十音順をわざと逆相関させる。** `"あ" → "い" → "う" → "え"` のように一致する文言を使うと、実装がうっかりソートしていてもテストが通る。`"ぬま" → "たき" → "そら" → "かぜ"` のように逆相関させて 4 件投入し、**残った 3 件が `["たき", "そら", "かぜ"]` と完全一致すること**を検証する（6-1 で「green なのに何も守っていない」並び順テストを 4 件作った前例がある）。

**4 番は 2 番の変異を殺すためのケース。** 押し出し時に `clearTimeout` を忘れても、2 番のテストだけなら通ってしまう（その瞬間の配列は正しいため）。押し出し後に時間を進めて、無関係なトーストが生き残っていることを確かめる。

`ToastViewport` のコンポーネントテストは書かない（CLAUDE.md のテスト方針）。ブラウザでの確認と、7-3 以降の E2E が担当する。

### ブラウザでの確認

**7-3 が来るまで呼び出し元が存在しない。**「実装したが画面で一度も出していない」状態で PR を出すことになるため、確認手段を用意する。

`src/components/dev/health-panel.tsx` に「成功トースト」「エラートースト」を出すボタンを 2 つ足す。`HealthPanel` は `src/app/page.tsx` の

```ts
const SHOW_HEALTH_PANEL =
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview" || process.env.NODE_ENV !== "production";
```

で出し分けられているので、**ローカルと Vercel プレビューでだけ描画され、本番には出ない**。7-1 の申し送りにある「本番トップに認証パネルが公開されていた」事故はこの出し分けを通さなかったことが原因なので、同じ轍は踏まない。新しいデバッグ用ページは作らない。

`HealthPanel` を選ぶのは、そこが既に「CLAUDE.md の②（PR ごとにプレビュー URL で確認する）を支える箱」として残されているため。

確認する内容：

- 1 件出て、4 秒（error は 8 秒）で消える
- 連打して 4 件目で最古が押し出される
- **トーストにマウスを乗せている間は消えない。外すと続きから消える**（上記 8）
- **スマートフォンでトーストをタップしたあと、別の場所をタップすると消える**（タッチ端末の sticky hover で `:hover` が残り、止まったままにならないこと）
- **閉じるボタンに Tab でフォーカスしたまま放置しても消えない**（同上）
- 閉じるボタンで消える
- トーストが出ている間も背後のリンク・ボタンが押せる（`pointer-events` の確認）
- モバイル幅（〜400px）で左右いっぱいに出て、横スクロールが出ない

## 変更するファイル

| ファイル | 変更 |
|---|---|
| `frontend/src/lib/toast/toast-store.ts` | 新規 |
| `frontend/src/components/ui/toast-viewport.tsx` | 新規 |
| `frontend/test/lib/toast/toast-store.test.ts` | 新規 |
| `frontend/src/app/layout.tsx` | `<ToastViewport />` を 1 行 |
| `frontend/src/app/globals.css` | `@keyframes` と reduced-motion で 10 行程度 |
| `frontend/src/components/dev/health-panel.tsx` | 確認用ボタン 2 つ |
| `docs/issues_backlog.md` | 7-2.5 のタスクのチェックを埋める |

`backend/` と `frontend/package.json` は変更しない。

## 完了条件

- 画面遷移を伴わない操作の後に通知が出て、数秒で消える
- 手動で閉じられる
- スクリーンリーダーに読み上げられる（`role="status"` / `aria-live="polite"` / `aria-atomic="false"`、種別は `sr-only` の接頭辞で伝わる）
- 7-3 が `toast.success("下書きを保存しました")` の 1 行で使える
- `npm run test` と `npm run lint` が通る

## この issue で作らないもの

- 退場アニメーション、スワイプで消す、promise トースト、位置の切り替え、`info` 種別
  （ホバーでの一時停止は当初ここにあったが、上記 8 で入れることにした）
- フォームのバリデーションエラーをトーストで出すこと（上記 7）
- **7-2.6（セッション失効）そのもの。** `api.ts` から `toast.error()` を呼べる形にはしておくが、本 issue では呼ばない。何をいつ通知するかは 7-2.6 で決める（`issues_backlog` が brainstorming を通すよう指示している）
- CSP の導入（issue 8-5）。本 issue は「`unsafe-inline` を必要としない実装を選ぶ」ところまで
