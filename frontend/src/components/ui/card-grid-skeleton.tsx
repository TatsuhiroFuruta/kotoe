const SKELETON_COUNT = 12; // サーバーの 1 ページの件数と同じ。レイアウトが跳ねないように

// Tailwind は完全なクラス名の文字列だけを拾うので、補間せずリテラルで持つ。
const ASPECT_CLASSES = {
  "4:3": "aspect-4/3",
  "1:1": "aspect-square",
} as const;

/** カードの画像の縦横比に合わせた読み込み中の骨組み。 */
export function CardGridSkeleton({ aspect }: { aspect: keyof typeof ASPECT_CLASSES }) {
  return (
    <ul
      aria-busy="true"
      aria-label="読み込み中"
      className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
    >
      {Array.from({ length: SKELETON_COUNT }, (_, index) => (
        <li key={index} className="overflow-hidden rounded-card border border-line bg-surface">
          <div className={`${ASPECT_CLASSES[aspect]} w-full animate-pulse bg-line`} />
          <div className="flex flex-col gap-2 p-4">
            <div className="h-5 w-3/4 animate-pulse rounded bg-line" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-line" />
          </div>
        </li>
      ))}
    </ul>
  );
}
