# スマートフォン実機から開発サーバーを開けるようにする 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同じ Wi-Fi のスマートフォンから `http://<Mac>:3001` を開き、**API を叩く画面まで含めて**動作確認できるようにする。環境変数を設定しなければ従来どおり動く。

**Architecture:** Next.js の `allowedDevOrigins` を環境変数 `DEV_ALLOWED_HOSTS` から組み立てる。突き合わせは「オリジン」ではなく**ホスト名**で行われるため、どの書式で書かれても同じ結果になるよう正規化する純粋関数 `parseAllowedDevHosts` を `src/lib/dev/` に切り出し、Vitest で守る。`next.config.ts` はその戻り値が空でなければキーを足すだけ。API の向き先（`NEXT_PUBLIC_API_BASE_URL`）と Rails 側（`CORS_ALLOWED_ORIGINS` / `RAILS_DEVELOPMENT_HOSTS`）は**すでに環境変数化されている**ので、コードは変更せず `.env.example` と手順書だけを整える。

**Tech Stack:** Next.js 16.2.10（App Router）／ TypeScript ／ Vitest ／ Rails 8.1（変更なし）／ Docker Compose。**新しい依存は追加しない。**

**Spec:** `docs/superpowers/specs/2026-09-21-issue-0-6-lan-dev-access-design.md`

**Issue:** GitHub #107（`docs/issues_backlog.md` 0-6）

**Branch:** `feat/lan-dev-access`（作成済み。設計書のコミット `8224f96` が載っている）

## Global Constraints

このプロジェクト全体の規約。**全タスクの要件に暗黙に含まれる。**

- **依存パッケージを追加しない。** `frontend/package.json` は変更しない。
- **`backend/` のコードは 1 行も変更しない。** Rails 側は `.env.example` の記述だけ。
- **文字列はダブルクォート。** コメントは日本語。
- **実 IP・実ホスト名を、コミットされるファイルに書かない。** `.env.example` / `AGENTS.md` /
  コミットメッセージ / PR 本文に書いてよいのはプレースホルダだけ（`192.168.1.10` のような
  例示用の値、または `<Mac のホスト名>.local`）。実値は gitignore 済みの `.env.development` にだけ書く。
- **`main` へ直接コミットしない。** 作業は `feat/lan-dev-access` 上で行う。
- **テストは `frontend/test/` に置き、`src/` の構造を写す。** コンポーネントテストは書かない。
- コマンドはリポジトリのルートで実行する。`npm` 系は `docker compose exec frontend <コマンド>` で
  コンテナ内で動かす（CLAUDE.md「よく使うコマンド」に合わせる）。
- **`.env.development` を書き換えたら `docker compose restart` ではなく `docker compose up -d` で
  作り直す。** `restart` では `env_file` の変更が反映されない。

## File Structure

| ファイル | 責務 |
|---|---|
| `frontend/src/lib/dev/allowed-dev-hosts.ts`（新規） | `DEV_ALLOWED_HOSTS` の文字列を、Next が比較するホスト名の配列へ正規化する。Next も DOM も知らない純粋関数 |
| `frontend/test/lib/dev/allowed-dev-hosts.test.ts`（新規） | 上の Vitest |
| `frontend/next.config.ts`（変更） | 上の戻り値が空でなければ `allowedDevOrigins` に渡すだけ |
| `frontend/.env.example`（変更） | `DEV_ALLOWED_HOSTS` と、実機確認時の `NEXT_PUBLIC_API_BASE_URL` の書き換え方 |
| `.env.example`（変更） | `CORS_ALLOWED_ORIGINS` への追記例と `RAILS_DEVELOPMENT_HOSTS` |
| `frontend/AGENTS.md`（変更） | 実機確認の手順と、症状からの切り分け |
| `docs/issues_backlog.md`（変更） | 0-6 のタスクのチェックを埋める |

