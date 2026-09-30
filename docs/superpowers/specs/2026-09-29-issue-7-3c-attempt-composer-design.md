# issue 7-3c お題詳細の描写入力＋生成ポーリング 設計

- 対象 issue：`docs/issues_backlog.md` 7-3c（GitHub #120）
- 依存：7-3b（`PostDetail` の `lastSuccess`・`retry()`）、4-2（挑戦 API）、4-3（生成画像は WebP）、
  7-2.5（トースト）、7-2.7（`apiRequest` の timeout と `AbortSignal` の合成）
- 作成日：2026-09-29
- 前提：`frontend/AGENTS.md`（Next 16.2.10 の API は型定義とコンパイル済み実装を直接読む）
- 前提：CLAUDE.md「ドメインの重要ルール」（2 ボタン・即公開・枠は戻らない）「XSS」「テスト戦略」
  「メッセージ・エラー・i18n の責務」
- 前提：backlog 7-3c の「決めたこと」1〜7（2026-09-27、7-3b の設計時に合意）。本書はそれを写し、
  根拠と、着手時に追加で決めたこと（決定 8〜10）を足す

## この issue で作るもの

1. お題詳細の「表彰台」と「みんなの挑戦」の間に描写フォーム（入力欄・文字数・「保存」「画像を生成」）
2. 生成の起動と、結果が出るまでのポーリング
3. 結果パネル：生成中・公開済み（画像・ダウンロード・「新しく描写する」）・失敗・打ち切り
4. 保存・生成のエラー表示（入力欄の下／フォームの上／トースト）
5. `cloudinaryDownloadUrl()`（4-3 からの申し送り）

バックエンドの変更は無い。

## 調べて分かったこと（2026-09-29、コードから確認）

| 確認したこと | 結果 |
|---|---|
| 下書きの作成 | `POST /api/posts/:post_id/attempts`（`{ attempt: { description } }`）→ 201 `{ attempt }`。削除済み・存在しないお題は 404 |
| 下書きの更新 | `PATCH /api/attempts/:id` → 200 `{ attempt }`。`draft` 以外は 422 `{ error: "attempt_not_draft" }`。他人・削除済み・**お題が削除済み**は 404（4-4） |
| 生成の起動 | `POST /api/attempts/:id/generate` → 202 `{ attempt }`（`status: "generating"`）。404 の条件は PATCH と同じ |
| 生成のエラー | 422 `attempt_not_draft`／422 `generation_limit_reached`（`limit`・`resets_at`）／503 `service_generation_limit_reached`（`resets_at`）／503 `generation_disabled` |
| `resets_at` | JST の翌 0 時を UTC の ISO8601 で返す |
| 状態の取得 | `GET /api/attempts/:id` → `{ attempt, post }`。**`published` 以外は本人にしか見えず、それ以外は 404**（未認証も 404） |
| バリデーション | `description` は必須・**1,000 文字以下**（`Attempt::MAX_DESCRIPTION_LENGTH`）。422 `{ errors: { description: ["blank"] } }` の形 |
| `failure_reason` | `content_policy` / `rate_limited` / `api_error` / `upload_failed` / `internal_error` / `generation_disabled` の 6 種（`Attempt::FAILURE_REASONS`） |
| 1 日の上限 | 既定 3 回（`KOTOE_DAILY_GENERATION_LIMIT`）。**残り回数を返す API は無い** |
| 枠の消費 | enqueue 時（`generated_at` を立てる）。削除しても、失敗しても戻らない |
| ローカルの生成 | `KOTOE_IMAGE_PROVIDER` 未設定なら dummy（即座に固定の PNG を返す）。本番だけ openai |
| ジョブ実行時のキルスイッチ | `GenerateImageJob` は実行時にも `enabled?` を見て、false なら `failed`（`generation_disabled`）に落とす |

## 決めたこと

### 決定 1：下書き id は画面の中（`useState`）だけで持つ（backlog 決定 1）

初回の「保存」は `POST`、以降は `PATCH`。リロード・移動で id は失われる（下書きはサーバーに残り、
7-6 のマイページから再開する）。

