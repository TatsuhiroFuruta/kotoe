// 生成中の挑戦を、終端状態になるまで追う（7-3c 設計書「決定 3」）。
//
// React を知らない非同期関数にしてあるのは、ここにだけ Vitest を書くため
// （React Testing Library を採用していないので、フックは検査できない）。
// 取得・待機・時計を引数で差し替えられる。

import { ApiError, ApiTimeoutError, apiFetch } from "@/lib/api";
import { apiErrorCode } from "@/lib/attempts/attempt-messages";
import type { Attempt, AttemptShowResponse } from "@/types/api";

/** 本番の生成は約 29 秒（4-3 の実測）。3 秒ならおよそ 10 回で済む。 */
export const POLL_INTERVAL_MS = 3_000;

/**
 * 打ち切り。最悪ケース（OpenAI の timeout 150 秒 × 2 回＋アップロードの再試行）が約 5 分。
 * 打ち切っても生成は失敗ではない（枠は消費済み）ので、画面は「まだ生成しています」と言う。
 */
export const POLL_DEADLINE_MS = 360_000;

export type PollOutcome =
  | { kind: "settled"; attempt: Attempt }
  | { kind: "not_found" }
  | { kind: "timed_out" };

export type PollOptions = {
  /** 中断したら AbortError（signal.reason）で reject する。アンマウントで止めるため */
  signal: AbortSignal;
  /** true なら最初の 1 回を待たずに取得する（生成の応答が不明だったときの確認。決定 10） */
  immediate?: boolean;
  intervalMs?: number;
  deadlineMs?: number;
  fetchAttempt?: (attemptId: number, signal: AbortSignal) => Promise<Attempt>;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
};

async function fetchAttemptFromApi(attemptId: number, signal: AbortSignal): Promise<Attempt> {
  const { attempt } = await apiFetch<AttemptShowResponse>(`/api/attempts/${attemptId}`, { signal });
  return attempt;
}

/** 中断できる待機。中断されたら、その時点で signal.reason で reject する。 */
function sleepWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function pollAttempt(attemptId: number, options: PollOptions): Promise<PollOutcome> {
  const {
    signal,
    immediate = false,
    intervalMs = POLL_INTERVAL_MS,
    deadlineMs = POLL_DEADLINE_MS,
    fetchAttempt = fetchAttemptFromApi,
    sleep = sleepWithSignal,
    now = Date.now,
  } = options;
  const startedAt = now();
  let skipWait = immediate;

  for (;;) {
    // 前の取得が終わってから待機に入る。setInterval にしないのは、遅い応答が
    // 積み重なって同時に何本も飛ぶのを防ぐため。
    if (!skipWait) await sleep(intervalMs, signal);
    skipWait = false;
    if (signal.aborted) throw signal.reason;

    // 取得の前に判定する（締め切り直前の取得は捨てない）。
    if (now() - startedAt >= deadlineMs) return { kind: "timed_out" };

    try {
      const attempt = await fetchAttempt(attemptId, signal);
      if (signal.aborted) throw signal.reason;
      if (attempt.status !== "generating") return { kind: "settled", attempt };
    } catch (error) {
      // 自分で中断したものは通信エラーとして続行しない。
      if (signal.aborted) throw signal.reason;
      // 削除された。待っても変わらない。
      if (error instanceof ApiError && error.status === 404) return { kind: "not_found" };
      // それ以外（通信断・5xx・timeout）は続行する。一時的な失敗で「失敗しました」と
      // 言うと、生成は進んでいるのに誤診になる。
    }
  }
}

/** 起動していないことが確定している生成エラー。これらは確かめずに文で出す。 */
const DEFINITE_GENERATION_ERRORS = new Set([
  "generation_limit_reached",
  "service_generation_limit_reached",
  "generation_disabled",
]);

/**
 * POST :generate の失敗のうち、「実はサーバー側で起動済みかもしれない」もの（決定 10）。
 *
 * 応答だけが失われた場合（timeout・通信断・5xx）と、もう generating になっている場合
 * （attempt_not_draft）。これらを通常のエラーとして出すと、生成は進んでいて枠も減って
 * いるのに、画面は失敗と言うことになる。
 */
export function shouldConfirmGeneration(error: unknown): boolean {
  if (error instanceof ApiTimeoutError || error instanceof TypeError) return true;
  if (!(error instanceof ApiError)) return false;

  const code = apiErrorCode(error);
  if (code !== null && DEFINITE_GENERATION_ERRORS.has(code)) return false;
  if (error.status >= 500) return true;
  return error.status === 422 && code === "attempt_not_draft";
}