判定ロジックを `next.config.ts` に直接書かず 1 ファイルに切り出すのは、**ここが無言で失敗する箇所**だから。
`next.config.ts` の中身はテストできないが、切り出せば書式ごとの挙動を Vitest で固定できる。

---

### Task 1: `DEV_ALLOWED_HOSTS` を正規化する純粋関数

**Files:**
- Create: `frontend/src/lib/dev/allowed-dev-hosts.ts`
- Test: `frontend/test/lib/dev/allowed-dev-hosts.test.ts`

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces:
  - `export function parseAllowedDevHosts(raw: string | undefined): string[]`
    - 未設定・空・空白のみ → `[]`
    - カンマ区切りの各要素をホスト名へ正規化した配列
    - 解釈できない値があれば `Error` を投げる

**背景（実装者向け）:** Next.js の dev サーバーは `/_next/*` へのクロスオリジンアクセスを既定でブロックする。
許可リスト `allowedDevOrigins` の突き合わせは
`frontend/node_modules/next/dist/server/lib/router-utils/block-cross-site-dev.js` が行い、
`Origin`（無ければ `Referer`）を URL パースした **`hostname`** と比較する。
オリジン形式（`http://192.168.1.10:3001`）を渡すと、**エラーも警告も出ないまま一致せず**ブロックが続く。
症状は「設定する前」と区別が付かない（＝ボタンが無反応、`useEffect` が走らない）。
この無言の失敗を消すのがこのタスクの目的。

- [ ] **Step 1: 失敗するテストを書く**

`frontend/test/lib/dev/allowed-dev-hosts.test.ts`：

```ts
import { describe, expect, it } from "vitest";

import { parseAllowedDevHosts } from "@/lib/dev/allowed-dev-hosts";

describe("parseAllowedDevHosts", () => {
  // 未設定なら next.config.ts 側が allowedDevOrigins ごと省く。
  // 他の開発者・CI・本番の挙動を現状から変えないための入口。
  it("未設定・空文字・空白のみなら空配列を返す", () => {
    expect(parseAllowedDevHosts(undefined)).toEqual([]);
    expect(parseAllowedDevHosts("")).toEqual([]);
    expect(parseAllowedDevHosts("   ")).toEqual([]);
  });

  it("ホスト名はそのまま通す", () => {
    expect(parseAllowedDevHosts("192.168.1.10")).toEqual(["192.168.1.10"]);
    expect(parseAllowedDevHosts("my-mac.local")).toEqual(["my-mac.local"]);
  });

  // ここが本題。Next はホスト名としか比較しないので、オリジン形式のまま渡すと
  // 無言で効かない。隣に書く NEXT_PUBLIC_API_BASE_URL からコピペしても動くようにする。
  it("オリジン形式で書かれてもホスト名だけを取り出す", () => {
    expect(parseAllowedDevHosts("http://192.168.1.10:3001")).toEqual(["192.168.1.10"]);
    expect(parseAllowedDevHosts("https://my-mac.local")).toEqual(["my-mac.local"]);
  });

  // "my-mac.local:3001" は URL パーサに素で渡すと "my-mac.local:" がスキーム扱いになり、
  // hostname が空文字になる。スキームを補ってから解析する必要がある。
  it("host:port で書かれてもホスト名だけを取り出す", () => {
    expect(parseAllowedDevHosts("192.168.1.10:3001")).toEqual(["192.168.1.10"]);
    expect(parseAllowedDevHosts("my-mac.local:3001")).toEqual(["my-mac.local"]);
  });

  // Next 側（csrf-protection.js の isCsrfOriginAllowed）がドット区切りの
  // ワイルドカードを解釈する。正規化で壊さないこと。
  it("ワイルドカードを壊さない", () => {
    expect(parseAllowedDevHosts("192.168.*.*")).toEqual(["192.168.*.*"]);
  });

  it("大文字のホスト名は小文字化する", () => {
    expect(parseAllowedDevHosts("My-Mac.local")).toEqual(["my-mac.local"]);
  });

  it("カンマ区切りで複数指定でき、空要素は捨てる", () => {
    expect(parseAllowedDevHosts("192.168.1.10, my-mac.local")).toEqual([
      "192.168.1.10",
      "my-mac.local",
    ]);
    expect(parseAllowedDevHosts("192.168.1.10,,my-mac.local,")).toEqual([
      "192.168.1.10",
      "my-mac.local",
    ]);
  });

  // 黙って捨てると「設定したのに無反応」に戻る。dev 専用の設定なので落として気づかせる。
  it("解釈できない値は例外にする（メッセージに元の値を含む）", () => {
    expect(() => parseAllowedDevHosts("not a host")).toThrow(/not a host/);
  });
});
```

