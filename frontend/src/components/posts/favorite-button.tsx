"use client";

import Link from "next/link";
import { useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth/auth-context";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/error-messages";
import { postDetailHref } from "@/lib/posts/post-detail-query";
import { toRequestErrorMessage } from "@/lib/request-error-messages";
import { toast } from "@/lib/toast/toast-store";
import type { FavoriteResponse } from "@/types/api";

const POST_GONE_MESSAGE = "このお題は削除されました";

/**
 * 失敗を 1 文にする。**無言にしない**のが要点（backlog 7-3b：7-2.6 が未着手のうちの最低限）。
 *
 * 401 は失効。api.ts がトークンを捨てるので、このボタンはすぐ「ログインしてお気に入り」に
 * 変わる。理由を伝えないと、押したら別のボタンに化けたようにしか見えない。
 */
function toFavoriteErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return SESSION_EXPIRED_MESSAGE;
  if (error instanceof ApiError && error.status === 404) return POST_GONE_MESSAGE;
  return toRequestErrorMessage(error);
}

/**
 * お気に入りのトグル。**楽観更新しない**。API は冪等で、応答が更新後の真の状態を返すので、
 * 応答の favorited で表示を確定させれば巻き戻しのロジックが要らない（7-3b 設計書「決定 5」）。
 */
export function FavoriteButton({
  postId,
  favorited,
  onChange,
}: {
  postId: number;
  favorited: boolean;
  onChange: (favorited: boolean) => void;
}) {
  const auth = useAuth();
  const [pending, setPending] = useState(false);

  if (auth.status === "unauthenticated") {
    // 戻り先は並び替えとページを引き継がない（お題そのものに戻れれば足りる）。
    // ログイン画面側が safeNextPath() で検証する。
    return (
      <Link
        href={`/login?next=${encodeURIComponent(postDetailHref(postId))}`}
        className={`${buttonClasses({ variant: "secondary", size: "sm" })} shrink-0 text-sm`}
      >
        ログインしてお気に入り
      </Link>
    );
  }

  async function toggle() {
    setPending(true);
    try {
      const { post } = await apiFetch<FavoriteResponse>(`/api/posts/${postId}/favorite`, {
        method: favorited ? "DELETE" : "POST",
      });
      onChange(post.favorited);
    } catch (error: unknown) {
      toast.error(toFavoriteErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      // loading の間は押せない（ログイン中か確定していない）。unreachable は押せる。
      // 押して失敗すれば上の文言で理由が出る。
      disabled={auth.status === "loading" || pending}
      // ラベルは固定し、状態は aria-pressed で伝える（ラベルと状態の両方を変えると
      // 読み上げが「お気に入り済み、押されています」のように二重になる）。
      aria-pressed={favorited}
      className={`${buttonClasses({ variant: favorited ? "primary" : "secondary", size: "sm" })} shrink-0 text-sm`}
    >
      <span aria-hidden="true">{favorited ? "★" : "☆"}</span> お気に入り
    </button>
  );
}
