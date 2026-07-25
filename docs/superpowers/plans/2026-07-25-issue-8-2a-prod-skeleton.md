# issue 8-2a 本番スケルトン＋疎通スモーク Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rails(Render) / Next.js(Vercel) / DB(Neon) を最小構成で本番デプロイし、CORS/JWT・Neon プール接続を別オリジンのブラウザから疎通確認できる状態にする。

**Architecture:** backend のコード変更は無し。Render はネイティブ Ruby ランタイム（`render.yaml` + ビルドスクリプト）でデプロイ。フロントに一時的なスモークUI（`/smoke`）を置き、health→sign_up→sign_in→me を実行して Authorization ヘッダが別オリジンの JS から読めることを確認する。ダッシュボード作業はユーザーが `docs/deployment.md` のガイドに沿って実施。

**Tech Stack:** Rails 8 API / devise-jwt / Next.js App Router + TypeScript / Render(native Ruby) / Vercel / Neon Postgres(pooled)

**設計ドキュメント:** `docs/superpowers/specs/2026-07-25-issue-8-2a-prod-skeleton-design.md`

## Global Constraints

- ブランチは `feature/issue-8-2a`（main から。作成済み）。1 issue = 1 PR。
- **秘密情報をリポジトリ/ログに置かない**。`DATABASE_URL` / `RAILS_MASTER_KEY` 等はダッシュボードで手入力（render.yaml では `sync: false`）。
- `TZ=Asia/Tokyo` は本番で必須（生成回数の日次上限の日付境界がずれるため）。
- Neon は **プール接続文字列**（`-pooler` 付きホスト）を使う。
- `CORS_ALLOWED_ORIGIN_REGEX` は **Vercel チーム slug を必ず含める**（`\A \z` は実装側が付けるので書かない）。
- Ruby はダブルクォート統一（rubocop-rails-omakase）。
- フロントは TailwindCSS。API 呼び出しは通常 `src/lib/api.ts` 経由だが、**スモークUIは一時ツールのため直接 fetch を許容**（レスポンスヘッダの生読みが必要）。
- backend のコード変更は行わない（production.rb は Render と整合済み）。

---

### Task 1: Render デプロイ設定（render.yaml + ビルドスクリプト）

**Files:**
- Create: `render.yaml`（リポジトリ直下）
- Create: `backend/bin/render-build.sh`

**Interfaces:**
- Consumes: 既存の `backend/config/puma.rb`（`PORT` にバインド）、`backend/config/database.yml`（`ENV["DATABASE_URL"]`）、CORS/JWT の env（`CORS_ALLOWED_ORIGINS` / `CORS_ALLOWED_ORIGIN_REGEX` / `JWT_SECRET_KEY`）。
- Produces: Render Blueprint（ネイティブ Ruby web service）。startCommand `bundle exec puma -C config/puma.rb`、buildCommand `./bin/render-build.sh`。

- [ ] **Step 1: `backend/bin/render-build.sh` を作成**

```sh
#!/usr/bin/env bash
# Render のビルドフェーズで実行される。gem 導入と DB マイグレーションを行う。
# API モードのためアセットのプリコンパイルは無い。
set -o errexit

bundle install
bundle exec rails db:migrate
```

- [ ] **Step 2: 実行権限を付与**

Run: `chmod +x backend/bin/render-build.sh`

- [ ] **Step 3: 構文チェック（実行はしない）**

Run: `bash -n backend/bin/render-build.sh`
Expected: エラー出力なし（構文 OK）。

- [ ] **Step 4: `render.yaml` を作成（リポジトリ直下）**

```yaml
# Render Blueprint。Rails をネイティブ Ruby ランタイムでデプロイする。
# 秘密/環境依存の値（sync: false）は Render ダッシュボードで手入力する。
# 手順は docs/deployment.md を参照。
services:
  - type: web
    name: kotoe-api
    runtime: ruby
    rootDir: backend
    region: singapore
    plan: free
    buildCommand: "./bin/render-build.sh"
    startCommand: "bundle exec puma -C config/puma.rb"
    healthCheckPath: /up
    envVars:
      - { key: RAILS_ENV, value: production }
      - { key: TZ, value: Asia/Tokyo }
      - { key: RAILS_MAX_THREADS, value: "3" }
      - { key: JWT_SECRET_KEY, generateValue: true }
      - { key: RAILS_MASTER_KEY, sync: false }
      - { key: DATABASE_URL, sync: false }
      - { key: CORS_ALLOWED_ORIGINS, sync: false }
      - { key: CORS_ALLOWED_ORIGIN_REGEX, sync: false }
```