- [ ] **Step 2: テストを実行して失敗することを確かめる**

```bash
docker compose exec frontend npx vitest run test/lib/dev/allowed-dev-hosts.test.ts
```

Expected: FAIL。`Failed to resolve import "@/lib/dev/allowed-dev-hosts"` が出る。

- [ ] **Step 3: 実装する**

`frontend/src/lib/dev/allowed-dev-hosts.ts`：

```ts
/**
 * `DEV_ALLOWED_HOSTS` を Next.js の `allowedDevOrigins` に渡す形へ正規化する。
 *
 * Next の dev サーバーは `/_next/*` へのクロスオリジンアクセスを既定でブロックする。
 * 突き合わせは「オリジン」ではなく **ホスト名** で行われる
 * （`node_modules/next/dist/server/lib/router-utils/block-cross-site-dev.js` が
 * `Origin` / `Referer` を URL パースし、`hostname` だけを比較する）。
 *
 * つまり `http://192.168.1.10:3001` のようなオリジン形式を渡すと、エラーも警告も
 * 出ないまま一致せず、ブロックが続く。SSR された HTML は表示されるのに
 * クライアント JS だけが動かないため、症状は「実装が壊れている」ようにしか見えない。
 * その事故を防ぐため、ホスト名・`host:port`・オリジンのどれで書かれても
 * 同じ結果になるよう URL パーサ 1 本に寄せる。
 *
 * この値が効くのは dev サーバーだけで、本番ビルドには影響しない。
 */
export function parseAllowedDevHosts(raw: string | undefined): string[] {
  if (!raw) return [];

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "")
    .map(toHostname);
}

function toHostname(value: string): string {
  // スキームが無ければ補う。"my-mac.local:3001" をそのまま URL に渡すと
  // "my-mac.local:" がスキームとして解釈され、hostname が空文字になる。
  const withScheme = value.includes("://") ? value : `http://${value}`;

  try {
    return new URL(withScheme).hostname;
  } catch {
    throw new Error(
      `DEV_ALLOWED_HOSTS の値を解釈できません: ${JSON.stringify(value)}。` +
        "ホスト名（192.168.1.10 / my-mac.local）か、" +
        "オリジン（http://192.168.1.10:3001）の形で書いてください。",
    );
  }
}
```

- [ ] **Step 4: テストを実行して通ることを確かめる**

```bash
docker compose exec frontend npx vitest run test/lib/dev/allowed-dev-hosts.test.ts
```

Expected: PASS（8 件）。

- [ ] **Step 5: lint と既存テストを通す**

```bash
docker compose exec frontend npm run lint
docker compose exec frontend npm run test
```

Expected: どちらもエラーなし。

- [ ] **Step 6: コミット**

```bash
git add frontend/src/lib/dev/allowed-dev-hosts.ts frontend/test/lib/dev/allowed-dev-hosts.test.ts
git commit -F - <<'EOF'
feat: DEV_ALLOWED_HOSTS をホスト名へ正規化する関数を追加する

