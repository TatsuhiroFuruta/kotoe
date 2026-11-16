# 本番デプロイ・最終疎通（8-2b）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本番 URL でコアループが通ることを確かめて記録し、カスタムドメインを 8-12 に切り出して、MVP を閉じる。

**Architecture:** コードは変更しない。本番（`https://kotoe.vercel.app` / `https://kotoe-api.onrender.com`）をブラウザで 1 周確かめ、結果を issue #30 のコメントに残す。docs（`issues_backlog.md`・`deployment.md`）を結果に合わせて直し、docs の PR を 1 本出す。

**Tech Stack:** 本番（Render・Vercel・Neon・Cloudinary・OpenAI）／ Claude in Chrome ／ `gh` ／ ImageMagick（`magick`）。**新しい依存は追加しない。**

**Spec:** `docs/superpowers/specs/2026-11-15-issue-8-2b-final-check-design.md`

**Issue:** GitHub #30。**PR 本文は `Closes #30`**（8-12 は新規に作る issue なので `Refs` も付けない。本文で番号に触れるだけ）

**Branch:** `docs/issue-8-2b-final-check`（作成済み。設計書のコミット `746f1ed`・`d62a352` が載っている）

## Global Constraints

- **コード（`backend/`・`frontend/`・`e2e/`）を変更しない。** 変わるのは `docs/` だけ。
- **本番 DB を直接触らない。** `psql` も Rails コンソールも使わない。本番のデータは画面からだけ作り・消す。
  （実施時の例外：お題を消す画面が無かったため、お題 #7 だけはユーザーの承認を得てブラウザから API で論理削除した。Task 2 Step 4）
- スモークユーザー `smoke@kotoe.test`・`smoke-3-1@example.com` と Cloudinary の 1x1 PNG には**何もしない**（設計書 決定 4）。
- 画像生成は**本番で 1 回だけ**（約 $0.011）。失敗しても 2 回目を押す前にユーザーに確認する（枠も実費も戻らない）。
- 確認用アカウントのメールは `kotoe-8-2b-<YYYYMMDDHHMM>@example.com`、名前は `8-2b確認`。**実在の個人情報を入れない。**
  パスワードは使い捨てで生成し、scratchpad のファイルにだけ置く（会話・コミット・issue に書かない）。
  （実施時：本番にパスワードを入力するのは Claude ではなくユーザーにした。登録・ログインはユーザーが操作）
- 秘密（env・接続文字列・API キー）を表示しない。
- 不具合が出ても、このブランチで直さない。止めてユーザーに報告し、別 issue に切り出す（設計書 決定 1）。
- `git checkout` を使わない。ブランチを切り替えない。
- コミットの末尾は `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` で止める（`Claude-Session:` 行を書かない）。PR 本文も同様。
- GitHub への書き込み（issue の作成・コメント・PR）は外から見える操作なので、**本文を見せて確認を取ってから**行う。

## Review Focus

- **Render のコールドスタート**：スリープ明けの最初の要求は約 1 分かかる（2026-11-15 の `/up` は 53 秒）。手順 1 で起こしてから進め、途中の遅さを不具合と取り違えない。
- **本番が main の最新でない**：Vercel・Render の最新デプロイが失敗していると、古いコードを確かめることになる。Task 1 で両方のデプロイ元のコミットを見る。
- **縦横比**：正方形の画像だけでは比率の崩れ（グレーの帯など）を見逃す。お題の画像は 16:9 にする。
- **直接ロード**：画面内のリンク遷移だけだとハイドレーション経路が出ない。手順 8 は URL を直接開く／再読み込みする。
- **生成の失敗**：`failed` になったら、Render のログで `failure_reason` を見る（`api_error` なら OpenAI の残高・上限を先に疑う。`deployment.md`「OpenAI」）。

---

### Task 1: 事前確認（CI と本番のデプロイ元）

**Files:** なし（記録は Task 3 でまとめる。ここでは scratchpad の `8-2b-record.md` にメモする）

- [ ] **Step 1: main の CI を確認する**

Run: `gh run list --branch main --workflow CI --limit 1 --json conclusion,headSha,url`
Expected: `conclusion: success`。`headSha` が `git rev-parse origin/main` と一致する。ジョブ一覧（`gh run view <id> --json jobs`）に `e2e (playwright)` があり success。URL をメモする。

