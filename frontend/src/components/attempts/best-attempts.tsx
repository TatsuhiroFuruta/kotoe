import { AttemptCard } from "@/components/attempts/attempt-card";
import type { Attempt } from "@/types/api";

// sm 以上で 2 位・1 位・3 位の順に並べる（1 位を中央に）。DOM の順序は 1・2・3 位のまま
// にして、配置は列を名指しで行う。読み上げとスマホ幅の縦並びを順位どおりにするため。
//
// order ではなく col-start にする。order は並び順を変えるだけで、自動配置は左の列から
// 詰めるので、1〜2 件のときに 1 位が左端に寄る（いいねが少ない MVP ではこれが普通の状態）。
const PLACEMENT_CLASSES = [
  "sm:col-start-2 sm:row-start-1",
  "sm:col-start-1 sm:row-start-1 sm:mt-10",
  "sm:col-start-3 sm:row-start-1 sm:mt-10",
];

/**
 * ベスト再現（表彰台）。
 *
 * API の best_attempts は「いいね上位 3 件」だが、全員 0 件のときは実質「新着 3 件」になる。
 * 見出しが「ベスト再現」なのに新着が並ぶのは嘘になるので、いいねが 1 以上のものだけを載せ、
 * 1 件も無ければセクションごと出さない（6-1：見せ方の判断はフロント）。
 *
 * 表彰台の挑戦はみんなの挑戦にも重複して出る。一覧から除くと kaminari の
 * total_count と OFFSET がずれるため、重複は仕様として受け入れる（6-1）。
 */
export function BestAttempts({ attempts }: { attempts: Attempt[] }) {
  const podium = attempts.filter((attempt) => attempt.likes_count > 0);
  if (podium.length === 0) return null;

  return (
    <section aria-labelledby="best-attempts-heading" className="flex flex-col gap-4">
      <h2 id="best-attempts-heading" className="text-lg font-semibold text-ink">
        このお題のベスト再現
      </h2>
      <ol className="grid grid-cols-1 items-start gap-6 sm:grid-cols-3">
        {podium.map((attempt, index) => (
          <li key={attempt.id} className={`flex flex-col gap-2 ${PLACEMENT_CLASSES[index]}`}>
            <p className="text-sm font-semibold text-accent">{index + 1} 位</p>
            <AttemptCard attempt={attempt} />
          </li>
        ))}
      </ol>
    </section>
  );
}