allowedDevOrigins はオリジンではなくホスト名と比較される。オリジン形式を
渡しても無言で一致しないため、どの書式で書かれても同じ結果になるよう
URL パーサ 1 本に寄せる。解釈できない値は例外にして起動を止める。

Refs #107

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: `next.config.ts` に組み込み、ブロックが解けることをローカルで確かめる

**Files:**
- Modify: `frontend/next.config.ts`（全文を置き換える）

**Interfaces:**
- Consumes: `parseAllowedDevHosts(raw: string | undefined): string[]`（Task 1）
- Produces: 環境変数 `DEV_ALLOWED_HOSTS`（コンテナに渡る）で `allowedDevOrigins` が決まる状態

**このタスクの検証はスマホ不要。** `curl` に `Origin` / `Referer` を付ければブロックを再現でき、
**403 = ブロック中 / 404 = 許可済み**で判定できる（`/_next/` 配下の存在しないパスを叩く。
ブロックはルーティングより前に効くため、許可されていれば通常の 404 になる）。

- [ ] **Step 1: `next.config.ts` を書き換える**

`frontend/next.config.ts`（全文）：

```ts
import type { NextConfig } from "next";

// `@/` エイリアスではなく相対パスで import している。既定の経路（SWC + require
// フック）では tsconfig の paths が渡るので `@/` でも解決できるが、
// `--experimental-next-config-strip-types` を付けたときの Node のネイティブ TS 解決
// では効かない。拡張子を省いてあるのは、`.ts` を付けると tsc が TS5097 で落ちるため。
import { parseAllowedDevHosts } from "./src/lib/dev/allowed-dev-hosts";

// スマホ実機から開発サーバーを開くときだけ設定する（手順は AGENTS.md）。
// 未設定なら allowedDevOrigins ごと省くので、従来どおりの挙動になる。
// dev サーバー専用の設定で、本番ビルドには影響しない。
const allowedDevHosts = parseAllowedDevHosts(process.env.DEV_ALLOWED_HOSTS);

const nextConfig: NextConfig = {
  ...(allowedDevHosts.length > 0 ? { allowedDevOrigins: allowedDevHosts } : {}),
};

export default nextConfig;
```

- [ ] **Step 2: 未設定のままブロックが続くことを確認する（回帰）**

```bash
docker compose up -d frontend
docker compose exec frontend rm -rf .next && docker compose restart frontend
# 起動を待ってから
curl -s -o /dev/null -w "same-origin:%{http_code}\n" \
  -H "Origin: http://localhost:3001" -H "Referer: http://localhost:3001/" \
  http://localhost:3001/_next/static/chunks/does-not-exist.js
curl -s -o /dev/null -w "cross-origin:%{http_code}\n" \
  -H "Origin: http://192.168.1.10:3001" -H "Referer: http://192.168.1.10:3001/" \
  http://localhost:3001/_next/static/chunks/does-not-exist.js
```

Expected: `same-origin:404` / `cross-origin:403`。
ブラウザで `http://localhost:3001/` を開き、従来どおり動くことも見る。

- [ ] **Step 3: 一時的に `DEV_ALLOWED_HOSTS` を入れて、ブロックが解けることを確認する**

`frontend/.env.development` の末尾に 1 行足す（このファイルは gitignore 済み）。
**Step 2 の curl と同じ値を使うこと**（ここでは例示用の `192.168.1.10`）。

```bash
echo 'DEV_ALLOWED_HOSTS=192.168.1.10' >> frontend/.env.development
docker compose up -d frontend   # restart では env_file の変更が反映されない
# 起動を待ってから
curl -s -o /dev/null -w "cross-origin:%{http_code}\n" \
  -H "Origin: http://192.168.1.10:3001" -H "Referer: http://192.168.1.10:3001/" \
  http://localhost:3001/_next/static/chunks/does-not-exist.js
```

Expected: `cross-origin:404`（ブロックが解けた）。403 のままなら値の形式か再起動を疑う。

- [ ] **Step 4: 不正な値で起動が止まることを確認する**