- [ ] **Step 2: 本番のデプロイ元を確認する**

Run: `gh api repos/:owner/:repo/deployments --jq '.[0:3][] | {environment, sha, created_at}'`（Vercel の Production）。Render はユーザーに管理画面の最新デプロイのコミットを見てもらう。
Expected: どちらも main の最新（`e7c16b3` かそれ以降）。違えばユーザーに報告して止める。

- [ ] **Step 3: Render を起こす（コアループの手順 1）**

Run: `curl -s -w "\n%{http_code} %{time_total}\n" https://kotoe-api.onrender.com/api/health`（`/up` は Rails 既定の HTML を返すだけで DB を見ない）
Expected: `status: ok`・`database: ok`・`memory` キーあり（無ければデプロイが古い）と `200`。時間をメモする。

### Task 2: 本番でコアループを 1 周する

**Files:** scratchpad に `8-2b-hero-16x9.png`（お題の画像）と `8-2b-record.md`（記録）

**Interfaces:**
- Produces: 確認用アカウント・お題 ID・挑戦 ID（Task 3 の記録と後片付けで使う）、各手順の OK/NG と気づいたこと

- [ ] **Step 1: お題の画像を作る**

Run: `magick -size 1600x900 gradient:skyblue-orange -fill white -draw "circle 800,450 800,250" <scratchpad>/8-2b-hero-16x9.png`
Expected: 1600×900 の PNG（`magick identify` で確認）。描写しやすい形（空のグラデーションと白い円）にしておく。

- [ ] **Step 2: ブラウザ操作の担い手をユーザーに確かめる**

Claude in Chrome で操作する（既定）か、ユーザーが手で操作して Claude が記録するかを聞く。Claude in Chrome なら、`anthropic-skills:chrome-browser` を読み、新しいタブで始め、GIF で記録する（`kotoe-8-2b-core-loop.gif`）。

- [ ] **Step 3: 手順 2〜9 を通す**

設計書 決定 1 の表のとおり。各手順で見ることと、合格の条件：

| # | 合格の条件 |
|---|---|
| 2 | 登録後、ヘッダーがログイン状態（アカウント欄）になる |
| 3 | トースト「お題を投稿しました」。詳細の画像の `src` が `https://res.cloudinary.com/` で始まり、読み込めている（`naturalWidth > 0`）。16:9 の比率で帯が出ない |
| 4 | 「保存」で下書きとして保存される（詳細の再読み込みでは空欄になるのが仕様。マイページ「下書き」→「続きを書く」（`?draft=`）で描写文が戻る） |
| 5 | 「画像を生成」後、ポーリングで生成画像が表示される。押してから出るまでの秒数をメモする |
| 6 | 比較ビューで元画像と生成画像が並び、どちらも読み込めている |
| 7 | 「いいね」で数が 1 増え、再読み込みしても保たれる（自分の挑戦にはいいねできない（5-1）ので、ユーザー本人のアカウントで行い、最後に取り消す。手順 8・9 は確認用アカウントで行う） |
| 8 | マイページの URL を**直接**開いても、ログイン状態のまま表示される |
| 9 | ログアウト後、マイページを直接開くとログイン画面へ誘導される |

NG が出たら止め、画面・コンソール（`read_console_messages`）・ネットワークを記録してユーザーに報告する。

- [ ] **Step 4: 使ったお題・挑戦を論理削除する**

再ログインし、挑戦はマイページ「自分の挑戦」の「削除」から消す。**お題を消す画面は 7-6c（#164）ができるまで無い**ので、
ユーザーの承認を得てから、確認用アカウントでログイン中のタブの `fetch` で `DELETE /api/posts/:id` を 1 回送る
（2026-11-15 の実施：お題 #7、204 → 取得は 404。`Post.kept.find` なので認証の有無・持ち主かどうかに関わらず 404）。**7-6c の後は、この API の直接呼び出しをやめ、画面から消して削除の導線も確かめる**。お題の詳細 URL が「お題が見つかりませんでした」の表示になることを確かめる。アカウントは残す。

