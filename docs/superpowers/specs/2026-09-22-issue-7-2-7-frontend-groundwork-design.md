# issue 7-2.7 フロントエンドの前提整備（timeout・ボタンの共通化） 設計

- 対象 issue：`docs/issues_backlog.md` 7-2.7（GitHub #113。#24「7-3」を割った 1 つ目）
- 依存：7-1（`apiRequest`）、7-2（デザイントークンと共通レイアウト）
- 作成日：2026-09-22
- 前提：`frontend/AGENTS.md`（Next 16.2.10 の API は型定義とコンパイル済み実装を直接読む）
- 前提：CLAUDE.md「メッセージ・エラー・i18n の責務」（文言はフロントに集約する）
- 前提：CLAUDE.md「テスト戦略」（フロントは純粋ロジックにだけ Vitest）

## この issue で作るもの

**7-3a / 7-3b が乗る足場**。画面は 1 つも作らない。7-1・7-2 の申し送りのうち、
新しいルートを作らずに片づくものだけを集めてある。

1. `apiRequest` の timeout（既定 15 秒・呼び出し側で上書き可・呼び出し側の `AbortSignal` と合成）
2. `ApiTimeoutError` と、通信断とは区別された専用文言
3. 主ボタンのクラス列を `buttonClasses()` に集約（**11 箇所**）

元は 7-3 の一部だった。7-3 は設計ブリーフと申し送りを足すと 20 ファイル規模になり、
「1 issue = 1 ブランチ = 1 PR」と釣り合わないため、7-2.7 / 7-3a / 7-3b に割った。

## なぜ timeout が要るのか

`apiRequest` には timeout も `AbortSignal` も無く、**レスポンスが来るまで無限に待つ**。
Render の無料枠は**約 15 分のアイドルでスリープし、次のアクセスのコールドスタートに
約 1 分**かかる（`docs/deployment.md` / `docs/README.md`）。

影響が出るのは、有効なトークンを持つ**再訪ユーザー**が任意のページを開いたときである。
`AuthProvider` は起動時に `GET /api/me` を 1 本だけ投げ、その結果が出るまで
`status: "loading"` に留まる。`deriveAuthState()` の 4 状態のうち `loading` は
「まだ判断しない」状態なので、

- `SiteHeader` … ユーザー名の位置にスケルトンが出るだけ（`site-header.tsx:43`）
- トップの CTA … `unauthenticated` ゲートなので出ない（`page.tsx:49`）

つまり**最大 1 分間、押せるものがロゴしか無い画面**になる。7-2 の申し送り 1 そのものである。

重要なのは、**この issue で `RequireAuth` を使うページを作らなくても直る**ことだ。
`SiteHeader` は既に `unreachable` の分岐（再試行＋ログアウト）を持っており
（`site-header.tsx:80-106`）、`AuthProvider` の復元 `catch` は理由を問わず
`setRestoreFailedFor(token)` を呼ぶ（`auth-context.tsx:101-110`）。
timeout を入れれば 15 秒で `catch` に入り、`unreachable` へ落ちて、**全ページの
ヘッダーに操作可能なものが現れる**。新しい状態も新しい分岐も要らない。

## 調べて分かったこと（2026-09-22 実測）

コンテナ（Node 24.19）で確認した。

| 確認したこと | 結果 |
|---|---|
| `AbortSignal.timeout` / `AbortSignal.any` | どちらも利用可 |
| timeout で中断したときの `fetch` の reject 値 | `DOMException` / `name: "TimeoutError"` |
| 呼び出し側の `controller.abort()` での reject 値 | `DOMException` / `name: "AbortError"` |
| その値は `TypeError` か | **いいえ** |

最後の行が効く。`error-messages.ts` は `TypeError` **だけ**を通信エラーに翻訳し
（`error-messages.ts:130`）、それ以外は末尾の `console.error` ＋ `UNEXPECTED_MESSAGE`
に落ちる。つまり今のまま timeout を足すと、**コールドスタート中にログインした人に
「認証に失敗しました」と表示される**。パスワードは正しいのに、訂正しようのない
誤診を出すことになる。だから timeout の導入と文言の追加は同じ issue に入れる。

`AbortSignal.any` は、先に中断したほうの `reason` をそのまま伝える。合成しても
`TimeoutError` と `AbortError` の区別は失われない。

## 決めたこと

### 決定 1：timeout は既定 15 秒、呼び出し側で上書き可

