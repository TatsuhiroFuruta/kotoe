import Form from "next/form";

import { buttonClasses } from "@/components/ui/button";
import type { PostsQuery } from "@/lib/posts/posts-query";

/**
 * 送信で検索する（入力に合わせた自動検索はしない。設計書「決定 3」）。
 *
 * next/form の <Form> は action が文字列なら GET フォームをクライアント遷移に変える。
 * ハイドレーション前でも普通の GET フォームとして /posts?q=… へ飛ぶので、
 * JS が動く前に押されても壊れない。
 *
 * page は送らない（検索し直したら 1 ページ目に戻す）。sort は hidden で引き継ぐ。
 */
export function PostSearchForm({ query }: { query: PostsQuery }) {
  return (
    <Form action="/posts" role="search" className="flex w-full gap-2 sm:max-w-md">
      <label htmlFor="posts-search" className="sr-only">
        お題をタイトルで検索
      </label>
      {/*
        key に q を渡す。defaultValue は初回しか効かないので、「検索をクリア」や
        戻るボタンで q が変わったときに入力欄を作り直して URL と揃える。
      */}
      <input
        key={query.q}
        id="posts-search"
        name="q"
        type="search"
        defaultValue={query.q}
        placeholder="タイトルで検索"
        className="min-w-0 flex-1 rounded-card border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
      />
      {query.sort !== "recent" && <input type="hidden" name="sort" value={query.sort} />}
      <button type="submit" className={buttonClasses()}>
        検索
      </button>
    </Form>
  );
}