Step 3 で足した行を一時的に `DEV_ALLOWED_HOSTS=not a host` に書き換えて作り直す。

```bash
docker compose up -d frontend
docker compose logs --tail=30 frontend
```

Expected: dev サーバーが起動せず、ログに
`DEV_ALLOWED_HOSTS の値を解釈できません: "not a host"` を含むエラーが出る。
**もし警告だけ出して起動してしまう場合は、そのまま進めずに報告すること**
（「不正な値は落とす」は設計の決定 3 で、無言の失敗を避けるための要）。

**`next build` をここで使わないこと。** `next.config.ts` の読み込みだけを確かめるつもりで
`npx next build --help` を叩くと実際にビルドが走り、dev サーバーと同居したコンテナが
メモリ不足で落ちる（2026-09-21 に exit 137 で発生。`next.config.ts` が壊れたまま残った）。

- [ ] **Step 5: 実験用の行を戻す**

```bash
# 末尾に足した DEV_ALLOWED_HOSTS の行をエディタで削除する（Step 4 の不正値も消える）
docker compose up -d frontend
curl -s -o /dev/null -w "cross-origin:%{http_code}\n" \
  -H "Origin: http://192.168.1.10:3001" -H "Referer: http://192.168.1.10:3001/" \
  http://localhost:3001/_next/static/chunks/does-not-exist.js
```

Expected: `cross-origin:403`（未設定時の挙動に戻った）。

- [ ] **Step 6: lint と型検査を通す**

```bash
docker compose exec frontend npm run lint
docker compose exec frontend npx tsc --noEmit
```

Expected: どちらもエラーなし。

- [ ] **Step 7: コミット**

```bash
git add frontend/next.config.ts
git commit -F - <<'EOF'
feat: allowedDevOrigins を DEV_ALLOWED_HOSTS から組み立てる

未設定ならキーごと省くため、従来の挙動は変わらない。import を相対パスに
するのは、--experimental-next-config-strip-types を付けたときに使われる Node の
ネイティブ TS 解決では tsconfig の paths が効かないため。既定の経路では効く。

Refs #107

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: 環境変数の例と、実機確認の手順書

**Files:**
- Modify: `frontend/.env.example`（末尾に追記）
- Modify: `.env.example`（`CORS_ALLOWED_ORIGINS` の節に追記）
- Modify: `frontend/AGENTS.md`（末尾に節を追加）

**Interfaces:**
- Consumes: `DEV_ALLOWED_HOSTS`（Task 2 で `next.config.ts` が読む）
- Produces: なし（文書のみ）

**Rails 側にコードの変更は無い。** `CORS_ALLOWED_ORIGINS` はすでにカンマ区切りで
`backend/lib/cors/allowed_origins.rb` が読み、`RAILS_DEVELOPMENT_HOSTS` は Rails が
development でのみ `config.hosts` に足す。どちらも `.env.development` に書くだけで効く。

- [ ] **Step 1: `frontend/.env.example` に追記する**

末尾に足す：

```bash
# --- スマホ実機から開発サーバーを開くとき（issue 0-6）---
# 手順と切り分けは frontend/AGENTS.md を参照。普段の開発では設定しない。
#
# Next.js は /_next/* へのクロスオリジンアクセスを既定でブロックする。設定しないと、
# スマホでは画面は出るのにボタンが無反応（＝ハイドレーションが完了しない）になる。
# 値はホスト名（192.168.1.10 / my-mac.local）。カンマ区切りで複数可。
# http://192.168.1.10:3001 のようなオリジン形式で書いても受け付ける。
# DEV_ALLOWED_HOSTS=my-mac.local

# 実機確認のあいだは、上と同じホストに向ける（スマホから見た localhost はスマホ自身のため）。
# 確認が終わったら localhost に戻す。
# NEXT_PUBLIC_API_BASE_URL=http://my-mac.local:3000
```

- [ ] **Step 2: ルートの `.env.example` に追記する**

`CORS_ALLOWED_ORIGINS=http://localhost:3001` の行のすぐ下に足す：