コールドスタートは約 60 秒なので、15 秒は**必ずタイムアウトする**値である。
それを承知で選んだ。60 秒に合わせると「1 回で成功する代わりに最大 60 秒無言で待つ」
ことになり、申し送り 1 の「押せるものがロゴだけ」がほぼそのまま残るためだ。

15 秒で見切って `unreachable` に落とせば、ユーザーは 15 秒後に**押せるもの**（再試行・
ログアウト）を得る。待つか、抜けるかを自分で選べる状態にすることを、一度で成功させる
ことより優先する。

- 定数は `DEFAULT_TIMEOUT_MS = 15_000` として `api.ts` に置く
- `ApiRequestInit` に `timeoutMs?: number` を足す。`skipAuth` と同じく、
  `fetch` へ渡す前に分割代入で取り除く
- **無効化（`timeoutMs: 0` など）は用意しない。** 使う相手がまだいない。
  7-5 の画像アップロードが 15 秒で足りない可能性はあるが、それは上書きで足りる

### 決定 2：呼び出し側の `signal` と合成する

```ts
const timeoutSignal = AbortSignal.timeout(timeoutMs);
const signal = requestInit.signal
  ? AbortSignal.any([timeoutSignal, requestInit.signal])
  : timeoutSignal;
```

7-3b の生成ポーリングは**アンマウント時に自分でキャンセルする**。合成せずにどちらか
一方を `fetch` へ渡す形にすると、timeout を効かせた瞬間に呼び出し側のキャンセルが
効かなくなり、閉じた画面のリクエストが走り続ける。ここで合成しておけば、7-3b は
`signal` を渡すだけで済む。

`requestInit.signal` は `RequestInit` の定義上 `AbortSignal | null | undefined` なので、
真偽値で分岐してよい（`null` を `AbortSignal.any` に渡すと落ちる）。

### 決定 3：タイムアウトは専用のエラークラスにする

```ts
export class ApiTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`API request timed out after ${timeoutMs}ms`);
    this.name = "ApiTimeoutError";
  }
}
```

`ApiError`（2xx 以外）と同じく、呼び出し側が `instanceof` で判定できる形に揃える。
`DOMException` をそのまま流して `name` の文字列で判定する案は採らない。`api.ts` が
投げうるものの一覧が型から読めなくなり、7-3b 以降の呼び出し側が何を握ればよいか
分からなくなるためである。

**変換するのは `TimeoutError` だけで、`AbortError` はそのまま流す。**
呼び出し側のキャンセルは失敗ではなく、文言を出す相手でもない。ポーリングの
アンマウントのたびにトーストが出ては困る。

判定は `error instanceof Error && error.name === "TimeoutError"` で行う。
`error instanceof DOMException` と書くと、`DOMException` をグローバルに持たない
実行環境で `ReferenceError` になる。`DOMException` は `Error` を継承している
（実測で確認済み）ので、上の形なら環境に依存せず同じ結果になる。

変換は `apiRequest` の**最も外側**に置く。`fetch` だけを包むと、`parseBody()` が
レスポンス本文を読んでいる最中の中断を拾えない（`signal` はボディのストリーム読み取りも
中断する）。`ApiError` は `catch` を素通りさせる。

### 決定 4：文言は通信断と分ける

`error-messages.ts` に 1 本足す。

| 起きたこと | 判定 | 文言 |
|---|---|---|
| タイムアウト | `ApiTimeoutError` | サーバーの応答がありません。起動中の可能性があるので、少し待ってから再度お試しください |
| `fetch` 自体の失敗（通信断・CORS・名前解決） | `TypeError` | サーバーに接続できませんでした。通信環境を確認してください（**既存のまま**） |

分ける理由は、コールドスタートで「通信環境を確認してください」と出すのが誤診だからである。
回線は正常で、直せるものは何も無い。ユーザーにできる正しい行動は「少し待って、もう一度」
であり、文言はそれを言う。

あわせて `unreachable` の文言も直す。この状態には timeout 経由で来るのが最多になるが、
現在の文言は接続そのものの失敗を指している。

| 場所 | 現在 | 変更後 |
|---|---|---|
| `site-header.tsx:82` | サーバーに接続できません | サーバーの応答がありません |
| `require-auth.tsx:42` | サーバーに接続できませんでした。 | サーバーの応答がありません。 |

新しい文言は通信断の場合にも当てはまる（応答が無いのは事実）ので、経路ごとに
出し分けない。`unreachable` は理由を保持していないので、出し分けようとすれば
`deriveAuthState()` に状態を足すことになり、7-2.6 の範囲に踏み込む。