- `localStorage` に置かない。別タブ・別端末での生成・削除と食い違い、「保存したつもりの下書きが
  もう `draft` ではない」状態を画面が知る手段が無くなる
- URL に載せる案（`?draft=`）は 7-6 の「編集」ボタンと一緒に設計する。他人の下書き・生成済み・
  別のお題・削除済みの扱いと値の検証が要り、この issue の範囲を超える

### 決定 2：「画像を生成」は未保存の変更を自動で保存してから起動する（backlog 決定 2）

生成はサーバーに保存された文面を使う。保存せずに書き換えてから押すと、**古い文面で生成され、
枠が 1 つ消える**。そのため「画像を生成」は次の順で動く。

1. 下書きが無ければ `POST`、`text !== savedText` なら `PATCH`（成功トーストは出さない）
2. 保存が失敗したら生成に進まない（エラーは「保存」と同じ場所に出す）
3. `POST :generate`

「未保存なら生成ボタンを押せなくする」案は不採用。主役のボタンが最初は押せない形になり、
初めての人が「保存してから生成」という手順を知らないと先へ進めない。

### 決定 3：ポーリングは React を知らない関数＋薄いフック（backlog 決定 3）

`lib/attempts/poll-attempt.ts` に置く。取得・待機・時計を引数で差し替えられるようにして、
**そこにだけ Vitest を書く**（React Testing Library は採用していないので、フックそのものは検査できない）。

```ts
export type PollOutcome =
  | { kind: "settled"; attempt: Attempt } // generating 以外になった（published / failed / draft）
  | { kind: "not_found" }                 // 404
  | { kind: "timed_out" };                // 締め切りを過ぎても generating のまま

export function pollAttempt(
  attemptId: number,
  options: {
    signal: AbortSignal;          // 中断したら AbortError で reject する
    immediate?: boolean;          // true なら最初の 1 回を待たずに取得する（決定 10）
    intervalMs?: number;          // 既定 3_000
    deadlineMs?: number;          // 既定 360_000
    fetchAttempt?: (id: number, signal: AbortSignal) => Promise<Attempt>; // 既定は apiFetch
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;           // 既定は setTimeout
    now?: () => number;                                                   // 既定は Date.now
  },
): Promise<PollOutcome>
```

| 項目 | 値・挙動 | 根拠 |
|---|---|---|
| 間隔 | 3 秒 | 本番の実測で生成は約 29 秒。約 10 回で済む |
| 締め切り | 6 分 | 最悪ケース：OpenAI の timeout 150 秒 × 2 回＋アップロードの再試行で約 5 分 |
| 1 回の timeout | `apiRequest` の既定（15 秒） | 別の値を持たない |
| 重ねない | 前の応答（または失敗）を待ってから次の待機に入る | 遅い応答が積み重なって同時に何本も飛ぶのを防ぐ |
| 通信エラー・5xx・timeout | 数えずに続行する | 一時的な失敗で「失敗しました」と言うと、生成は進んでいるのに誤診になる |
| 404 | 停止して `not_found` | 削除された。待っても変わらない |
| 401 | 通信エラーと同じく続行 | `GET /api/attempts/:id` は認証不要なので、実際には 401 ではなく 404 が返る（下の「既知の穴」） |
| 中断 | `AbortError` で reject。中断後は fetch しない | アンマウント・「もう一度確認」のやり直しで止める |

締め切りの判定は「次の待機の後に締め切りを過ぎるなら、待たずに `timed_out`」ではなく、
**取得の前に `now() - start >= deadlineMs` なら `timed_out`** とする（最後の待機ぶん遅れて返るが、
締め切り直前の取得を捨てない）。

フック `lib/attempts/use-attempt-polling.ts` は「`attemptId` と `immediate` を受け取って `pollAttempt`
を走らせ、結果をコールバックで返し、アンマウントか引数の変化で `AbortController` を中断する」だけにする。

**既知の穴（許容する）**：生成中に JWT が失効すると、Rails はトークンを無視して未ログイン扱いにし、
本人にしか見えない `generating` の挑戦は 404 になる。ポーリングは `not_found` で止まる。
24 時間の失効が数十秒の生成に重なったときだけ起き、生成そのものは進むので、文言に
「完成していればみんなの挑戦に表示されます」を添えて許容する（失効の扱いは 7-2.6）。

