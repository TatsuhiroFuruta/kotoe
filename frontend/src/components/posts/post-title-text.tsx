import { UNTITLED_LABEL } from "@/lib/posts/post-title";

/**
 * お題のタイトルの中身。見出しの要素（h1 / h2）は呼び出し側が持つ。
 * 公開 UGC なので {value} のまま置く（React が自動でエスケープする）。
 */
export function PostTitleText({ title }: { title: string | null }) {
  if (title === null) return <span className="text-ink-muted">{UNTITLED_LABEL}</span>;
  return <>{title}</>;
}