### 決定 5：ボタンはコンポーネントではなく「クラスを返す関数」にする

`src/components/ui/button.ts`（JSX を含まないので `.tsx` にしない）。

```ts
type ButtonVariant = "primary" | "secondary";
type ButtonSize = "sm" | "md" | "lg";

export function buttonClasses(options?: {
  variant?: ButtonVariant;
  size?: ButtonSize;
}): string;
```

| 部分 | 中身 |
|---|---|
| 共通 | `rounded-card font-medium disabled:opacity-60` |
| `variant: "primary"`（既定） | `bg-accent text-white hover:bg-accent-strong` |
| `variant: "secondary"` | `border border-line text-ink-muted hover:text-ink` |
| `size: "sm"` | `px-3 py-1.5` |
| `size: "md"`（既定） | `px-4 py-2` |
| `size: "lg"` | `px-5 py-2.5` |

**コンポーネントにしない理由**：現物 11 箇所のうち 3 箇所は `<Link>` で、7-3a の
ページネーションとソートトグルでさらに増える。`<Link>` と `<button>` の両方を
受ける部品は、`href` の有無で props の型を分ける必要があり、`disabled` のように
片方にしか無い属性の扱いも決めなければならない。クラス文字列を配るだけなら、
その問題がそもそも発生しない。`mt-2` のような余白も呼び出し側が並べれば済む。

**`size` に文字サイズを含めない。** `require-auth.tsx:46` は `px-4 py-2` と `text-sm` を
併用しており、`size: "md"` が `text-base` を持つと 2 つの font-size クラスが同時に当たる。
Tailwind では詳細度が同じクラスの優先順位は**生成された CSS の順序**で決まり、
`className` に書いた順では決まらないため、**どちらが効くかがビルドに依存する**。
font-size を持たせなければ衝突自体が起きない。ヘッダーは親の `<nav>` が `text-sm` を
持っており、そのまま継承される。

### 決定 6：`font-medium` を共通部分に入れ、5 箇所が太くなるのを受け入れる

現物を数えると、`font-medium` の有無が揃っていない。

| | 箇所 | `font-medium` |
|---|---|---|
| primary | `page` / `login` / `signup` / `site-header` / `require-auth` | **5 箇所すべて有り** |
| secondary | `page`（ヒーローの「ログイン」） | 有り |
| secondary | `site-header` ×3（ログアウト・再試行・ログアウト） | 無し |
| secondary | `health-panel` ×2（dev 専用のトースト確認ボタン） | 無し |

共通部分に入れると、下 5 箇所がわずかに太くなる。逆に primary にだけ入れると、
ヒーローの「新規登録」と「ログイン」が**隣り合って別の太さ**になる。同格に並ぶ
2 つのボタンで太さが違うほうが事故に見えるので、共通部分に入れる側を採る。

`disabled:opacity-60` も共通部分に入れる。現在はフォームの 2 箇所にしか無いが、
`<Link>` には `disabled` が付かないので無害で、`<button>` に付け忘れる余地を消せる。

`transition-colors` は**足さない**。現在どこにも無く、入れると全ボタンの挙動が変わる。
見た目の変更はこの issue の目的ではない。

## 実装の構え

### 変更する順序

1. `buttonClasses()` を足し、11 箇所を置き換える（`api.ts` に触らないので独立して読める）
2. `api.ts` に `ApiTimeoutError` と timeout を足す
3. `error-messages.ts` に文言を足す
4. `site-header.tsx` / `require-auth.tsx` の `unreachable` 文言を直す
5. `test/lib/api.test.ts` に timeout の検証を足す

### 置き換える 11 箇所

| ファイル | 要素 | 置換後 |
|---|---|---|
| `app/page.tsx:51` | `<Link>` 新規登録 | `buttonClasses({ size: "lg" })` |
| `app/page.tsx:57` | `<Link>` ログイン | `buttonClasses({ variant: "secondary", size: "lg" })` |
| `app/(auth)/login/page.tsx:95` | submit | `` `mt-2 ${buttonClasses()}` `` |
| `app/(auth)/signup/page.tsx:103` | submit | `` `mt-2 ${buttonClasses()}` `` |
| `components/layout/site-header.tsx:54` | `<Link>` 新規登録 | `buttonClasses({ size: "sm" })` |
| `components/layout/site-header.tsx:68` | ログアウト | `buttonClasses({ variant: "secondary", size: "sm" })` |
| `components/layout/site-header.tsx:86` | 再試行 | 同上 |
| `components/layout/site-header.tsx:101` | ログアウト（unreachable） | 同上 |
| `components/dev/health-panel.tsx:75` | 成功トースト | `` `${buttonClasses({ variant: "secondary", size: "sm" })} text-sm` `` |
| `components/dev/health-panel.tsx:82` | 失敗トースト | 同上 |
| `lib/auth/require-auth.tsx:46` | 再試行 | `` `${buttonClasses()} text-sm` `` |