### 決定 4：入力欄は認証状態によらず常に表示する（backlog 決定 4）

失効（`authenticated` → `unauthenticated`）で入力欄がアンマウントされると、書きかけの文面が消える。
入力欄は常に出し、**ボタン領域だけを出し分ける**。

| 認証状態 | ボタン領域 |
|---|---|
| `loading` | 2 つとも disabled |
| `authenticated` | 「保存」「画像を生成」 |
| `unauthenticated` | 「ログインして描写する」→ `/login?next=/posts/<id>`（`FavoriteButton` と同じ組み立て） |
| `unreachable` | 出す。押して失敗すれば通信エラーを出す（お気に入りと同じ） |

未ログインで書いた文面は、ログイン画面へ移ると失われる。これは 7-2.6 の「先に決めること 3
（入力中のデータを失わせない配慮）」で扱う。

### 決定 5：エラーの置き場所（backlog 決定 5）

| 失敗 | 置き場所 | 状態の変化 |
|---|---|---|
| 保存の 422 `blank` / `too_long` | 入力欄の下（`aria-describedby`） | なし |
| 保存の 422 `attempt_not_draft` | 表示しない。下書きが既に generating 以降になっている（別タブで生成した・応答不明の生成が実は起動していた）ので、`draftId` を捨てて**その挑戦の確認ポーリングに合流する**（決定 10）。書き直した文面は保存されていないので、フォームの上に「書き直した内容は保存されていません。始まっていた生成の結果を表示します」と出す | `draftId` と `savedText` を `null` に |
| 保存の 404 | 入力欄の下に説明「この下書きは削除されたか、お題が削除されています。お題が残っていれば、もう一度保存すると新しい下書きになります」（PATCH はお題の削除でも 404） | `draftId` と `savedText` を `null` に |
| 保存のお題 404（`POST` の 404） | フォームの上「このお題は削除されました」 | なし（ボタンは押せるが同じ結果になる） |
| 401（保存・生成とも） | `toast.error(SESSION_EXPIRED_MESSAGE)` | 文面は残す。ボタン領域はログイン導線に変わる |
| 生成の 422 `generation_limit_reached`・503 | フォームの上（`role="alert"`） | 挑戦は `draft` のまま。翌日また押せる |
| 生成の 404 | フォームの上「この下書きは削除されたか、お題が削除されています」 | `draftId` と `savedText` を `null` に |
| 生成の timeout・通信断・5xx・`attempt_not_draft` | 決定 10 | 決定 10 |
| 保存の timeout・通信断・5xx | フォームの上（`toRequestErrorMessage`） | なし |
| 上のどれにも当たらない 4xx（未知のコード） | フォームの上に、コードを含めた文 | なし（無言にしない） |

フォームのバリデーションエラーはトーストに出さない（7-2.5 の規約：読んで直す必要があるものを数秒で消さない）。

### 決定 6：終端状態の後は下書きを捨て、文面は残す（backlog 決定 6）

`published` / `failed` になったら `draftId` と `savedText` を `null` に戻す。**文面は残す**。
終端状態の挑戦は二度と `draft` に戻らないので、次の保存・生成は新しい下書きになる。
文面を残すのは、少し直して再挑戦できるようにするため。

- `published`：結果パネルに画像を出し、`PostDetail` の `retry()` で詳細を取り直す。7-3b の決定 2 により
  取り直しの間もヒーロー・表彰台・フォームはアンマウントされない
- 生成中は「ページを離れても生成は続きます。完成するとみんなの挑戦に表示されます」と添える
  （離れると `id` が失われ、4-5 が未対応なので `failed` はどこにも出ない）

### 決定 7：新しく作る純粋関数（backlog 決定 7）

`poll-attempt.ts`（決定 3）、`attempt-messages.ts`（下）、`cloudinaryDownloadUrl()`（決定 9）。
**状態遷移は reducer に切り出さない**。遷移の数は多くないうえ、reducer にしても React Testing Library
を持たないのでコンポーネントの配線は検査できず、テストできる範囲が増えない。

