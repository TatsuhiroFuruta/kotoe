import { LoginForm } from "@/components/auth/login-form";
import { parseLoginReason } from "@/lib/auth/login-reason";
import type { RawSearchParams } from "@/lib/search-params";

/**
 * サーバーコンポーネントのまま、?reason= を検証して LoginForm に渡すだけにする（/posts と同じ形）。
 *
 * searchParams を読むので、このページは静的ではなくリクエストごとに描画される。描画は
 * Vercel 側で行い Render は叩かないので、スリープの影響は受けない（7-2.6 決定 4）。
 * ?next= はここでは読まない。LoginForm がイベントハンドラの中で window.location から読む。
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const reason = parseLoginReason((await searchParams).reason);

  return <LoginForm expired={reason === "expired"} />;
}
