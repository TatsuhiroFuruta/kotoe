import { avatarInitial } from "@/lib/users/avatar-initial";

const sizeClasses = {
  sm: "size-7 text-xs",
  lg: "size-16 text-2xl",
} as const;

// 名前の頭文字を丸に入れた飾り。隣に必ず名前を表示する前提なので、
// スクリーンリーダーには読ませない（頭文字だけが読み上げに混ざるのを避ける）。
export function UserAvatar({ name, size }: { name: string; size: keyof typeof sizeClasses }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent/10 font-semibold text-accent ${sizeClasses[size]}`}
    >
      {avatarInitial(name)}
    </span>
  );
}
