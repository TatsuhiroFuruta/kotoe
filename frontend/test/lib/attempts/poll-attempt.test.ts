import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, ApiTimeoutError } from "@/lib/api";
import { pollAttempt, shouldConfirmGeneration } from "@/lib/attempts/poll-attempt";
import type { Attempt, AttemptStatus } from "@/types/api";

function attempt(status: AttemptStatus): Attempt {
  return {
    id: 7,
    description: "描写",
    generated_image_public_id: status === "published" ? "kotoe/test/attempts/7" : null,
    status,
    failure_reason: status === "failed" ? "api_error" : null,
    similarity_score: null,
    user: { id: 1, name: "テスト" },
    likes_count: 0,
    liked: false,
    created_at: "2026-09-30T00:00:00Z",
  };
}

/**
 * 時計・待機・取得を差し替える。待機は時計を進めるだけで実時間を使わない。
 * fetchTimes には「取得したときの時計の値」が順に入る。
 * 用意した応答を使い切ったあとの取得は Error を投げる。pollAttempt はそれを通信エラーとして
 * 続行するので、締め切りで必ず止まる（テストが無限に回らない）。
 */
function harness(responses: Array<Attempt | Error>) {
  let clock = 0;
  const fetchTimes: number[] = [];
  // 型引数で引数の形を与える（使わない引数を書くと no-unused-vars に掛かるため）。
  const fetchAttempt = vi.fn<(id: number, signal: AbortSignal) => Promise<Attempt>>(async () => {
    fetchTimes.push(clock);
    const next = responses.shift();
    if (next === undefined) throw new Error("用意した応答より多く取得した");
    if (next instanceof Error) throw next;
    return next;
  });
  const sleep = vi.fn<(ms: number, signal: AbortSignal) => Promise<void>>(async (ms) => {
    clock += ms;
  });
  return { fetchAttempt, sleep, now: () => clock, fetchTimes };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("pollAttempt", () => {
  it("既定では 3 秒待ってから取得し、generating の間は取得を繰り返す", async () => {
    const h = harness([attempt("generating"), attempt("generating"), attempt("published")]);

    const outcome = await pollAttempt(7, { signal: new AbortController().signal, ...h });

    expect(outcome).toEqual({ kind: "settled", attempt: attempt("published") });
    expect(h.fetchTimes).toEqual([3_000, 6_000, 9_000]);
    expect(h.fetchAttempt).toHaveBeenCalledWith(7, expect.any(AbortSignal));
  });

  it("immediate なら最初の 1 回は待たずに取得する（応答が不明だったときの確認）", async () => {
    const h = harness([attempt("generating"), attempt("published")]);

    await pollAttempt(7, { signal: new AbortController().signal, immediate: true, ...h });

    expect(h.fetchTimes).toEqual([0, 3_000]);
  });

  it.each(["failed", "draft"] as const)("%s も generating 以外なので settled で返す", async (status) => {
    const h = harness([attempt(status)]);

    const outcome = await pollAttempt(7, { signal: new AbortController().signal, ...h });

    expect(outcome).toEqual({ kind: "settled", attempt: attempt(status) });
  });

  it("通信断・5xx・timeout・401 では止まらずに続行する", async () => {
    // 生成は進んでいるのに一時的な失敗で「失敗しました」と言うと誤診になる。
    // 401 は実際には来ない（GET は認証不要で、失効したトークンは無視されて 404 になる）が、
    // 来ても止めない。
    const h = harness([
      new TypeError("Failed to fetch"),
      new ApiError(500, null),
      new ApiTimeoutError(15_000),
      new ApiError(401, { error: "unauthorized" }),
      attempt("published"),
    ]);

    const outcome = await pollAttempt(7, { signal: new AbortController().signal, ...h });

    expect(outcome.kind).toBe("settled");
    expect(h.fetchAttempt).toHaveBeenCalledTimes(5);
  });

  it("404 で止まり、それ以上取得しない", async () => {
    const h = harness([new ApiError(404, null), attempt("published")]);

    const outcome = await pollAttempt(7, { signal: new AbortController().signal, ...h });

    expect(outcome).toEqual({ kind: "not_found" });
    expect(h.fetchAttempt).toHaveBeenCalledTimes(1);
  });

  it("締め切りに達したら取得せずに timed_out を返す", async () => {
    const h = harness([attempt("generating"), attempt("generating"), attempt("published")]);

    const outcome = await pollAttempt(7, {
      signal: new AbortController().signal,
      deadlineMs: 9_000,
      ...h,
    });

    // 3 秒・6 秒で取得し、9 秒の時点で締め切り（>=）に達しているので取得しない。
    expect(outcome).toEqual({ kind: "timed_out" });
    expect(h.fetchTimes).toEqual([3_000, 6_000]);
  });

  it("締め切りの直前の取得は捨てない", async () => {
    const h = harness([attempt("generating"), attempt("generating"), attempt("published")]);

    const outcome = await pollAttempt(7, {
      signal: new AbortController().signal,
      deadlineMs: 9_001,
      ...h,
    });

    expect(outcome.kind).toBe("settled");
    expect(h.fetchTimes).toEqual([3_000, 6_000, 9_000]);
  });

  it("既定の締め切りは 6 分", async () => {
    const h = harness([]);

    const outcome = await pollAttempt(7, { signal: new AbortController().signal, ...h });

    expect(outcome).toEqual({ kind: "timed_out" });
    // 3 秒ごとに 360 秒の手前まで：3, 6, …, 357 秒の 119 回。
    expect(h.fetchAttempt).toHaveBeenCalledTimes(119);
  });

  it("前の取得が終わるまで次の待機に入らない（リクエストを重ねない）", async () => {
    let resolveFetch: (value: Attempt) => void = () => {};
    const sleep = vi.fn(async () => {});
    const fetchAttempt = vi.fn(
      () =>
        new Promise<Attempt>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const promise = pollAttempt(7, { signal: new AbortController().signal, sleep, fetchAttempt });
    // 取得を保留にしたまま、マイクロタスクを十分に回す。
    for (let i = 0; i < 10; i += 1) await Promise.resolve();

    expect(fetchAttempt).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledTimes(1);

    resolveFetch(attempt("published"));
    await expect(promise).resolves.toEqual({ kind: "settled", attempt: attempt("published") });
  });

  it("待機中に中断すると AbortError で reject し、取得しない（既定の待機）", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchAttempt = vi.fn(async () => attempt("published"));

    const promise = pollAttempt(7, { signal: controller.signal, fetchAttempt });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchAttempt).not.toHaveBeenCalled();
  });

  it("取得中に中断すると、失敗を通信エラーとして続行せずに reject する", async () => {
    const controller = new AbortController();
    const h = harness([]);
    // 本物の fetch と同じく、中断されたら signal.reason で reject する。
    h.fetchAttempt.mockImplementation(
      (_id, signal) =>
        new Promise<Attempt>((_resolve, reject) => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          queueMicrotask(() => controller.abort());
        }),
    );

    const promise = pollAttempt(7, { signal: controller.signal, immediate: true, ...h });

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(h.fetchAttempt).toHaveBeenCalledTimes(1);
  });
});

