import { LoginForm } from "@/components/auth/login-form";
import { LOGIN_REASON_EXPIRED, parseLoginReason } from "@/lib/auth/login-reason";
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

  // null かどうかでは判定しない。理由が増えたとき、別の理由でも「期限切れ」の枠が出てしまう。
  return <LoginForm expired={reason === LOGIN_REASON_EXPIRED} />;
}
