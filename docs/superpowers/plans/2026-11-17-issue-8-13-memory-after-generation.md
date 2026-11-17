# issue 8-13 生成後のメモリ確認 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本番で生成を 6 回続けたときの `anon_mb` を記録し、512 MB に収まるかを数字で示して README に残す。

**Architecture:** アプリのコードは変えない。スクラッチパッドに置いた記録スクリプトが本番の `/api/health` を 2 秒おきに取って JSONL に書き、ユーザーがブラウザで生成を 6 回行う。終わったら jq で回ごとの値を集計し、README のメモリ実測の節に追記する。

**Tech Stack:** bash、curl、jq（どちらも `/usr/bin` にある）。本番は Render（`https://kotoe-api.onrender.com`）と Vercel（`https://kotoe.vercel.app`）。

**Spec:** `docs/superpowers/specs/2026-11-17-issue-8-13-memory-after-generation-design.md`

## Global Constraints

- 記録スクリプトと JSONL は**スクラッチパッドに置き、リポジトリに入れない**
- **判断は `anon_mb` で行う。** `used_mb`・`peak_mb` はページキャッシュを含むので参考値に留める
- 合格の基準：**生成中の anon の最大が 450 MB 以下**、かつ**5 回目と 6 回目の増分がそれぞれ 5 MB 以下**
- 生成は 2 アカウントで 3 回ずつ、**1 回ずつ順番に**。公開まで終わってから約 30 秒おいて次へ進む。お題は既存のものを使う
- 記録・会話・コミットに、トークンや個人情報（メールアドレス）を出さない。`/api/health` は認証不要なので Authorization は送らない
- Render の環境変数は変えない（再起動が入るため）
- コミットは `Co-Authored-By:` で止める。PR 本文は `Closes #165`（実施時に変更：1 回目の計測の PR は `Refs #165`）。プッシュ前に `/code-review high` を通す

## Review Focus

- **Render が眠っていなかった場合**（直前に誰かが開いた）：起動直後の値として扱えない。最初の応答時間（`time_total`）が 20 秒未満なら、起動直後の値ではないと README に明記する
- **`/api/health` が 503 やタイムアウトを返した回**：記録が途切れたまま集計しない。JSONL にエラー行として残し、集計時に欠けた区間を報告する
- **`source` が `cgroup_v1` / `cgroup_v2` 以外**（`proc_rss` / `unavailable`）：`anon_mb` が無いので判定できない。その時点で止めてユーザーに報告する
- **生成が失敗した回**（`failed`）：その回は増分の比較から外し、6 回に届かなければ 2 つ目のアカウントの残り枠や翌日で補うかをユーザーに聞く
- **途中で Render が再起動した**（デプロイや OOM）：`peak_mb` が急に下がるか、プロセスの PID 構成が変わったことで見分ける。OOM なら不合格として扱い、その事実を README に残す

---

### Task 1: 記録スクリプトを作り、ローカルで動作を確かめる

**Files:**
- Create: `<scratchpad>/8-13/record.sh`（リポジトリ外）

**Interfaces:**
- Produces: `record.sh <base_url> <out.jsonl>`。2 秒おきに `GET <base_url>/api/health` を取り、1 回につき 1 行を追記する。行の形は `{"t":"<ISO8601>","http":<status>,"time_total":<秒>,"memory":<応答の memory か null>}`。Ctrl-C（SIGINT/SIGTERM）で止まる

- [ ] **Step 1: `record.sh` を書く**

`curl -s -m 10 -w` で本文・HTTP ステータス・`time_total` を同時に取る。本文が JSON でない場合（タイムアウト・HTML のエラー）は `memory` を `null` にした行を書く。`sleep 2` で回す。

- [ ] **Step 2: ローカルで 10 秒動かす**

Run: `docker compose up -d backend` の後、`timeout 10 <scratchpad>/8-13/record.sh http://localhost:3000 <scratchpad>/8-13/local.jsonl; jq -c '{http, src: .memory.source, anon: .memory.anon_mb}' <scratchpad>/8-13/local.jsonl`
Expected: 4〜5 行出力され、`http` が 200、`src` が `cgroup_v2`、`anon` が数値

- [ ] **Step 3: エラー時の行を確かめる**

Run: `timeout 5 <scratchpad>/8-13/record.sh http://localhost:9 <scratchpad>/8-13/err.jsonl; jq -c . <scratchpad>/8-13/err.jsonl`
Expected: `http` が 0、`memory` が null の行が出て、スクリプトは落ちずに回り続ける

（コミットなし。リポジトリ外のため）

### Task 2: 本番で測る（ユーザーと一緒に行う）

**Files:**
- Create: `<scratchpad>/8-13/prod.jsonl`（リポジトリ外）