describe("shouldConfirmGeneration", () => {
  it.each([
    ["timeout", new ApiTimeoutError(15_000)],
    ["通信断", new TypeError("Failed to fetch")],
    ["500", new ApiError(500, null)],
    ["コードの無い 503（プロキシのエラーページ）", new ApiError(503, "<html>")],
    ["attempt_not_draft（もう generating になっている）", new ApiError(422, { error: "attempt_not_draft" })],
  ])("%s は応答が不明なので状態を確かめる", (_label, error) => {
    expect(shouldConfirmGeneration(error)).toBe(true);
  });

  it.each([
    ["個人の上限", new ApiError(422, { error: "generation_limit_reached" })],
    ["全体の上限", new ApiError(503, { error: "service_generation_limit_reached" })],
    ["キルスイッチ", new ApiError(503, { error: "generation_disabled" })],
    ["404", new ApiError(404, null)],
    ["401", new ApiError(401, { error: "unauthorized" })],
    // 5xx でも attempt_not_draft でもない 4xx。サーバーがリクエストを受け付けなかったと
    // 答えているので、起動していない。
    ["400", new ApiError(400, null)],
    ["403", new ApiError(403, null)],
    ["409", new ApiError(409, { error: "conflict" })],
    ["未知のコードの 422", new ApiError(422, { error: "some_new_code" })],
    ["想定外の例外", new Error("bug")],
  ])("%s は確かめない（起動していないことが確定している）", (_label, error) => {
    expect(shouldConfirmGeneration(error)).toBe(false);
  });
});