#### `lib/attempts/attempt-messages.ts`

| 関数 | 入力 | 出力の例 |
|---|---|---|
| `failureReasonMessage(reason)` | `failure_reason` | 下の表。未知のコード・`null` でも、コードを含めた文を返す（無言にしない） |
| `generationErrorMessage(error, now)` | `POST :generate` の `ApiError` | 「今日の生成回数（3 回）を使い切りました。あと約 5 時間で回復します」。対応しないものは `null`（呼び出し側が決定 10 へ回す） |
| `resetsInText(resetsAt, now)` | `resets_at`・現在時刻 | 「あと約 5 時間で」（時間は切り上げ）／1 時間以下なら「1 時間以内に」／壊れた日付・過去なら `null` |
| `descriptionFieldError(error)` | 保存の `ApiError` | 422 の `errors.description` の `blank` / `too_long` を翻訳。未知のコードはコードを含めた文。該当しなければ `null` |

| `failure_reason` | 文言 |
|---|---|
| `content_policy` | 描写の内容が画像生成サービスの規約に触れたため、生成できませんでした。表現を変えて再挑戦してください |
| `rate_limited` | 画像生成サービスが混み合っていたため、生成できませんでした。時間をおいて再挑戦してください |
| `api_error` | 画像生成サービスでエラーが発生したため、生成できませんでした |
| `upload_failed` | 生成した画像を保存できませんでした |
| `internal_error` | サーバーでエラーが発生したため、生成できませんでした |
| `generation_disabled` | 画像生成が一時停止されたため、生成できませんでした |

失敗パネルには必ず「この生成で今日の生成回数を 1 回使いました」を添える。枠が戻らないこと
（ドメインの重要ルール）を画面が隠さないため。

| 生成エラー | 文言 |
|---|---|
| 422 `generation_limit_reached` | 今日の生成回数（`limit` 回）を使い切りました。`resetsInText` 回復します（`limit` が無ければ回数を省く） |
| 503 `service_generation_limit_reached` | 本日はサービス全体の生成上限に達しました。`resetsInText` 回復します |
| 503 `generation_disabled` | 現在、画像生成を一時停止しています。時間をおいて再度お試しください |

`resetsInText` が `null` のときは「回復します」の節ごと省き、日付の壊れた値を文に出さない。

### 決定 8：生成の結果はフォームの位置に結果パネルとして出す（着手時に決定）

`published` で詳細を取り直すだけでは、**再現度順で見ているとき（いいね 0 件で末尾）や 2 ページ目以降を
見ているとき、自分の結果が画面に出ない**。押した場所では何も起きていないように見える。
また、ダウンロードリンクの置き場所が要る。

そこで、ボタンの下に結果パネルを出す（デザインブリーフ 3-A「生成中…のプレースホルダーカード」と同じ位置づけ）。

| 状態 | パネル |
|---|---|
| 生成中 | 正方形のプレースホルダー（`animate-pulse`）＋「生成中…」＋決定 6 の添え書き。`role="status"` |
| 公開済み | 生成画像（`cloudinaryUrlOrNull(id, { width: 640, aspect: "1:1" })`。一覧・表彰台と同じ派生画像）＋「ダウンロード」＋「新しく描写する」 |
| 失敗 | `failureReasonMessage` ＋ 枠を使った旨 |
| 打ち切り（`timed_out`） | 「まだ生成しています。完成するとみんなの挑戦に表示されます」＋「もう一度確認」。枠は消費済みなので「失敗」と言わない |
| 見つからない（`not_found`） | 「生成中の挑戦が見つかりませんでした。完成していればみんなの挑戦に表示されます」 |

- **`POST :generate` が受け付けられた時点（202）と、打ち切り・見つからないの時点で `draftId` を捨てる**。
  受け付けた挑戦は generating で下書きではなく、持ち続けると「保存済み」と表示し、直して押すと PATCH が
  `attempt_not_draft` になる（実装時のレビューで判明）
