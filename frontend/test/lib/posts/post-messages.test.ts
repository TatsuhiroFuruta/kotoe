import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, ApiTimeoutError } from "@/lib/api";
import {
  UNKNOWN_FIELD_MESSAGE,
  UPLOAD_FAILED_MESSAGE,
  imageErrorMessage,
  isBlankTitle,
  titleErrorMessage,
  toLeftPageFailureMessage,
  toPostFormErrors,
  unconfirmedMessage,
} from "@/lib/posts/post-messages";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/auth/session-expiry";

/** Object.prototype から継承したキー。辞書を素朴に引くと文言ではない値が返る */
const PROTOTYPE_KEYS = ["toString", "constructor", "__proto__"];

const unprocessable = (errors: unknown) => new ApiError(422, { errors });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isBlankTitle", () => {
  it.each(["", " ", "　", "\n\t ", " 　\n"])("%j は空として扱う（Rails の presence と同じ）", (title) => {
    expect(isBlankTitle(title)).toBe(true);
  });

  it.each(["a", " 夕焼け ", "　海　"])("%j は空ではない", (title) => {
    expect(isBlankTitle(title)).toBe(false);
  });
});

describe("imageErrorMessage", () => {
  it.each([
    ["image_empty", "空のファイルです。別の画像を選んでください"],
    ["image_missing", "画像を選んでください"],
    ["image_too_large", "画像は 5MB 以下にしてください"],
    ["image_type_not_allowed", "JPEG・PNG・WebP・HEIC の画像を選んでください"],
  ])("%s を翻訳する", (code, message) => {
    expect(imageErrorMessage(code)).toBe(message);
  });

  it.each(["unknown_code", ...PROTOTYPE_KEYS])("未知のコード %s は汎用の文言にする", (code) => {
    expect(imageErrorMessage(code)).toBe("この画像は使えません");
  });
});

describe("titleErrorMessage", () => {
  it("blank を翻訳する", () => {
    expect(titleErrorMessage("blank")).toBe("タイトルを入力してください");
  });

  it.each(["too_long", ...PROTOTYPE_KEYS])("未知のコード %s は汎用の文言にする", (code) => {
    expect(titleErrorMessage(code)).toBe("このタイトルは使えません");
  });
});