- [ ] **Step 5: YAML の妥当性を検証**

Run: `ruby -ryaml -e "YAML.load_file('render.yaml'); puts 'yaml ok'"`
Expected: `yaml ok`（パース成功）。

- [ ] **Step 6: Commit**

```bash
git add render.yaml backend/bin/render-build.sh
git commit -m "feat: Render ネイティブ Ruby デプロイ設定（render.yaml + build script）（issue 8-2a）"
```

---

### Task 2: フロント疎通スモークUI（`/smoke`）

**Files:**
- Create: `frontend/src/app/smoke/page.tsx`

**Interfaces:**
- Consumes: 本番/ローカルの Rails API（`/api/health`, `/api/auth/sign_up`, `/api/auth/sign_in`, `/api/me`）、`process.env.NEXT_PUBLIC_API_BASE_URL`。
- Produces: `/smoke` ルート。ボタン押下で疎通を順に実行し、各ステップの成否と Authorization ヘッダの読み取り可否を表示する。

- [ ] **Step 1: `frontend/src/app/smoke/page.tsx` を作成**

```tsx
"use client";

// 一時的な疎通スモークUI（issue 8-2a）。本番の CORS/JWT/Neon 接続を別オリジンの
// ブラウザから確認するための確認専用ページ。ログインUI（7-1/7-2）が載ったら削除する。
// src/lib/api.ts を使わないのは、レスポンスの Authorization ヘッダを生で読む必要が
// あるため（api.ts はボディしか返さない）。CLAUDE.md の「fetch を散らさない」規約の
// 一時的な例外。

import { useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

// スモーク用の固定ユーザー。本番 DB に1件だけゴミ行が残る（cleanup は docs/deployment.md）。
const SMOKE_EMAIL = "smoke@kotoe.test";
const SMOKE_PASSWORD = "smoke-password-1234";

type StepResult = { label: string; ok: boolean; detail: string };

export default function SmokePage() {
  const [results, setResults] = useState<StepResult[]>([]);
  const [running, setRunning] = useState(false);

  async function runSmoke() {
    setRunning(true);
    const steps: StepResult[] = [];
    const push = (r: StepResult) => {
      steps.push(r);
      setResults([...steps]);
    };

    try {
      if (!API_BASE_URL) {
        push({ label: "設定", ok: false, detail: "NEXT_PUBLIC_API_BASE_URL が未設定" });
        return;
      }

      // 1. health（Neon 接続まで含めて生存確認）
      {
        const res = await fetch(`${API_BASE_URL}/api/health`);
        const body = await res.json();
        push({
          label: "GET /api/health",
          ok: res.ok && body.database === "ok",
          detail: `status=${res.status} ${JSON.stringify(body)}`,
        });
      }

      // 2. sign_up（既存なら 422 を許容してスモークを冪等にする）
      {
        const res = await fetch(`${API_BASE_URL}/api/auth/sign_up`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user: { email: SMOKE_EMAIL, password: SMOKE_PASSWORD } }),
        });
        push({
          label: "POST /api/auth/sign_up",
          ok: res.status === 201 || res.status === 422,
          detail: res.status === 201 ? "201 新規作成" : `${res.status}（既存ユーザーとして続行）`,
        });
      }

      // 3. sign_in → Authorization ヘッダを JS から読めるか（CORS expose の核心）
      let token = "";
      {
        const res = await fetch(`${API_BASE_URL}/api/auth/sign_in`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user: { email: SMOKE_EMAIL, password: SMOKE_PASSWORD } }),
        });
        const auth = res.headers.get("Authorization");
        token = auth ?? "";
        push({
          label: "POST /api/auth/sign_in → Authorization 読み取り",
          ok: res.ok && !!auth,
          detail: auth
            ? `status=${res.status} / Authorization を JS から読めた ✅`
            : `status=${res.status} / Authorization が null（CORS expose 未達）`,
        });
      }

      // 4. me（Bearer トークンで認証必須APIを叩く）
      {
        const res = await fetch(`${API_BASE_URL}/api/me`, {
          headers: { Authorization: token },
        });
        const body = await res.json().catch(() => null);
        push({
          label: "GET /api/me (Bearer)",
          ok: res.ok,
          detail: `status=${res.status} ${body ? JSON.stringify(body) : ""}`,
        });
      }
    } catch (e) {
      push({ label: "例外", ok: false, detail: String(e) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="p-6 font-mono">
      <h1 className="text-lg font-bold">8-2a 疎通スモーク（一時ページ）</h1>
      <p className="mt-1 text-sm">API: {API_BASE_URL ?? "(未設定)"}</p>
      <button
        onClick={runSmoke}
        disabled={running}
        className="mt-3 rounded bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        {running ? "実行中…" : "スモーク実行"}
      </button>
      <ul className="mt-4 space-y-1">
        {results.map((r, i) => (
          <li key={i}>
            {r.ok ? "✅" : "❌"} {r.label} — {r.detail}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: 型チェック / lint が通ることを確認**

Run: `docker compose exec frontend npm run lint`
Expected: `/smoke` 由来のエラーが無い（既存 warning はそのまま）。

- [ ] **Step 3: ローカルの実バックエンドに対して動作確認**

`docker compose up`（backend=localhost:3000, frontend=localhost:3001, `NEXT_PUBLIC_API_BASE_URL=http://localhost:3000`）した状態で、ブラウザで `http://localhost:3001/smoke` を開き「スモーク実行」を押す。
Expected: 4ステップすべて ✅。特に sign_in の行で「Authorization を JS から読めた ✅」が出る（2-2 でローカル CORS は確認済みなので、ここでページのロジック自体を先に検証する）。