- **打ち切り（`timed_out`）の間は「保存」「画像を生成」を押せなくし、パネルに「新しく描写する」を置く**。
  下書きを捨ててあるので、押せると新しい下書きで二度目の生成になり、まだ進んでいるかもしれない生成と
  あわせて枠を二重に使う。やり直しは「新しく描写する」で明示的に行う
- パネルは、次に「保存」「画像を生成」を押すか「新しく描写する」を押すまで残る（打ち切りの間は 2 つのボタンを押せないので、「もう一度確認」か「新しく描写する」まで残る）
- 「新しく描写する」はパネルを閉じて入力欄にフォーカスを移すだけで、文面は残す（決定 6）
- 「もう一度確認」は `immediate: true` でポーリングをやり直す（締め切りも新しく 6 分）
- B 案（結果は「みんなの挑戦」にだけ出し、成功時に新着順 1 ページ目へ切り替える）は不採用。
  ユーザーが選んだ並び替えを勝手に変えるうえ、ダウンロードの置き場所が別に要る

7-4 で `/attempts/[id]` ができたら、公開済みパネルから比較ビューへのリンクを足す（申し送り）。

### 決定 9：文字数はカウンターだけ出し、判定はサーバーに任せる（着手時に決定）

入力欄の右下に「512 / 1000」を出し、1,000 を超えたら警告色（`text-danger`。`globals.css` の `--color-danger`）にする。
**入力も送信も止めない**。超えて送れば 422 `too_long` が返り、決定 5 のとおり入力欄の下に出る。

- CLAUDE.md「ルールの判定はバック、フロントで再実装しない」に従う。1000 はフロントにも定数で持つが、
  用途は表示だけ（`Attempt::MAX_DESCRIPTION_LENGTH` と揃える旨をコメントに書く）
- `maxLength` で止める案は不採用。貼り付けた文が黙って切り詰められ、ルールをフロントでも持つことになる
- 何も出さない案は不採用。800 文字書いた後で初めて上限を知る形になる
- 数え方は `text.length`（UTF-16 のコード単位）。Rails の `length` は文字数なので、絵文字などで
  表示がサーバーより多く数えることがある。多めに数える側のずれなので、表示が「超えていない」のに
  422 になることは無い
- カウンターは `aria-live` にしない（1 文字ごとに読み上げられる）。`aria-describedby` で入力欄と結ぶ

### 決定 10：生成の応答が不明なら、挑戦を取得して確かめる（着手時に決定）

`POST :generate` はサーバー側で枠の消費と enqueue が済んでいても、応答だけが失われることがある
（15 秒の timeout・通信断・5xx）。このとき挑戦は既に `generating` で、もう一度押すと 422
`attempt_not_draft` になる。backlog 決定 5 のまま `attempt_not_draft` を「下書きを捨てて説明」に
すると、**生成は進んでいて枠も減っているのに、画面は失敗と言う**。

そこで、次の場合は**`immediate: true` のポーリング**に入る（専用の確認関数を作らない）。

- `POST :generate` が timeout・通信断（`TypeError`）・5xx（`ApiError` で 500 以上。ただし 503 の既知コードは決定 5）
- `POST :generate` が 422 `attempt_not_draft`

ポーリングの結果：

| 結果 | 表示 |
|---|---|
| `generating` → そのまま追う | 生成中のパネル |
| `settled`（`published` / `failed`） | 決定 6・8 のとおり |
| `settled`（`draft`） | フォームの上「生成の開始を確認できませんでした。もう一度「画像を生成」を押してください」。`draftId` は保つ（まだ `draft`）。「開始できませんでした」と断定しないのは、Render のコールドスタートで処理待ちの generate より先に確認の GET が返ることがあるため（押し直しても、起動済みなら `attempt_not_draft` → 確認に合流し、サーバーのロックで二重には起動しない） |
| `not_found` | 決定 8 の「見つからない」 |
| `timed_out` | 決定 8 の「打ち切り」。取得がずっと通信エラーだった場合もここに落ちる（確認不能と打ち切りを 1 つの表示にまとめる） |

下書きの `POST` が timeout した場合も、サーバー側で下書きができている可能性がある。もう一度押すと
下書きが 2 つできるだけで（マイページの下書きに残る以外に害は無い）、確かめる手段も無いので対処しない。