**Interfaces:**
- Consumes: Task 1 の `record.sh`
- Produces: `prod.jsonl` と、ユーザーが知らせた各回の「押した時刻」と「公開を確認した時刻」の一覧（会話の中で記録する）

- [ ] **Step 1: 準備ができているかをユーザーに確かめる**

2 つ目のアカウントがあること、2 つのアカウントのどちらも今日はまだ生成していないこと（1 日 3 回の枠が残っていること）、最後に本番を開いてから 15 分以上経っていることを確認する。

- [ ] **Step 2: 記録を始める（バックグラウンド）**

Run: `<scratchpad>/8-13/record.sh https://kotoe-api.onrender.com <scratchpad>/8-13/prod.jsonl`（`run_in_background`）
Expected: 最初の行の `time_total` が 20 秒以上（起動直後）で、`source` が cgroup 系。その行の `anon_mb` を起動直後の値としてユーザーに伝える

- [ ] **Step 3: 生成を 6 回行ってもらう**

ユーザーには、各回で「押した」「公開された」をチャットで一言知らせてもらい、そのたびに受け取った時刻を記録する。
1 つ目のアカウントで 3 回、ログインし直して 2 つ目のアカウントで 3 回行う。各回が終わったら、30 秒経ってから次へ進むよう伝える。
各回の後に `tail -1 prod.jsonl | jq .memory.anon_mb` をユーザーに伝える。

- [ ] **Step 4: 6 回目の 30 秒後に記録を止める**

Run: 記録しているプロセスを止めた後、`jq -s 'length, (map(select(.memory == null)) | length)' <scratchpad>/8-13/prod.jsonl`
Expected: 総行数と、エラー行の数（0 が望ましい。0 でなければ欠けた区間を報告する）

### Task 3: 集計して判定する

**Interfaces:**
- Consumes: `prod.jsonl` と Task 2 の時刻一覧
- Produces: 表（行は起動直後と 1〜6 回目。列は「生成中の anon の最大」「生成後の anon」「前回からの増分」「used」「file」「peak」）と、合否

- [ ] **Step 1: 回ごとに集計する**

「押した時刻」から「公開を確認した時刻」までを生成中の区間、そこから 30 秒後の行を「生成後」とし、jq で区間ごとに `anon_mb` の最大を出す。増分は「生成後」どうしの差で出す。

- [ ] **Step 2: 合格の基準に当てる**

生成中の anon の最大の最大値を 450 MB と比べる。5 回目と 6 回目の増分を 5 MB と比べる。Review Focus の 5 項目（眠っていなかった、エラー行、source、失敗した回、再起動）に当てはまるものが無いかも確認する。

- [ ] **Step 3: 結果をユーザーに見せる**

表と合否を示す。**不合格なら、ここで止める。** README の削減の候補から対処を提案し、設計書に追記してから進める（この計画の外）。

### Task 4: README に追記し、後片付けをする

**Files:**
- Modify: `docs/README.md`（「本物の画像生成での実測」の節の後、「Cloudinary の無料枠の数え方」の前に新しい節を足す）
- Modify: `docs/issues_backlog.md`（8-13 の見出しに ✅ を付ける。🟢/🔵 は優先度で完了ではない。実施時に変更：24 時間の計測を終えるまで付けない）

- [ ] **Step 1: 節を足す**

見出しは `### 生成を重ねた後の実測（issue 8-13 で計測・<測った日>）`。中身は次の 5 つ。
- 条件：モデルと出力形式は 4-3 と同じであることを確認して書く。2 アカウントで 3 回ずつ、順番に生成した
- Task 3 の表
- 起動直後の anon を 8-2b（anon 346）と比べ、8-2b の used 444 と 4-3 の used 366 の差がページキャッシュによるものかを書く（実施時に変更：材料が足りず切り分けられないと書いた）
- 結論：anon の最大と余裕（MB と %）、頭打ちになったかどうか
- 8-6 に向けた一言（常駐して問題ないか、毎晩眠らせる B のほうが有利か）

- [ ] **Step 2: backlog を更新する**

- [ ] **Step 3: 確認してコミットする**

Run: `git diff --stat`
Expected: `docs/README.md` と `docs/issues_backlog.md` だけが変わっている

```bash
git add docs/README.md docs/issues_backlog.md
git commit -m "docs: 8-13 生成を重ねた後のメモリを実測して README に追記する"
```

- [ ] **Step 4: 後片付け**

測定で作った 6 件の挑戦をマイページから削除するよう、ユーザーに頼む（論理削除になる）。削除した後、お題の詳細ページに 6 件が出ていないことを確かめてもらう。

- [ ] **Step 5: レビューを通してから PR を作る**

`/code-review high` を通す → プッシュ → PR を作る（本文に `Closes #165`（実施時に変更：1 回目は `Refs #165`）、表の要約、8-6 への一言）。