- [ ] **Step 4: スモークで作ったローカルユーザーを掃除**

Run: `docker compose exec backend bin/rails runner "User.where(email: 'smoke@kotoe.test').destroy_all"`
Expected: エラーなし。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/smoke/page.tsx
git commit -m "feat: 疎通スモークUI（/smoke、一時ページ）（issue 8-2a）"
```

---

### Task 3: デプロイ運用ドキュメント（`docs/deployment.md`）

**Files:**
- Create: `docs/deployment.md`

**Interfaces:**
- Consumes: Task 1 の `render.yaml`（env var 名）、Task 2 の `/smoke`。
- Produces: Neon/Render/Vercel のダッシュボード手順・環境変数表・デプロイ順序・cleanup 手順。ユーザーが Task 5 で参照する。

- [ ] **Step 1: `docs/deployment.md` を作成**

以下の内容を含める（見出し単位で漏れなく）：

1. **概要**: 本番は Render(Rails ネイティブ Ruby) / Vercel(Next.js) / Neon(Postgres)。この文書は 8-2a スケルトンの立ち上げ手順。
2. **環境変数表（Render）**: 下表をそのまま載せる。

   | 変数 | 出所 | 値 / 備考 |
   |---|---|---|
   | `RAILS_ENV` | render.yaml | `production` |
   | `TZ` | render.yaml | `Asia/Tokyo`（必須） |
   | `RAILS_MAX_THREADS` | render.yaml | `3` |
   | `JWT_SECRET_KEY` | Render 自動生成 | devise-jwt 署名鍵 |
   | `RAILS_MASTER_KEY` | 手入力 | `backend/config/master.key` の中身 |
   | `DATABASE_URL` | 手入力 | Neon の**プール接続文字列**（`-pooler` ホスト） |
   | `CORS_ALLOWED_ORIGINS` | 手入力 | Vercel 本番URL（完全一致） |
   | `CORS_ALLOWED_ORIGIN_REGEX` | 手入力 | Vercel プレビュー用。**チーム slug を含める** |

3. **環境変数（Vercel）**: `NEXT_PUBLIC_API_BASE_URL` = Render の URL。Root Directory = `frontend`。
4. **デプロイ順序**（chicken-egg 解消。Task 5 と同一）:
   1. Neon で DB 作成 → プール接続文字列コピー。
   2. Render で Service 作成（Blueprint=`render.yaml` or 手動）、`DATABASE_URL`/`RAILS_MASTER_KEY`/`TZ` 設定。CORS はまず `CORS_ALLOWED_ORIGIN_REGEX`（Vercel プレビュー slug）だけ入れて boot を通す。デプロイ → curl で疎通。
   3. Vercel で Project 作成（Root=`frontend`）、`NEXT_PUBLIC_API_BASE_URL`=Render URL → デプロイ。
   4. Render に `CORS_ALLOWED_ORIGINS`=Vercel 本番URL を追加保存（再起動）。
   5. ブラウザで Vercel の `/smoke` を実行 → CORS/JWT 実機確認。
5. **curl スモーク例**（`$API` は Render URL）:

   ```bash
   curl -s "$API/api/health"
   curl -si -X POST "$API/api/auth/sign_in" \
     -H "Content-Type: application/json" \
     -d '{"user":{"email":"smoke@kotoe.test","password":"smoke-password-1234"}}' \
     | grep -i "^authorization:"
   ```

6. **Vercel プレビューの継続検証**: プレビューURLは `CORS_ALLOWED_ORIGIN_REGEX` でカバーされ、`NEXT_PUBLIC_API_BASE_URL` は本番バックエンド（スケルトン）を指す。以降 PR ごとにプレビューでつなぎ目を継続検証する。
7. **スモークユーザーの cleanup**: Render Shell で `bin/rails runner "User.where(email: 'smoke@kotoe.test').destroy_all"`。
8. **注意**: free プランはスリープ（~15分無操作で spin down、コールドスタート数十秒）。Neon はプール接続を使う。カスタムドメイン/DNS・Cloudinary・画像生成キーは範囲外（8-2b / 3-1 / 4-3）。

- [ ] **Step 2: 内容の自己確認**

Run: `grep -c "CORS_ALLOWED_ORIGIN_REGEX\|DATABASE_URL\|NEXT_PUBLIC_API_BASE_URL\|-pooler" docs/deployment.md`
Expected: 主要 env 名と `-pooler` が本文に含まれる（0 でない）。

- [ ] **Step 3: Commit**

```bash
git add docs/deployment.md
git commit -m "docs: 本番デプロイ手順と環境変数（issue 8-2a）"
```

---

### Task 4: backlog 2-2 チェックボックス更新（申し送り対応）

**Files:**
- Modify: `docs/issues_backlog.md`（2-2 のタスク、105–107 行付近）

**Interfaces:**
- Consumes: なし。
- Produces: 2-2 の実態に合ったチェック状態（露出設定・request spec は完了、本番オリジンは 8-2a 委譲の注記）。

- [ ] **Step 1: 2-2 のタスク3項目を書き換える**

対象（現状）:

```
  - [ ] Authorization ヘッダの露出設定（`expose: ["Authorization"]`）
  - [ ] 本番（Vercel）のオリジンを許可オリジンに追加
  - [ ] request spec（許可オリジンからの認証API呼び出しで JWT を受け取れる）