```bash
# スマホ実機から確認するとき（issue 0-6）は、同じホストの :3001 を足す。
# 例：CORS_ALLOWED_ORIGINS=http://localhost:3001,http://my-mac.local:3001

# `.local`（Bonjour 名）で開く場合のみ必要。Rails の開発環境のホスト認証は
# .localhost / .test と任意の IP しか許していないため、.local は 403 になる。
# IP で開く場合は不要。
# RAILS_DEVELOPMENT_HOSTS=my-mac.local
```

- [ ] **Step 3: `frontend/AGENTS.md` に手順の節を足す**

末尾に足す：

````markdown
## スマホ実機から開発サーバーを開く（issue 0-6）

モバイル幅を実機で確認するときの手順。**普段の開発では何も設定しない**（設定しなければ
従来どおり動く）。

### 何もしないとどうなるか

Next.js は `/_next/*` へのクロスオリジンアクセスを既定でブロックする。HTML は SSR される
ので画面は出るが、クライアント JS が動かずハイドレーションが完了しない。

| 見え方 | 実際 |
|---|---|
| ボタンをタップしても無反応 | `onClick` が繋がっていない |
| 「確認中…」のまま（エラー表示にもならない） | `useEffect` が走っていない |

**どちらも実装が壊れているようにしか見えない。** 切り分けは下の「症状から原因へ」を見る。

### 手順

1. Mac 側で**ホスト名か IP を調べる**（コンテナ内では取れない。docker のブリッジ IP しか返らない）

   ```bash
   scutil --get LocalHostName   # → <名前>.local で到達できる。DHCP で変わらないのでこちらを推奨
   ipconfig getifaddr en0       # → IP。スマホが .local を解決できないときはこちら
   ```

   `.local`（mDNS）は iOS / Safari なら標準で解決する。Android は端末とブラウザによる。
   解決できないときは「サーバーが見つかりません」と出るだけなので、IP に切り替えればよい。

2. 調べたホストを **3〜4 か所**に書く（`.env.development` は gitignore 済み。実値をコミットしない）

   | ファイル | 変数 | 値の例 |
   |---|---|---|
   | `frontend/.env.development` | `DEV_ALLOWED_HOSTS` | `my-mac.local` |
   | `frontend/.env.development` | `NEXT_PUBLIC_API_BASE_URL` | `http://my-mac.local:3000` |
   | `.env.development` | `CORS_ALLOWED_ORIGINS` | `http://localhost:3001,http://my-mac.local:3001` |
   | `.env.development` | `RAILS_DEVELOPMENT_HOSTS` | `my-mac.local`（**`.local` のときだけ**。IP なら不要） |

3. 作り直す。**`restart` では `env_file` の変更が反映されない**

   ```bash
   docker compose up -d frontend backend
   ```

4. スマホで `http://my-mac.local:3001/` を開く

確認が終わったら `NEXT_PUBLIC_API_BASE_URL` を `http://localhost:3000` に戻す
（`DEV_ALLOWED_HOSTS` と `CORS_ALLOWED_ORIGINS` は残しても普段の開発に影響しない）。

### 症状から原因へ

| 症状 | 原因 | 直し方 |
|---|---|---|
| 画面は出るがタップしても無反応 | Next のクロスオリジンブロック | dev ログに `⚠ Blocked cross-origin request to Next.js dev resource /_next/... from "<host>"` が出る。その `<host>` と `DEV_ALLOWED_HOSTS` が一致しているか見る |
| API だけ 403（Rails の例外ページが返る） | Rails のホスト認証 | `RAILS_DEVELOPMENT_HOSTS` を足す。`config.hosts` は `.localhost` / `.test` と任意の IP しか許していない |
| API が CORS エラー | 許可オリジン不足 | `CORS_ALLOWED_ORIGINS` に `http://<host>:3001` を足す |
| サーバーが見つかりません | mDNS を解決できない端末 | IP に切り替える |
| 設定したのに変わらない | `restart` で env が反映されていない | `docker compose up -d` で作り直す |