`health-panel.tsx` は 7-3b が入ったら消してよいことになっているが、残っている間は
他と同じ見た目である必要があるので、まとめて置き換える。

### 触らないもの

- `text-field.tsx` の入力欄、`toast-viewport.tsx` のカードと閉じるボタン、
  `(auth)/layout.tsx` のカード … `rounded-card border border-line` を共有しているが
  ボタンではない。`buttonClasses()` の適用対象を「押すもの」に限る
- `globals.css` … 触らない。過去 4 回の Turbopack stale はすべて `globals.css` の
  変更で起きている（`frontend/AGENTS.md`）。この issue は CSS を書かないので該当しない
- バックエンド … 1 行も変更しない

## テスト

`frontend/test/lib/api.test.ts`（既存）に足す。CLAUDE.md の置き場所の規約どおり
`src/` の構造を写した位置にある。

| 検証すること | なぜ |
|---|---|
| 既定 15 秒を過ぎたら `ApiTimeoutError` が投げられ、`timeoutMs` に 15000 が入る | この issue の本体 |
| `timeoutMs` の上書きが効く | 7-5 の画像アップロードが頼る |
| 呼び出し側の `signal` で中断すると `AbortError` が流れ、`ApiTimeoutError` にならない | 7-3b のポーリングが頼る。ここを取り違えると、画面を閉じるたびにエラー文言が出る |
| 時間内に応答があれば従来どおり（timeout が誤発火しない） | 全リクエストへの回帰 |

`error-messages.ts` の `ApiTimeoutError` → 文言の対応も、既存の
`test/lib/auth/error-messages.test.ts` に 1 件足す。**文言は全文で照合する**。
このファイルの既存 6 件がすべてそうしており、1 件だけ方針の違うテストを混ぜると、
読む側がどちらが正なのか判断できなくなるため。

**timeout のテストに fake timers は使えない**（2026-09-22 実測）。`vi.useFakeTimers()` は
`AbortSignal.timeout` を制御しない（jsdom の `setTimeout` ではなく Node 側のネイティブ
実装が動いているため、`advanceTimersByTimeAsync(15_000)` を通しても中断されない）。
したがって、

- 実際に時間を経過させる検査は `timeoutMs` を小さな値（20ms）に上書きして**実時間**で行う
- 既定値が 15 秒であることは `vi.spyOn(AbortSignal, "timeout")` の引数で検査する
  （15 秒待つテストは書かない）

**`buttonClasses()` にはテストを書かない。** 返り値のクラス文字列を照合するテストは
実装をそのまま写経したものになり、6-1 で学んだ「green なのに何も守っていない」型に
当てはまる（`docs/superpowers/specs/2026-08-19-issue-6-1-best-attempts-design.md`）。
崩れたかどうかは画面を見れば分かる。

## 動作確認（ローカル）

CLAUDE.md「動作確認・デプロイの進め方」①のとおり、ローカルのブラウザで行う。

**`stop` ではなく `pause` を使うこと（2026-09-22 実測）。** `stop` は listen ソケットごと
消えるので接続が即座に拒否され、`fetch` は `TypeError` で**すぐに**失敗する。それは
従来からある通信断の経路であって、**timeout の経路を 1 ミリ秒も通らない**。`pause` は
cgroup でプロセスを凍結するだけなので listen ソケットが残り、カーネルが TCP 接続を
受けたまま応答が返らない ——Render のコールドスタートと同じ形になる。
`pause` した backend への `fetch` が **15.0 秒後に `name: "TimeoutError"`** で
reject することは実測で確認した（スタブではなく本物の宙吊り接続でも、ユニット
テストが前提にしている形と同じになる）。

1. `docker compose pause backend` してから `/` をリロードし、**15 秒以内に**ヘッダーが
   スケルトンから「サーバーの応答がありません／再試行／ログアウト」に変わること
   （有効なトークンを持った状態で行う。トークンが無いと `/api/me` を投げない）