```

書き換え後:

```
  - [x] Authorization ヘッダの露出設定（`expose: ["Authorization"]`）
  - 許可オリジンの env 化（`CORS_ALLOWED_ORIGINS` / `CORS_ALLOWED_ORIGIN_REGEX`）と production 未設定時の fail-fast は実装済み（0-3・2-2）。**本番 Vercel オリジンの実値投入は 8-2a に委譲**（Vercel URL 確定後に Render の env へ設定するため、ここではチェックしない）。
  - [x] request spec（許可オリジンからの認証API呼び出しで JWT を受け取れる）
```

- [ ] **Step 2: 差分を確認**

Run: `git diff docs/issues_backlog.md`
Expected: 2-2 の3項目だけが変わり、8-2a 委譲の注記が入っている。他 issue は無変更。

- [ ] **Step 3: Commit**

```bash
git add docs/issues_backlog.md
git commit -m "docs: 2-2 チェックボックス更新（本番オリジンは 8-2a へ委譲の注記）"
```

---

### Task 5: 【USER 実施】ダッシュボードでの本番デプロイ＋疎通スモーク

> このタスクはブラウザのダッシュボード操作のため、ユーザーが手を動かす（Claude は代行不可）。`docs/deployment.md` の順序に従う。各ステップの結果を PR 説明に記録する。

- [ ] **Step 1: Neon** — プロジェクト/DB 作成 → **プール接続文字列**（`-pooler` ホスト）をコピー。
- [ ] **Step 2: Render** — Web Service 作成（`render.yaml` の Blueprint か手動）。`DATABASE_URL`=Neon プール文字列、`RAILS_MASTER_KEY`=`backend/config/master.key` の中身、`TZ`=`Asia/Tokyo` を設定。`CORS_ALLOWED_ORIGIN_REGEX`=Vercel プレビュー用（チーム slug 込み）だけ先に入れて boot を通す。デプロイ実行。
- [ ] **Step 3: curl 疎通** — Render URL に対し `/api/health` が `database: ok`、`sign_in` のレスポンスに `Authorization:` ヘッダが載ることを確認（`docs/deployment.md` の curl 例）。
   Expected: health ok / Authorization ヘッダあり。
- [ ] **Step 4: Vercel** — Project 作成（Root Directory=`frontend`）、`NEXT_PUBLIC_API_BASE_URL`=Render URL を設定 → デプロイ → 本番URL確定。
- [ ] **Step 5: Render** — `CORS_ALLOWED_ORIGINS`=Vercel 本番URL を追加保存（Render が再起動）。
- [ ] **Step 6: ブラウザスモーク** — Vercel の `/smoke` を開き「スモーク実行」。
   Expected: 4ステップ ✅、sign_in の行で「Authorization を JS から読めた ✅」。
- [ ] **Step 7: cleanup** — Render Shell で `bin/rails runner "User.where(email: 'smoke@kotoe.test').destroy_all"`。

---

### Task 6: 8-2a 完了チェック更新＋PR

**Files:**
- Modify: `docs/issues_backlog.md`（8-2a のタスク、269–273 行付近）

- [ ] **Step 1: 8-2a のチェックボックスを完了に更新**

Task 5 のスモークが green になったら、8-2a の3タスク（最小構成デプロイ / 疎通スモーク / Vercel プレビューの向き先設定）を `[x]` にする。

- [ ] **Step 2: Commit**

```bash
git add docs/issues_backlog.md
git commit -m "docs: 8-2a 完了チェック（本番スケルトン疎通 green）"
```

- [ ] **Step 3: push して PR 作成**

```bash
git push -u origin feature/issue-8-2a
gh pr create --base main --title "feat: 本番環境スケルトン＋疎通スモーク（issue 8-2a）" --body "$(cat <<'BODY'
## 概要
Render(Rails ネイティブ Ruby) / Vercel(Next.js) / Neon(Postgres) を最小構成で本番デプロイし、CORS/JWT・Neon プール接続を別オリジンのブラウザから疎通確認できるようにした（issue 8-2a）。あわせて 2-2 のチェックボックス申し送りを解消。

