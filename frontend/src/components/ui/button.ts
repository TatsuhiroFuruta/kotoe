/**
 * 主ボタンの見た目を 1 箇所に集める。
 *
 * コンポーネントではなく「クラス文字列を返す関数」にしてある。現物 11 箇所の
 * うち 3 箇所は <Link> で、7-3a のページネーションとソートでさらに増える。
 * <Link> と <button> の両方を受ける部品にすると、href の有無で props の型を
 * 分ける必要があり、disabled のように片方にしか無い属性の扱いも決めることに
 * なる。クラスを配るだけなら、その問題がそもそも発生しない。
 */

type ButtonVariant = "primary" | "secondary";
type ButtonSize = "sm" | "md" | "lg";

/**
 * disabled:opacity-60 は <Link> には効かないが無害なので共通に置く。
 * <button> 側で付け忘れる余地を消すほうを採る。
 *
 * font-medium も共通に置く。現状 secondary の 5 箇所（ヘッダー 3・
 * HealthPanel 2）には無いので、それらはわずかに太くなる。primary にだけ
 * 入れると、ヒーローで隣り合う「新規登録」と「ログイン」が別の太さになり、
 * そちらのほうが事故に見えるため。
 */
const BASE_CLASSES = "rounded-card font-medium disabled:opacity-60";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-strong",
  secondary: "border border-line text-ink-muted hover:text-ink",
};

/**
 * padding だけを持ち、**文字サイズは持たせない**。require-auth と
 * health-panel は text-sm を併用しており、ここが text-base を持つと
 * font-size のクラスが 2 つ同時に当たる。Tailwind では詳細度が同じ
 * クラスの優先順位は生成された CSS の順序で決まり、className に書いた順では
 * 決まらないため、どちらが効くかがビルドに依存することになる。
 * 持たせなければ衝突自体が起きない。
 */
const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5",
  md: "px-4 py-2",
  lg: "px-5 py-2.5",
};

export function buttonClasses({
  variant = "primary",
  size = "md",
}: { variant?: ButtonVariant; size?: ButtonSize } = {}): string {
  return `${BASE_CLASSES} ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]}`;
}
