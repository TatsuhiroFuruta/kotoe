import { describe, expect, it } from "vitest";

import { ApiError, ApiTimeoutError } from "@/lib/api";
import {
  draftResumeFromError,
  draftResumeFromResponse,
  draftResumeAction,
} from "@/lib/attempts/draft-resume";
import type { AttemptShowResponse, AttemptStatus } from "@/types/api";

const expected = { postId: 12, userId: 7 };

/** 受け口が開ける形（本人の draft・お題が一致）を既定にし、ケースごとに 1 項目だけ変える。 */
function response(
  overrides: { status?: AttemptStatus; postId?: number; userId?: number } = {},
): AttemptShowResponse {
  const { status = "draft", postId = 12, userId = 7 } = overrides;
  return {
    attempt: {
      id: 34,
      description: "夕焼けの海",
      generated_image_public_id: null,
      status,
      failure_reason: null,
      similarity_score: null,
      user: { id: userId, name: "taro" },
      likes_count: 0,
      liked: false,
      created_at: "2026-10-29T00:00:00Z",
    },
    post: {
      id: postId,
      title: "夕焼け",
      image_public_id: "kotoe/posts/abc",
      user: { id: 1, name: "hanako" },
      attempts_count: 0,
      likes_count: 0,
      favorited: false,
      created_at: "2026-10-28T00:00:00Z",
    },
  };
}

describe("draftResumeFromResponse", () => {
  it("本人の draft で、お題が一致すれば ready", () => {
    expect(draftResumeFromResponse(response(), expected)).toEqual({
      kind: "ready",
      draftId: 34,
      description: "夕焼けの海",
    });
  });

  it.each(["generating", "published", "failed"] as const)(
    "status が %s なら unavailable（生成済みの下書きは開き直せない）",
    (status) => {
      expect(draftResumeFromResponse(response({ status }), expected)).toEqual({
        kind: "unavailable",
      });
    },
  );

  it("別のお題の下書きなら unavailable", () => {
    expect(draftResumeFromResponse(response({ postId: 99 }), expected)).toEqual({
      kind: "unavailable",
    });
  });

  it("本人でなければ unavailable（公開済みは他人にも返るため、status だけでは足りない）", () => {
    expect(draftResumeFromResponse(response({ userId: 8 }), expected)).toEqual({
      kind: "unavailable",
    });
  });
});

describe("draftResumeFromError", () => {
  it("404 は unavailable（他人の下書き・削除済み・お題の削除を区別しない）", () => {
    expect(draftResumeFromError(new ApiError(404, {}))).toEqual({ kind: "unavailable" });
  });

  it("401 は silent（api.ts が失効を処理する。トーストを重ねない）", () => {
    expect(draftResumeFromError(new ApiError(401, {}))).toEqual({ kind: "silent" });
  });

  it.each([500, 503])("%d は failed（再読み込みで試せるよう ?draft= を残す）", (status) => {
    expect(draftResumeFromError(new ApiError(status, {})).kind).toBe("failed");
  });

  it("timeout は failed", () => {
    expect(draftResumeFromError(new ApiTimeoutError(15_000)).kind).toBe("failed");
  });

  it("通信断（ApiError 以外）も failed で、文言を持つ", () => {
    const outcome = draftResumeFromError(new TypeError("Failed to fetch"));
    expect(outcome.kind).toBe("failed");
    if (outcome.kind === "failed") expect(outcome.message).not.toBe("");
  });
});

describe("draftResumeAction", () => {
  const ready = { kind: "ready", draftId: 34, description: "夕焼けの海" } as const;

  it("初めての結果で、入力欄が空なら適用する", () => {
    expect(draftResumeAction({ previous: null, draftKey: 34, outcome: ready, currentText: "" })).toBe(
      "apply",
    );
  });

  it.each(["ready", "unavailable"] as const)(
    "同じ下書きが %s で決着済みなら、取り直しの結果を無視する（書き直しを上書きしない・トーストを繰り返さない）",
    (kind) => {
      const previous = { key: 34, outcome: kind === "ready" ? ready : ({ kind } as const) };
      expect(draftResumeAction({ previous, draftKey: 34, outcome: ready, currentText: "" })).toBe(
        "ignore",
      );
    },
  );

  it("前回が通信の失敗なら、取り直しの結果を適用する", () => {
    const previous = { key: 34, outcome: { kind: "failed", message: "x" } as const };
    expect(draftResumeAction({ previous, draftKey: 34, outcome: ready, currentText: "" })).toBe(
      "apply",
    );
  });

  it("前回が 401（silent）なら、再ログイン後の取り直しの結果を適用する", () => {
    const previous = { key: 34, outcome: { kind: "silent" } as const };
    expect(draftResumeAction({ previous, draftKey: 34, outcome: ready, currentText: "" })).toBe(
      "apply",
    );
  });

  it("入力欄に文面があれば ready を適用せず、書いた文面を残して受け口を終える（?draft= を外す）", () => {
    expect(
      draftResumeAction({ previous: null, draftKey: 34, outcome: ready, currentText: "書きかけ" }),
    ).toBe("keep-text");
  });

  it("入力欄に文面があっても、ready 以外（トーストを出すだけ）は適用する", () => {
    expect(
      draftResumeAction({
        previous: null,
        draftKey: 34,
        outcome: { kind: "unavailable" },
        currentText: "書きかけ",
      }),
    ).toBe("apply");
  });

  it("別の下書きの結果は、前回が決着済みでも適用する", () => {
    const previous = { key: 33, outcome: ready };
    expect(draftResumeAction({ previous, draftKey: 34, outcome: ready, currentText: "" })).toBe(
      "apply",
    );
  });
});