## 状態

`AttemptComposer` が `useState` で持つもの：

```ts
text: string
draftId: number | null
savedText: string | null
phase:
  | { kind: "idle" }
  | { kind: "saving" }                                  // 「保存」の送信中
  | { kind: "starting" }                                // 自動保存〜POST :generate の送信中
  | { kind: "polling"; attemptId: number; immediate: boolean; round: number } // round は「もう一度確認」で増やす
  | { kind: "published"; attempt: Attempt }
  | { kind: "failed"; attempt: Attempt }
  | { kind: "stalled"; attemptId: number; reason: "timed_out" | "not_found" }
formError: string | null     // フォームの上
fieldError: string | null    // 入力欄の下
```

- `saving` / `starting` / `polling` の間は 2 つのボタンとも disabled。入力欄は常に編集できる
  （生成が終われば下書きは捨てるので、ここで書き直しても生成中の挑戦には影響しない）
- `savedText` には**送った文面**を入れる（保存中にも入力できるため、応答時点の `text` ではない）
- 「保存」は `draftId !== null && text === savedText` のとき「保存済み」と表示して disabled
  （無意味な PATCH とトーストの連打を防ぐ）
- 成功した「保存」だけ `toast.success("下書きを保存しました")`（7-2.5 の規約：画面が変わらない操作の通知）
- `polling` の `round` はフックの依存に入れ、「もう一度確認」で同じ `attemptId` でも再実行されるようにする

## 構成

```
frontend/src/
├── components/
│   ├── attempts/
│   │   ├── attempt-composer.tsx     … "use client"。状態・保存／生成の手順・ボタンの出し分け（決定 2・4・5・10）
│   │   └── generation-panel.tsx     … 結果パネル。表示だけ（決定 8）
│   └── posts/post-detail.tsx        … コメント位置に <AttemptComposer postId onPublished={retry} /> を置く
├── lib/
│   ├── attempts/
│   │   ├── poll-attempt.ts          … 決定 3
│   │   ├── use-attempt-polling.ts   … 決定 3 の薄いフック
│   │   └── attempt-messages.ts      … 決定 7
│   └── cloudinary.ts                … cloudinaryDownloadUrl() を追加（下の節）
└── types/api.ts                     … AttemptResponse / AttemptShowResponse / FailureReason / 生成エラーのボディ型
```

### `cloudinaryDownloadUrl()`

```ts
cloudinaryDownloadUrl(publicId, { filename: `kotoe-attempt-${attempt.id}` })
// → https://res.cloudinary.com/<cloud>/image/upload/f_png,fl_attachment:kotoe-attempt-12/<path>
```

- 4-3 からの申し送り：生成画像は WebP で保存しているので `f_png` を付ける（`.webp` は macOS の
  プレビューで開けない環境がある）。縮小しない（原寸 1024px）
- `fl_attachment:<name>` で保存名を付ける。`filename` は `/^[A-Za-z0-9_-]+$/` だけを受け付け、それ以外は例外
  （変換文字列の区切り `,` `/` `:` を混ぜさせない）
- `<a href>` にだけ使い、`download` 属性は付けない（別オリジンでは効かない）。新しいタブは開かない
  （`Content-Disposition: attachment` なので画面は遷移しない）
- **オリジンの固定・クラウド名の検証・public_id のセグメント検証は `cloudinaryUrl()` と内部関数で共有する**
  （同じ検証を 2 箇所に書かない。CLAUDE.md の XSS：`href` に変数を入れるときは検証を挟む）
- 描画中に使うので、`cloudinaryUrlOrNull()` と同じく例外を `null` に丸めて console.error に残す版を用意し、
  `null` のときはダウンロードリンクを出さない

### 型（`types/api.ts`）

```ts
export type FailureReason =
  | "content_policy" | "rate_limited" | "api_error" | "upload_failed" | "internal_error" | "generation_disabled";

// Attempt.failure_reason を FailureReason | null に絞る。未知の値が来ても表示は failureReasonMessage が丸める

/** POST /api/posts/:id/attempts・PATCH /api/attempts/:id・POST /api/attempts/:id/generate */
export type AttemptResponse = { attempt: Attempt };

/** GET /api/attempts/:id */
export type AttemptShowResponse = { attempt: Attempt; post: PostSummary };

/** 生成エラーのボディ（422 / 503） */
export type GenerationErrorBody = { error: string; limit?: number; resets_at?: string };
```

