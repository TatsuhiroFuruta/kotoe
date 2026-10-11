import type { Metadata } from "next";

import { PostForm } from "@/components/posts/post-form";
import { RequireAuth } from "@/lib/auth/require-auth";

export const metadata: Metadata = {
  title: "お題を投稿",
};

/**
 * 認証必須。RequireAuth が未ログインなら /login?next=/posts/new へ送り、
 * サーバーに届かないときは再試行の画面を出す（7-2）。
 *
 * 静的なセグメントなので /posts/[id] より優先される（[id] の parsePostId に "new" は届かない）。
 */
export default function NewPostPage() {
  return (
    <main className="flex flex-1 justify-center px-4 py-8 sm:py-12">
      <RequireAuth>
        <PostForm />
      </RequireAuth>
    </main>
  );
}
