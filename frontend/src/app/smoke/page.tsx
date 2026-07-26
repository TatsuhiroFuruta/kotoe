"use client";

// 一時的な疎通スモークUI（issue 8-2a）。本番の CORS/JWT/Neon 接続を別オリジンの
// ブラウザから確認するための確認専用ページ。ログインUI（7-1/7-2）が載ったら削除する。
// src/lib/api.ts を使わないのは、レスポンスの Authorization ヘッダを生で読む必要が
// あるため（api.ts はボディしか返さない）。CLAUDE.md の「fetch を散らさない」規約の
// 一時的な例外。

import { useState } from "react";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

// スモーク用の固定ユーザー。本番 DB に1件だけゴミ行が残る（cleanup は docs/deployment.md）。
// User は name が必須（validates :name, presence: true）なので sign_up に含める。
const SMOKE_EMAIL = "smoke@kotoe.test";
const SMOKE_NAME = "smoke";
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
          body: JSON.stringify({
            user: { email: SMOKE_EMAIL, name: SMOKE_NAME, password: SMOKE_PASSWORD },
          }),
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