## 画面

表彰台と「みんなの挑戦」の間。上から：

1. `h2`「描写を書く」
2. フォームの上のエラー（`role="alert"`）
3. `<textarea>`（`<label>` は見出しと別に視覚的に隠して付ける）。プレースホルダー
   「色・形・配置・雰囲気など、見えるものを言葉で書いてみましょう」。高さは 6 行程度で、縦にだけリサイズ可
4. 入力欄の下：左にフィールドエラー、右にカウンター
5. ボタン：`sm` 以上は右寄せで「保存」（secondary）「画像を生成」（primary）。スマホ幅は縦に積み、
   「画像を生成」を上に（主役）。送信中のボタンは文言を「保存中…」「生成を開始しています…」に変える
6. 結果パネル（決定 8）。公開済み・失敗・打ち切りに切り替わったら、パネルの見出しへフォーカスを移さず
   `role="status"` で読み上げる（入力欄から操作を奪わない）

色は `globals.css` のトークンだけを使い、`dark:` は書かない。

## XSS

- 描写文を表示するのは入力欄（`value`）と結果パネル。パネルでは `{attempt.description}` と
  `whitespace-pre-wrap wrap-break-word` で出す。`dangerouslySetInnerHTML` は使わない
- `<img src>` は `cloudinaryUrlOrNull()`、`<a href>` は `cloudinaryDownloadUrl` の null 版の戻り値だけ
- ログイン導線の `next` は `postDetailHref(postId)`（`FavoriteButton` と同じ）。ログイン画面が `safeNextPath()` で検証する

## テスト

CLAUDE.md の方針どおり、純粋な関数にだけ Vitest を書く。コンポーネントのテストは書かない（E2E は 8-1）。

- `test/lib/attempts/poll-attempt.test.ts`（時計・待機・取得を差し替える）
  - 既定では待ってから取得する／`immediate` なら待たずに取得する
  - 前の取得が解決するまで次の待機に入らない（取得を保留にしたまま時計を進めても 2 本目が出ない）
  - `generating` を 2 回返した後 `published` → `settled`、`failed` → `settled`、`draft` → `settled`
  - 通信エラー（`TypeError`）・500・`ApiTimeoutError` では続行する
  - 404 で `not_found`
  - 締め切りを過ぎたら `timed_out`。締め切りちょうど直前の取得は行う
  - 中断したら reject し、中断後に取得しない（待機中の中断・取得中の中断の両方）
- `test/lib/attempts/attempt-messages.test.ts`
  - `failure_reason` 6 種・未知のコード・`null`
  - `resetsInText`：ちょうど 1 時間・59 分・61 分（切り上げで「約 2 時間」）・過去・壊れた文字列
  - `generationErrorMessage`：`limit` あり／なし、`resets_at` 壊れ、503 の 2 種、対応しないもの → `null`
  - `descriptionFieldError`：`blank` / `too_long` / 未知のコード / 形の違うボディ → `null`
- `test/lib/cloudinary.test.ts` に追加
  - ダウンロード URL の形（`f_png,fl_attachment:<name>`、縮小しない）
  - `filename` に `,` `/` `:` 空文字を渡すと例外
  - public_id の検証（`..` など）とクラウド名未設定の例外が `cloudinaryUrl()` と同じく効く

**ミューテーションで確認する**（メモリ：並び順を足したらミューテーションで検証）。締め切りの比較
（`>=` を `>` に）、`immediate` の分岐、404 の停止、「重ねない」の await を 1 つずつ壊し、テストが赤くなることを確かめる。

## 手動確認（ローカル、dummy 生成）

1. 保存：トーストが出る → ボタンが「保存済み」になる → 1 文字変えると再び押せる → 2 回目は PATCH（Rails のログで確認）
2. 未保存のまま「画像を生成」：自動で保存 → 生成中パネル → 公開 → 画像・ダウンロード・「新しく描写する」
   → みんなの挑戦（新着順 1 ページ目）に現れる → **再現度順・2 ページ目で押しても結果パネルで結果が見える**
