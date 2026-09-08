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
 *
 * useSearchParams() を使わずに window.location から読むのは、あちらが静的ページで
 * <Suspense> 境界を要求し、ローカルでは通るのに Vercel の本番ビルドだけ落ちるため
 *（7-1 の申し送り 3）。描画中に読まないので、ハイドレーションの不一致も起きない。
 *
 * safeNextPath() は不正な値に対して "/" を返すので、呼び出し側でフォールバックを
 * 書かない。書くと「検査した対象」と「実際に遷移する対象」が食い違う余地ができる。
 */
function resolveNextPath(): string {
  return safeNextPath(new URLSearchParams(window.location.search).get("next"));
}

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<AuthFormErrors>(NO_ERRORS);
  const [submitting, setSubmitting] = useState(false);

  // 認証済みでこの画面に来た場合（別タブでログインした、戻るボタンで戻ったなど）は
  // フォームを見せずに戻り先へ送る。unreachable のときは送らない：ログインし直せば
  // 新しいトークンが取れるので、この画面自体が回復手段のひとつになる。
  useEffect(() => {
    if (auth.status !== "authenticated") return;
    router.replace(resolveNextPath());
  }, [auth.status, router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors(NO_ERRORS);
    setSubmitting(true);

    try {
      await auth.signIn({ email, password });
      // 成功時は submitting を false に戻さない。遷移が終わるまでのあいだに
      // 二重送信されるのを防ぐ。
      router.replace(resolveNextPath());
    } catch (error) {
      setErrors(toAuthFormErrors(error));
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold text-ink">ログイン</h1>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        {errors.formError !== null && (
          <p role="alert" className="rounded-card bg-danger/10 px-3 py-2 text-sm text-danger">
            {errors.formError}
          </p>
        )}

        <TextField
          id="email"
          label="メールアドレス"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          error={errors.fieldErrors.email}
        />

        <TextField
          id="password"
          label="パスワード"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          error={errors.fieldErrors.password}
        />

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 rounded-card bg-accent px-4 py-2 font-medium text-white hover:bg-accent-strong disabled:opacity-60"
        >
          {submitting ? "送信中…" : "ログイン"}
        </button>
      </form>

      <p className="mt-6 text-sm text-ink-muted">
        アカウントをお持ちでない方は{" "}
        <Link href="/signup" className="text-accent hover:text-accent-strong">
          新規登録
        </Link>
      </p>
    </>
  );
}