### スマホを出さずに確認する

ブロックの判定は `Origin` / `Referer` ヘッダだけを見るので、**`curl` で再現できる**。
`/_next/` 配下の存在しないパスを叩き、**403 ならブロック中・404 なら許可済み**と読む
（ブロックはルーティングより前に効くため）。

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Origin: http://my-mac.local:3001" -H "Referer: http://my-mac.local:3001/" \
  http://localhost:3001/_next/static/chunks/does-not-exist.js
```

**ヘッダを付けない `curl` では再現しない**（既定で `Origin` も `Referer` も送らないため 200 が返る）。
7-2.5 の実機確認では、これで「問題なし」と誤判定した。

### 値の書式

`DEV_ALLOWED_HOSTS` は **ホスト名**で比較される（Next が `Origin` を URL パースして
`hostname` だけを見る）。`src/lib/dev/allowed-dev-hosts.ts` が `http://host:3001` や
`host:3001` もホスト名へ正規化するので、隣の `NEXT_PUBLIC_API_BASE_URL` からコピペしても効く。
`192.168.*.*` のようなワイルドカードも書ける（同じ LAN 上の任意のホストが発信元として
許可される点は理解した上で使うこと）。解釈できない値を書くと dev サーバーの起動時に落ちる。
````

- [ ] **Step 4: 追記した内容が実態と合っているか確かめる**

```bash
grep -n "DEV_ALLOWED_HOSTS" frontend/.env.example
grep -n "RAILS_DEVELOPMENT_HOSTS\|CORS_ALLOWED_ORIGINS" .env.example
grep -rn "192\.168\.1\.[0-9]\+" frontend/.env.example .env.example frontend/AGENTS.md
```

Expected: 前の 2 つは追記が出る。3 つ目で出てよいのは例示用の `192.168.1.10` だけで、
**自分の実 IP が出てはいけない**。

- [ ] **Step 5: コミット**

```bash
git add frontend/.env.example .env.example frontend/AGENTS.md
git commit -F - <<'EOF'
docs: スマホ実機から開発サーバーを開く手順を追加する

症状（タップしても無反応）が実装バグに見えるため、切り分け表とセットで書く。
Origin/Referer を付けた curl で、実機を出さずにブロックを再現できることも残す。

Refs #107

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: 実機での確認、backlog の更新、PR

**Files:**
- Modify: `docs/issues_backlog.md`（0-6 のチェックボックス）

**Interfaces:**
- Consumes: Task 1〜3 のすべて
- Produces: なし（この issue の完了）

**Step 1〜3 はユーザーのスマホが要る。** 実装者はここで手を止め、ユーザーに手順を渡して
結果を聞くこと。勝手に「動いたはず」と書かない。

- [ ] **Step 1: ユーザーに実機確認を依頼する**

`frontend/AGENTS.md` に書いた手順どおり、ユーザーに次を依頼する。
値（ホスト名・IP）は**ユーザーの環境のものを使い、会話やコミットに残さない**。

1. `scutil --get LocalHostName` の結果を使って 4 か所を設定
2. `docker compose up -d frontend backend`
3. スマホで `http://<ホスト>:3001/` を開く

- [ ] **Step 2: 確認項目を伝えて、結果を聞く**

- [ ] トップページが表示され、**ボタンのタップに反応する**（＝ハイドレーションが完了している）
- [ ] ログインできる（＝API に届き、CORS も通っている）
- [ ] ログイン後の画面を**リロード**しても状態が保たれる
- [ ] トーストが出る
- [ ] その間、`docker compose logs frontend` に `Blocked cross-origin request` が出ていない

