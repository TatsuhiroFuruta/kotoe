import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, ApiTimeoutError } from "@/lib/api";
import {
  apiErrorCode,
  descriptionFieldError,
  fallbackErrorMessage,
  failureReasonMessage,
  generationErrorMessage,
  resetsInText,
} from "@/lib/attempts/attempt-messages";
import { NETWORK_MESSAGE, SERVER_MESSAGE, TIMEOUT_MESSAGE } from "@/lib/request-error-messages";

const NOW = Date.parse("2026-09-30T10:00:00Z");
const HOUR = 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("apiErrorCode", () => {
  it("ApiError のボディの error を返す", () => {
    expect(apiErrorCode(new ApiError(422, { error: "attempt_not_draft" }))).toBe("attempt_not_draft");
  });

  it.each([
    ["文字列でない error", new ApiError(422, { error: 1 })],
    ["JSON でないボディ", new ApiError(502, "<html>")],
    ["ApiError でない", new TypeError("Failed to fetch")],
  ])("%s なら null", (_label, error) => {
    expect(apiErrorCode(error)).toBeNull();
  });
});

describe("failureReasonMessage", () => {
  it.each([
    ["content_policy", "規約"],
    ["rate_limited", "混み合って"],
    ["api_error", "画像生成サービスでエラー"],
    ["upload_failed", "保存できませんでした"],
    ["internal_error", "サーバーでエラー"],
    ["generation_disabled", "一時停止"],
  ])("%s を翻訳する", (reason, fragment) => {
    expect(failureReasonMessage(reason)).toContain(fragment);
  });

  it("未知のコードでもコードを含めた文を返す（無言にしない）", () => {
    expect(failureReasonMessage("new_reason")).toContain("new_reason");
  });

  it("Object.prototype のキー名を辞書の値と取り違えない", () => {
    // `reason in FAILURE_MESSAGES` と書くと toString が関数として返り、画面に関数の文字列が出る。
    expect(failureReasonMessage("toString")).toContain("toString");
    expect(failureReasonMessage("toString")).toContain("生成できませんでした");
  });

  it("null でも文を返す", () => {
    expect(failureReasonMessage(null)).toContain("生成できませんでした");
  });
});

describe("resetsInText", () => {
  it("残りを時間単位で切り上げる", () => {
    expect(resetsInText(at(5 * HOUR), NOW)).toBe("あと約 5 時間で");
    expect(resetsInText(at(HOUR + 60_000), NOW)).toBe("あと約 2 時間で");
  });

  it("1 時間以下なら「1 時間以内に」", () => {
    expect(resetsInText(at(HOUR), NOW)).toBe("1 時間以内に");
    expect(resetsInText(at(59 * 60_000), NOW)).toBe("1 時間以内に");
  });

  it.each([
    ["過去", at(-1)],
    ["ちょうど今", at(0)],
    ["壊れた文字列", "not-a-date"],
    ["文字列でない", 12345],
    ["未指定", undefined],
  ])("%s なら null（壊れた値を文に出さない）", (_label, value) => {
    expect(resetsInText(value, NOW)).toBeNull();
  });
});

describe("generationErrorMessage", () => {
  it("個人の上限：回数と回復までの時間を入れる", () => {
    const error = new ApiError(422, {
      error: "generation_limit_reached",
      limit: 3,
      resets_at: at(5 * HOUR),
    });

    expect(generationErrorMessage(error, NOW)).toBe(
      "今日の生成回数（3 回）を使い切りました。あと約 5 時間で回復します",
    );
  });

  it("個人の上限：limit と resets_at が無い・壊れていれば、その部分を省く", () => {
    const error = new ApiError(422, { error: "generation_limit_reached", limit: "3", resets_at: "x" });

    expect(generationErrorMessage(error, NOW)).toBe("今日の生成回数を使い切りました。");
  });

  it("サービス全体の上限（503）", () => {
    const error = new ApiError(503, {
      error: "service_generation_limit_reached",
      resets_at: at(30 * 60_000),
    });

    expect(generationErrorMessage(error, NOW)).toBe(
      "本日はサービス全体の生成上限に達しました。1 時間以内に回復します",
    );
  });

  it("キルスイッチ（503）", () => {
    expect(generationErrorMessage(new ApiError(503, { error: "generation_disabled" }), NOW)).toContain(
      "一時停止",
    );
  });

  it.each([
    ["attempt_not_draft", new ApiError(422, { error: "attempt_not_draft" })],
    ["ステータスとコードの組み合わせが違う", new ApiError(422, { error: "generation_disabled" })],
    ["コードの無い 503", new ApiError(503, "<html>")],
    ["404", new ApiError(404, null)],
    ["通信断", new TypeError("Failed to fetch")],
  ])("対応しないもの（%s）は null（呼び出し側が別の扱いにする）", (_label, error) => {
    expect(generationErrorMessage(error, NOW)).toBeNull();
  });
});

describe("descriptionFieldError", () => {
  it.each([
    ["blank", "描写を入力してください"],
    ["too_long", "1000 文字以内"],
  ])("%s を翻訳する", (code, fragment) => {
    expect(descriptionFieldError(new ApiError(422, { errors: { description: [code] } }))).toContain(
      fragment,
    );
  });

  it("未知のコードはコードを含めた文にする", () => {
    expect(
      descriptionFieldError(new ApiError(422, { errors: { description: ["too_short"] } })),
    ).toContain("too_short");
  });

  it("Object.prototype のキー名を辞書の値と取り違えない", () => {
    // `code in DESCRIPTION_MESSAGES` と書くと toString が関数として返り、入力欄の下に
    // 関数の中身の文字列が出る。failureReasonMessage と同じ理由で hasOwnKey を使っている。
    const message = descriptionFieldError(
      new ApiError(422, { errors: { description: ["toString"] } }),
    );

    expect(message).toBe("描写の内容を確認してください（toString）");
  });

  it.each([
    ["description 以外のフィールド", new ApiError(422, { errors: { base: ["x"] } })],
    ["errors の無い 422", new ApiError(422, { error: "attempt_not_draft" })],
    ["配列でない", new ApiError(422, { errors: { description: "blank" } })],
    ["422 以外", new ApiError(404, { errors: { description: ["blank"] } })],
    ["ApiError でない", new TypeError("Failed to fetch")],
  ])("%s は null", (_label, error) => {
    expect(descriptionFieldError(error)).toBeNull();
  });
});

describe("fallbackErrorMessage", () => {
  it("5xx・timeout・通信断は通信エラーの文言", () => {
    expect(fallbackErrorMessage(new ApiError(500, null))).toBe(SERVER_MESSAGE);
    expect(fallbackErrorMessage(new ApiTimeoutError(15_000))).toBe(TIMEOUT_MESSAGE);
    expect(fallbackErrorMessage(new TypeError("Failed to fetch"))).toBe(NETWORK_MESSAGE);
  });

  it("未知の 4xx はコード（無ければステータス）を含めた文にする（無言にしない）", () => {
    expect(fallbackErrorMessage(new ApiError(409, { error: "conflict_x" }))).toContain("conflict_x");
    expect(fallbackErrorMessage(new ApiError(400, null))).toContain("400");
  });
});