2. その状態で `/login` からログインを試み、「サーバーの応答がありません。起動中の…」が
   出ること（「認証に失敗しました」でないこと）
3. `docker compose unpause backend` してヘッダーの「再試行」を押し、ログイン状態に戻ること
4. ボタン 11 箇所の見た目が、ヘッダーと HealthPanel の 5 箇所の太さ以外は変わらないこと

`AGENTS.md` の Turbopack stale は CSS を触らないので想定しないが、見た目が変わらない
ように見えたときは配信 CSS ではなく**このコミットが入っているか**を先に疑う。

## 変更するファイル

| ファイル | 変更 |
|---|---|
| `frontend/src/components/ui/button.ts` | **新規**。`buttonClasses()` |
| `frontend/src/lib/api.ts` | `ApiTimeoutError`、`timeoutMs`、`AbortSignal` の合成 |
| `frontend/src/lib/auth/error-messages.ts` | タイムアウトの文言と分岐 |
| `frontend/src/components/layout/site-header.tsx` | ボタン 4 箇所、`unreachable` の文言 |
| `frontend/src/lib/auth/require-auth.tsx` | ボタン 1 箇所、`unreachable` の文言 |
| `frontend/src/app/page.tsx` | ボタン 2 箇所 |
| `frontend/src/app/(auth)/login/page.tsx` | ボタン 1 箇所 |
| `frontend/src/app/(auth)/signup/page.tsx` | ボタン 1 箇所 |
| `frontend/src/components/dev/health-panel.tsx` | ボタン 2 箇所 |
| `frontend/test/lib/api.test.ts` | timeout の検証 4 件 |
| `frontend/test/lib/auth/error-messages.test.ts` | 文言の分岐 1 件 |

## 完了条件

- backend を止めた状態で、15 秒以内にヘッダーが `unreachable`（再試行・ログアウト）に変わる
- その状態のログインフォームが、通信断とは区別された文言を出す
- 主ボタン 11 箇所が `buttonClasses()` 経由になり、クラス列の複製が無くなる
- `npm test`（`vitest run`）と `npm run lint` が green

## この issue で作らないもの

- **ナビの「探す」→ `/posts` と、トップの CTA「お題を探す」**（7-2 の申し送り 2）。
  `/posts` は 7-3a で初めて実在する。main は Vercel の本番を追跡しているので、
  先に置くと本番で 404 になる（`site-header.tsx:34` のコメント）。**7-3a に移した**
- **`RequireAuth` を使うページ**。7-5 が最初の実利用で、それまでこの分岐は
  ヘッダー経由でしか確認できない
- **失効（401）の理由をユーザーに伝えること**。7-2.6 の範囲。この issue は
  `unreachable`（理由が分からない状態）の見せ方しか触らない
- **リトライやバックオフ**。タイムアウト後に自動で投げ直す仕組みは作らない。
  再試行はユーザーが押す

## 後続への申し送り（コードレビューで出た残件）

どちらも直さずに残す。理由を添えて記録しておく。

1. **timeout はリクエストボディの送信時間も含む → 7-5 の画像アップロード。**
   `AbortSignal` は本文の送信・受信の両方を中断するので、スマートフォンの低速回線から
   写真を送ると、**アップロードが順調に進んでいても** 15 秒で中断され「サーバーの応答が
   ありません」になる。`POST /api/posts`（7-5）と `POST /api/posts/:id/attempts` が
   該当し、**呼び出し側で `timeoutMs` を上げない限り自動では救われない**。
   無効化用の番兵は用意していない（`0` は即座に中断し、`Infinity` は `[EnforceRange]`
   の変換で落ちる）ので、7-5 は具体的な値を決めて渡すこと。

2. **401 の本文読み取り中に timeout すると、失効の文言が出ない。**
   ヘッダまで届いて `tokenStore.clear()` が走った後、`parseBody()` の読み取りが
   中断されると、`ApiError(401)` ではなく `ApiTimeoutError` が投げられる。
   ユーザーは黙ってログアウトされたうえで「応答がありません」と言われる
   （「セッションの有効期限が切れました」は出ない）。直すには 401 の判定を
   `catch` の外へ持ち出す形に組み替える必要があり、ごく狭い窓（401 の本文は
   数十バイトで、そこだけが 15 秒を跨ぐ）に対して構造を崩す価値が無いと判断した。
   失効の見せ方を作り直す **7-2.6 で一緒に扱う**のが自然。