`.local` で API だけ 403 になった場合は `RAILS_DEVELOPMENT_HOSTS` の設定漏れ。
mDNS が解決できない端末だった場合は IP に切り替え、**その結果を AGENTS.md に 1 行足す**
（どの端末で解決できたか／できなかったかは次回の判断材料になる）。

- [ ] **Step 3: 設定を戻して、従来どおり動くことを確かめる**

`NEXT_PUBLIC_API_BASE_URL` を `http://localhost:3000` に戻し、`docker compose up -d frontend backend`。
Mac のブラウザで `http://localhost:3001/` を開き、ログインできることを確認する。

- [ ] **Step 4: backlog のチェックを埋める**

`docs/issues_backlog.md` の 0-6 のタスクを次のとおり更新する（`[ ]` → `[x]`、2 つ目は決定内容を追記）：

```markdown
- タスク：
  - [x] `allowedDevOrigins` を環境変数から組み立てる（未設定時は現状どおり）
  - [x] `NEXT_PUBLIC_API_BASE_URL` と Rails の CORS 許可オリジンを LAN IP に向けられるようにするか決める
    - 向けられるようにした。どちらも既に環境変数化されているためコード変更は不要で、
      `.env.development` の値を差し替えるだけ。IP の代わりに `<Mac>.local` を使えば
      DHCP で変わらないため書き換えが要らない（その場合だけ `RAILS_DEVELOPMENT_HOSTS` が必要）。
  - [x] 手順を `frontend/AGENTS.md` に書く（症状が実装バグに見えるため、切り分け手順とセットで）
```

- [ ] **Step 5: 全テストと lint を最終確認する**

```bash
docker compose exec frontend npm run test
docker compose exec frontend npm run lint
docker compose exec frontend npx tsc --noEmit
docker compose exec frontend npm run build
```

Expected: すべて成功。`npm run build` は `allowedDevOrigins` が本番ビルドを壊さないことの確認。

`npm run build` は dev サーバーと同じコンテナで走り、`.next` を本番ビルドの内容で
上書きする。終わったら dev 側を作り直しておくこと（AGENTS.md の stale キャッシュ対策と同じ）。

```bash
docker compose exec frontend rm -rf .next && docker compose restart frontend
```

- [ ] **Step 6: コミット**

```bash
git add docs/issues_backlog.md frontend/AGENTS.md
git commit -F - <<'EOF'
docs: issue 0-6 のタスクのチェックを埋める

Refs #107

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 7: push 前に `/code-review` を通す**

```bash
git diff main...HEAD --stat
```

`/code-review` を実行し、指摘があれば直してからコミットする。

- [ ] **Step 8: push して PR を作る**

```bash
git push -u origin feat/lan-dev-access
```

PR 本文には次を書く（**実 IP・実ホスト名は書かない**）。

- 何が変わるか（`DEV_ALLOWED_HOSTS` を設定したときだけ挙動が変わる。未設定なら現状どおり）
- `allowedDevOrigins` がホスト名で比較される仕様と、オリジン形式が無言で効かないこと
- Rails 側はコード変更なし（`CORS_ALLOWED_ORIGINS` / `RAILS_DEVELOPMENT_HOSTS` は既存の入口）
- `curl` にヘッダを付ければ実機なしで再現・確認できること
- 実機で確認した項目（Task 4 Step 2 の結果）
- `Closes #107`
- 末尾に `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

---

## 完了条件（設計書より）

- [ ] 同じ Wi-Fi のスマホから開発サーバーを開き、**ログイン・API を叩く画面・トーストが動く**
- [ ] env を設定しなければ従来どおり動く（他の開発者・CI・本番に影響しない）
- [ ] 書式を間違えた env は起動時に落ちる（無言で効かない状態にならない）
- [ ] `npm run test` と `npm run lint` が通る
- [ ] 実 IP・実ホスト名がコミットされる文書に含まれていない