3. ダウンロード：PNG で保存され、macOS のプレビューで開ける。画面は遷移しない
4. 「新しく描写する」：パネルが閉じ、文面が残り、入力欄にフォーカスが移る。次の保存は POST（新しい下書き）
5. 文字数：1,001 文字を貼る → カウンターが警告色 → 保存で入力欄の下に「1000 文字以内」の文言
6. 空のまま保存 → 入力欄の下に「描写を入力してください」
7. 上限：`KOTOE_DAILY_GENERATION_LIMIT=1` で 2 回目の生成 → フォームの上に「あと約 N 時間」
8. キルスイッチ：`KOTOE_GENERATION_ENABLED=false`（backend）→ 503 の文言、枠が減らない
9. 打ち切り：確認用に `deadlineMs` を一時的に 15 秒へ縮める（**コミットしない**）。`docker compose stop worker`
   → 生成 → 打ち切り表示 → `docker compose start worker` → 「もう一度確認」で公開
10. 失敗：worker を止めて生成 → worker だけ `KOTOE_GENERATION_ENABLED=false` で起動
    → ジョブが `generation_disabled` で `failed` に落ち、失敗パネルと「今日の生成回数を 1 回使いました」が出る
    （他の `failure_reason` の文言は Vitest で守る）
11. 応答不明（決定 10）：`POST :generate` の直後に backend を `docker compose pause` → timeout → 生成中パネルに合流
    → `unpause` で公開まで進む
12. 認証：未ログインでログイン導線、ログイン後にお題へ戻る／`loading` 中は押せない／backend を止めた
    `unreachable` で押すと通信エラー／**ログイン済みで直接ロード・リロード**しても入力欄とボタンが出る（メモリの教訓）
13. 失効：`localStorage` のトークンを期限切れのものに差し替えて保存 → トースト、文面は残り、ボタン領域がログイン導線に変わる
14. 並び替え・ページ送りをしても、書きかけの文面と生成中のポーリングが保たれる。`#attempts-heading` への
    スクロールとフォーカスが 7-3b どおり（7-3b 手動確認 14 の回帰）
15. スマホ幅で横スクロールが出ない。ボタンが縦に積まれ、「画像を生成」が上
16. 縦長・横長のお題画像でフォームの位置とレイアウトを見る（メモリの教訓：開発データは 64px 正方形だけ）
17. キーボードだけで入力 → 保存 → 生成 → ダウンロードまで操作できる

## リリース

- 環境変数の追加は無い。依存の追加も無い
- 本番にはお題が 0 件なので、**本番での実データ確認は 7-5（お題投稿）以降**。マージ後は Vercel の
  デプロイ成功と、既存の一覧・詳細が壊れていないことだけを確認する
- 本番で生成を試すと実費と生成枠を使う。7-5 以降に確認するときは 1 回に留める

## ドキュメントの後始末（同じ PR）

- `docs/issues_backlog.md`
  - 7-3c の「決めたこと」を、本書の決定 8〜10 を含む形に書き換え、設計書へのリンクを足す
  - 7-4 に追記：公開済みの結果パネルから `/attempts/[id]` へのリンクを足す
  - 4-5 に追記：7-3c は生成中・失敗を**画面にいる間だけ**見せる。離れると `failed` はどこにも出ない（前提は変わらない）
  - 7-2.6 に追記：未ログインで書いた文面・失効時の文面は、ログイン画面へ移ると失われる（決定 4）
  - 7-6 に追記：下書きの「編集」から戻ったとき、このフォームに `draftId` と文面を渡す口が要る

## この issue で作らないもの

- 下書きを URL で受け取って再開する口（7-6）
- 自分の挑戦の削除メニュー（7-6）
- 比較ビューへのリンク・いいねボタン（7-4）
- 残り生成回数の表示（API が無い。要るならバックエンドから）
- 生成中・失敗の挑戦を後から見つける手段（4-5）
- 失効の通知と入力の退避（7-2.6）