describe("toPostFormErrors", () => {
  describe("422（rejected）", () => {
    it("画像とタイトルのエラーを、それぞれの欄に振り分ける", () => {
      expect(
        toPostFormErrors(unprocessable({ image: ["image_too_large"], title: ["blank"] })),
      ).toEqual({
        image: "画像は 5MB 以下にしてください",
        title: "タイトルを入力してください",
        form: null,
      });
    });

    it("欄の未知のコードは、その欄の汎用の文言にする", () => {
      expect(toPostFormErrors(unprocessable({ title: ["too_long"] }))).toEqual({
        image: null,
        title: "このタイトルは使えません",
        form: null,
      });
    });

    it.each([
      ["空の配列", []],
      ["文字列でないコード", [1]],
      ["配列でない", "blank"],
    ])("コードが読めない（%s）ときも、その欄に汎用の文言を出す", (_label, codes) => {
      expect(toPostFormErrors(unprocessable({ title: codes })).title).toBe("このタイトルは使えません");
    });

    const unknownField = {
      kind: "rejected",
      message: UNKNOWN_FIELD_MESSAGE,
      reason: "入力内容が受け付けられませんでした",
    };

    it("画面に無い欄のエラーはフォーム上部に出す（何も表示されない状態を作らない）", () => {
      expect(toPostFormErrors(unprocessable({ user: ["must_exist"] }))).toEqual({
        image: null,
        title: null,
        form: unknownField,
      });
    });

    it("JSON の __proto__ キーも画面に無い欄として扱う", () => {
      const errors: unknown = JSON.parse('{"__proto__": ["x"]}');
      expect(toPostFormErrors(unprocessable(errors)).form).toEqual(unknownField);
    });

    it("画面にある欄と無い欄が混ざっていたら、両方出す", () => {
      expect(toPostFormErrors(unprocessable({ image: ["image_missing"], user: ["x"] }))).toEqual({
        image: "画像を選んでください",
        title: null,
        form: unknownField,
      });
    });

    it.each([
      ["errors が空", new ApiError(422, { errors: {} })],
      ["errors がオブジェクトでない", new ApiError(422, { errors: "invalid" })],
      ["errors が無い", new ApiError(422, { error: "something" })],
      ["本文が JSON でない", new ApiError(422, "<html>")],
    ])("%s ときはフォーム上部に出す", (_label, error) => {
      expect(toPostFormErrors(error)).toEqual({ image: null, title: null, form: unknownField });
    });
  });

  it("502 image_upload_failed は rejected（画像の保存に失敗したので、お題は保存されていない）", () => {
    expect(toPostFormErrors(new ApiError(502, { error: "image_upload_failed" })).form).toEqual({
      kind: "rejected",
      message: UPLOAD_FAILED_MESSAGE,
      reason: "画像の保存に失敗しました",
    });
  });

  it.each([
    ["コードがあればコード", new ApiError(403, { error: "forbidden" }), "forbidden"],
    ["無ければステータス", new ApiError(413, null), "413"],
  ])("その他の 4xx は rejected。理由は%s", (_label, error, reason) => {
    expect(toPostFormErrors(error).form).toEqual({
      kind: "rejected",
      message: `操作を完了できませんでした（${reason}）`,
      reason,
    });
  });

  it("401 は失効（文言はトーストで出すので、ここでは種類だけ返す）", () => {
    expect(toPostFormErrors(new ApiError(401, { error: "unauthorized" })).form).toEqual({
      kind: "session_expired",
    });
  });

  // 応答が届かなかったもの。Rails は気づかずに処理を続けるので、お題は作られている場合がある。
  it.each([
    ["timeout", new ApiTimeoutError(120_000), "応答が時間内に返りませんでした"],
    ["通信断", new TypeError("Failed to fetch"), "通信が切れました"],
    ["500", new ApiError(500, null), "サーバーでエラーが発生しました"],
    ["プロキシの 502（HTML）", new ApiError(502, "<html>"), "サーバーでエラーが発生しました"],
    ["503", new ApiError(503, { error: "x" }), "サーバーでエラーが発生しました"],
  ])("%s は unconfirmed", (_label, error, reason) => {
    expect(toPostFormErrors(error)).toEqual({
      image: null,
      title: null,
      form: { kind: "unconfirmed", reason },
    });
  });

  it("想定外の例外は unconfirmed にし、原文をコンソールに残す", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("unexpected");
    expect(toPostFormErrors(error).form).toEqual({
      kind: "unconfirmed",
      reason: "予期しないエラーが発生しました",
    });
    expect(log).toHaveBeenCalledWith(expect.any(String), error);
  });
});

describe("unconfirmedMessage", () => {
  it("失敗と断定せず、一覧で確かめるよう伝える", () => {
    expect(unconfirmedMessage("通信が切れました")).toBe(
      "投稿が完了したか確認できませんでした（通信が切れました）。お題一覧で確かめてから、必要ならもう一度投稿してください",
    );
  });
});

describe("toLeftPageFailureMessage", () => {
  // 送信中に画面を離れたあとの失敗。toPostFormErrors の実際の出力から組み立てて、つなぎ目も確かめる。
  const leave = (error: unknown) => toLeftPageFailureMessage(toPostFormErrors(error));

  it("失効はセッションの文言", () => {
    expect(leave(new ApiError(401, null))).toBe(SESSION_EXPIRED_MESSAGE);
  });

  it.each([
    ["timeout", new ApiTimeoutError(120_000), "応答が時間内に返りませんでした"],
    ["通信断", new TypeError("Failed to fetch"), "通信が切れました"],
    ["5xx", new ApiError(500, null), "サーバーでエラーが発生しました"],
  ])("%s は「確認できませんでした」（失敗と断定すると二重投稿を誘う）", (_label, error, reason) => {
    expect(leave(error)).toBe(unconfirmedMessage(reason));
  });

  it.each([
    ["画像の欄", unprocessable({ image: ["image_type_not_allowed"] }), "JPEG・PNG・WebP・HEIC の画像を選んでください"],
    ["タイトルの欄", unprocessable({ title: ["blank"] }), "タイトルを入力してください"],
    ["画像の保存の失敗", new ApiError(502, { error: "image_upload_failed" }), "画像の保存に失敗しました"],
    ["画面に無い欄", unprocessable({ user: ["x"] }), "入力内容が受け付けられませんでした"],
    ["その他の 4xx", new ApiError(413, null), "413"],
    ["欄と画面に無い欄の両方（欄を優先）", unprocessable({ image: ["image_missing"], user: ["x"] }), "画像を選んでください"],
  ])("%s は「投稿できませんでした」に理由を括弧で添える", (_label, error, reason) => {
    expect(leave(error)).toBe(`お題を投稿できませんでした（${reason}）`);
  });
});