## 成果物
- `render.yaml` + `backend/bin/render-build.sh`（Render ネイティブ Ruby）
- `frontend/src/app/smoke/page.tsx`（一時スモークUI、7-1 で削除予定）
- `docs/deployment.md`（ダッシュボード手順・env 表・デプロイ順序）
- `docs/issues_backlog.md`（2-2 委譲注記 / 8-2a 完了）

## 疎通結果
- 本番 `/api/health` = database ok（Neon プール接続）
- ブラウザ `/smoke` で Authorization ヘッダを JS から読めた（CORS/JWT 実機 OK）

## 備考
- backend のコード変更は無し。カスタムドメイン/DNS・Cloudinary・画像生成キーは範囲外。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

## Self-Review

**Spec coverage:**
- render.yaml / build script → Task 1 ✅
- スモークUI → Task 2 ✅
- deployment.md（手順・env・順序・cleanup・プレビュー継続検証）→ Task 3 ✅
- 2-2 チェックボックス更新（part B）→ Task 4 ✅
- ダッシュボードデプロイ＋curl＋ブラウザスモーク（完了条件）→ Task 5 ✅
- 8-2a チェック更新＋PR → Task 6 ✅
- 「backend コード変更なし」制約 → 全タスクで backend の app コードに触れない ✅

**Placeholder scan:** コード/コマンドは実値。TBD/TODO なし ✅

**Type consistency:** env 名（`CORS_ALLOWED_ORIGINS` / `CORS_ALLOWED_ORIGIN_REGEX` / `JWT_SECRET_KEY` / `DATABASE_URL` / `RAILS_MASTER_KEY` / `NEXT_PUBLIC_API_BASE_URL`）、スモークの固定ユーザー（`smoke@kotoe.test` / `smoke-password-1234`）、エンドポイントの body 形状（`{ user: { email, password } }`）が Task 間・design と一致 ✅
