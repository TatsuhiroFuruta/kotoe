"use client";

import Link from "next/link";
import { useState } from "react";

import { buttonClasses } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { attemptDetailHref } from "@/lib/attempts/attempt-detail-query";
import { toLikeErrorMessage } from "@/lib/attempts/attempt-messages";
import { useAuth } from "@/lib/auth/auth-context";
import { toast } from "@/lib/toast/toast-store";
import type { Attempt, LikeResponse } from "@/types/api";

/**
 * いいねのトグル。**楽観更新しない**。API は冪等で、応答が更新後の liked と likes_count を
 * 返すので、それで表示を確定させれば巻き戻しのロジックが要らない（FavoriteButton と同じ。
 * 7-4 設計書「決定 5」）。いいね数は呼び出し側が出す（ボタンが無い場合も数は出すため）。
 */
export function LikeButton({
  attempt,
  onChange,
}: {
  attempt: Attempt;
  onChange: (attempt: Attempt) => void;
}) {
  const auth = useAuth();
  const [pending, setPending] = useState(false);

  if (auth.status === "unauthenticated") {
    // ログイン画面側が safeNextPath() で検証する。
    return (
      <Link
        href={`/login?next=${encodeURIComponent(attemptDetailHref(attempt.id))}`}
        className={`${buttonClasses({ variant: "secondary", size: "sm" })} text-sm`}
      >
        ログインしていいね
      </Link>
    );
  }

  // 自分の挑戦には出さない。押せば必ず 422 になる（いいねは再現度への投票で、自票を禁じている。5-1）。
  if (auth.status === "authenticated" && auth.user.id === attempt.user.id) return null;

  async function toggle() {
    setPending(true);
    try {
      const { attempt: updated } = await apiFetch<LikeResponse>(`/api/attempts/${attempt.id}/like`, {
        method: attempt.liked ? "DELETE" : "POST",
      });
      onChange(updated);
    } catch (error: unknown) {
      toast.error(toLikeErrorMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      // loading の間は押せない（ログイン中か、自分の挑戦かが確定していない）。unreachable は押せる。
      // 押して失敗すれば toLikeErrorMessage で理由が出る。
      disabled={auth.status === "loading" || pending}
      // ラベルは固定し、状態は aria-pressed で伝える（ラベルと状態の両方を変えると読み上げが二重になる）。
      aria-pressed={attempt.liked}
      className={`${buttonClasses({ variant: attempt.liked ? "primary" : "secondary", size: "sm" })} text-sm`}
    >
      <span aria-hidden="true">{attempt.liked ? "♥" : "♡"}</span> いいね
    </button>
  );
}
