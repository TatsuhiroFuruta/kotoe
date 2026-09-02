"use client";

import Link from "next/link";

import { useAuth } from "@/lib/auth/auth-context";
import { RequireAuth } from "@/lib/auth/require-auth";

// 7-1 のガード動作確認用の暫定ページ。7-2 で /login を作ったら削除する。

function AuthCheckContent() {
  const auth = useAuth();

  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold">認証ガードの確認</h1>
      <p className="mt-4 font-mono text-sm">
        {auth.status === "authenticated"
          ? `${auth.user.name}（${auth.user.email}）としてログイン中`
          : auth.status}
      </p>
      <Link className="mt-6 block text-sm underline" href="/">
        トップへ戻る
      </Link>
    </main>
  );
}

export default function AuthCheckPage() {
  return (
    <RequireAuth>
      <AuthCheckContent />
    </RequireAuth>
  );
}
