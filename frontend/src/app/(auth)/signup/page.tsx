"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { TextField } from "@/components/ui/text-field";
import { useAuth } from "@/lib/auth/auth-context";
import { toAuthFormErrors, type AuthFormErrors } from "@/lib/auth/error-messages";
import { safeNextPath } from "@/lib/auth/safe-next-path";

const NO_ERRORS: AuthFormErrors = { formError: null, fieldErrors: {} };

/**
 * 戻り先を決める。**描画中に呼んではいけない**（イベントハンドラと effect の中だけ）。
 * 理由は /login と同じ：useSearchParams() は <Suspense> 境界を要求し、ローカルでは
 * 通るのに Vercel の本番ビルドだけ落ちる（7-1 の申し送り 3）。
 */
function resolveNextPath(): string {
  return safeNextPath(new URLSearchParams(window.location.search).get("next"));
}

export default function SignUpPage() {
  const auth = useAuth();
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<AuthFormErrors>(NO_ERRORS);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (auth.status !== "authenticated") return;
    router.replace(resolveNextPath());
  }, [auth.status, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors(NO_ERRORS);
    setSubmitting(true);

    try {
      await auth.signUp({ name, email, password });
      // 成功時は submitting を戻さない（二重送信の防止）。
      router.replace(resolveNextPath());
    } catch (error) {
      setErrors(toAuthFormErrors(error));
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-ink">新規登録</h1>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        {errors.formError !== null && (
          <p role="alert" className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">
            {errors.formError}
          </p>
        )}

        <TextField
          id="name"
          label="名前"
          type="text"
          value={name}
          onChange={setName}
          autoComplete="nickname"
          error={errors.fieldErrors.name}
        />

        <TextField
          id="email"
          label="メールアドレス"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          error={errors.fieldErrors.email}
        />

        {/*
          minLength は Rails の config.password_length = 6..128 に合わせた入力制約。
          ルールの再実装ではなく、往復を 1 回減らすためのもの。破られてもサーバーが
          必ず弾き、返ってきた too_short を辞書が翻訳する。
        */}
        <TextField
          id="password"
          label="パスワード（6文字以上）"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={6}
          error={errors.fieldErrors.password}
        />

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 rounded-card bg-accent px-4 py-2 font-medium text-white hover:bg-accent-strong disabled:opacity-60"
        >
          {submitting ? "送信中…" : "登録する"}
        </button>
      </form>

      <p className="mt-6 text-sm text-ink-muted">
        既にアカウントをお持ちの方は{" "}
        <Link href="/login" className="text-accent hover:text-accent-strong">
          ログイン
        </Link>
      </p>
    </>
  );
}