### Task 3: issue #30 に結果を記録する

**Files:** なし（GitHub）

- [ ] **Step 1: コメントの本文を作り、ユーザーに見せる**

構成：確認日・本番のデプロイ元コミット・CI の run URL（Task 1）→ 手順 1〜9 の表（# / 操作 / 結果 OK・NG / メモ）→ 生成の所要時間 → 後片付け（お題 #NN・挑戦 #NN を論理削除、確認用アカウントは残した）→ 決定 4（スモークユーザーは残す）→ 気づいたこと。メール・パスワードは書かない。

- [ ] **Step 2: 確認が取れたら投稿する**

Run: `gh issue comment 30 --body-file <scratchpad>/8-2b-record.md`
Expected: コメントの URL が返る。

### Task 4: 8-12 を積み、docs を直す

**Files:**
- Modify: `docs/issues_backlog.md`（8-2b の節、8-11 の節の直後に 8-12 を追加）
- Modify: `docs/deployment.md`（「スモークユーザーの cleanup」、「範囲外」の行）

- [ ] **Step 1: GitHub issue 8-12 を作る（本文を見せて確認を取ってから）**

タイトル `8-12. カスタムドメイン / DNS`、ラベル `本リリース`、マイルストーン `マイルストーン 8：仕上げ・デプロイ`。本文は設計書 決定 3 の 4 項目（`kotoe.vercel.app` は使えるまま／`CORS_ALLOWED_ORIGINS` への追加／8-5・8-3・8-8 との順序／入れた回の疎通確認）と、背景（MVP は試験的に使ってもらう人に Vercel の URL で使ってもらう、2026-11-15）。
Run: `gh issue create --title ... --label 本リリース --milestone ... --body-file ...`
Expected: issue 番号が返る（以下 `#NNN`）。

- [ ] **Step 2: `issues_backlog.md` を直す**

- 8-2b：見出しを `### ✅ 🟢 8-2b.` に。タスクの「カスタムドメイン/DNS」を外し、「カスタムドメイン/DNS は 8-12（#NNN）へ切り出し（2026-11-15。MVP は試験的に使ってもらう人に `kotoe.vercel.app` で使ってもらうため）」を足す。設計書のパスと「結果は #30 のコメント」を書く
- 8-11 の節の直後に `### 🔵 8-12. カスタムドメイン / DNS` を足す（GitHub・依存・背景・タスク・完了条件の形は 8-11 に揃える）
- 「公開前にやること」の表には**入れない**

- [ ] **Step 3: `deployment.md` を直す**

- 「スモークユーザーの cleanup」の「**未処理**：」を「**残すことにした**（2026-11-15、8-2b）。試験的に使ってもらう中で紛らわしいと分かったら見直す。消すときの手順は下のとおり：」に。Cloudinary の 1x1 PNG の段落も「残している」に合わせる
- 「範囲外：カスタムドメイン/DNS（8-2b）」を「カスタムドメイン/DNS（8-12）」に

- [ ] **Step 4: 差分を確かめてコミットする**

Run: `git diff --stat` → `docs/issues_backlog.md` と `docs/deployment.md` の 2 ファイルだけ。`grep -n "8-2b" docs/deployment.md` に「カスタムドメイン」が残っていないこと。

```bash
git add docs/issues_backlog.md docs/deployment.md
git commit -m "docs: 8-2b を完了にし、カスタムドメインを 8-12 として切り出す"
```

### Task 5: レビュー・プッシュ・PR

- [ ] **Step 1: `/code-review high` をかける**（docs だけでも省略しない）。指摘を直したら、その差分にもう一度かける。
- [ ] **Step 2: プッシュする**（`git push -u origin docs/issue-8-2b-final-check`）。docs だけなので本番には影響しない。
- [ ] **Step 3: PR を作る（本文を見せて確認を取ってから）**。本文：概要・確認結果（#30 のコメントへのリンク）・8-12（#NNN）の切り出し・スモークユーザーを残した判断・`Closes #30`・末尾に `🤖 Generated with [Claude Code](https://claude.com/claude-code)`。
- [ ] **Step 4: PR の CI が green であることを確かめる**（`gh pr checks --watch`）。マージはユーザーが行う。
