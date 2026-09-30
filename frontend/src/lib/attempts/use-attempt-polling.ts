import { useEffect, useEffectEvent } from "react";

import { type PollOutcome, pollAttempt } from "@/lib/attempts/poll-attempt";

/**
 * pollAttempt を画面につなぐ薄いフック（7-3c 設計書「決定 3」）。
 *
 * target が null の間は何もしない。attemptId・immediate が変わるかアンマウントされたら
 * 走っているポーリングを中断する（お題から離れたページが 3 秒ごとに叩き続けないように）。
 *
 * 「もう一度確認」は、いったん target を null にして（stalled）から同じ attemptId で
 * 渡し直す。間に null を挟むので、同じ値でも effect は走り直す。
 *
 * onOutcome は useEffectEvent で包む。依存配列に入れると、呼び出し側が再描画のたびに
 * 作り直す関数のせいでポーリングが毎回やり直しになる。
 */
export function useAttemptPolling(
  target: { attemptId: number; immediate: boolean } | null,
  onOutcome: (outcome: PollOutcome, attemptId: number) => void,
): void {
  const handleOutcome = useEffectEvent(onOutcome);
  const attemptId = target?.attemptId ?? null;
  const immediate = target?.immediate ?? false;

  useEffect(() => {
    if (attemptId === null) return;

    const controller = new AbortController();

    pollAttempt(attemptId, { signal: controller.signal, immediate })
      .then((outcome) => handleOutcome(outcome, attemptId))
      .catch((error: unknown) => {
        // 自分で中断した（アンマウント・対象の変更）ものは失敗ではない。
        if (controller.signal.aborted) return;
        // pollAttempt は中断以外で reject しない作りだが、想定外の例外で「生成中…」の
        // まま固まらないように、打ち切りとして扱う（「もう一度確認」が出る）。
        console.error("生成状況の確認で想定外のエラーが発生しました", error);
        handleOutcome({ kind: "timed_out" }, attemptId);
      });

    return () => controller.abort();
  }, [attemptId, immediate]);
}
