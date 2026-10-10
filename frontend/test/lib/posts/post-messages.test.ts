import { describe, expect, it } from "vitest";

import { ApiError, ApiTimeoutError } from "@/lib/api";
import {
  POST_TIMEOUT_MESSAGE,
  UNKNOWN_FIELD_MESSAGE,
  UPLOAD_FAILED_MESSAGE,
  imageErrorMessage,
  isBlankTitle,
  titleErrorMessage,
  toPostFormErrors,
} from "@/lib/posts/post-messages";
import { NETWORK_MESSAGE, SERVER_MESSAGE } from "@/lib/request-error-messages";

/** Object.prototype から継承したキー。辞書を素朴に引くと文言ではない値が返る */
const PROTOTYPE_KEYS = ["toString", "constructor", "__proto__"];

const unprocessable = (errors: unknown) => new ApiError(422, { errors });

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
  describe("422", () => {
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

    it("画面に無い欄のエラーはフォーム上部に出す（何も表示されない状態を作らない）", () => {
      expect(toPostFormErrors(unprocessable({ user: ["must_exist"] }))).toEqual({
        image: null,
        title: null,
        form: { kind: "message", message: UNKNOWN_FIELD_MESSAGE },
      });
    });

    it("JSON の __proto__ キーも画面に無い欄として扱う", () => {
      const errors: unknown = JSON.parse('{"__proto__": ["x"]}');
      expect(toPostFormErrors(unprocessable(errors)).form).toEqual({
        kind: "message",
        message: UNKNOWN_FIELD_MESSAGE,
      });
    });

    it("画面にある欄と無い欄が混ざっていたら、両方出す", () => {
      expect(toPostFormErrors(unprocessable({ image: ["image_missing"], user: ["x"] }))).toEqual({
        image: "画像を選んでください",
        title: null,
        form: { kind: "message", message: UNKNOWN_FIELD_MESSAGE },
      });
    });

    it.each([
      ["errors が空", new ApiError(422, { errors: {} })],
      ["errors がオブジェクトでない", new ApiError(422, { errors: "invalid" })],
      ["errors が無い", new ApiError(422, { error: "something" })],
      ["本文が JSON でない", new ApiError(422, "<html>")],
    ])("%s ときはフォーム上部に出す", (_label, error) => {
      const result = toPostFormErrors(error);
      expect(result.image).toBeNull();
      expect(result.title).toBeNull();
      expect(result.form).toEqual({ kind: "message", message: expect.any(String) });
    });
  });

  it("502 image_upload_failed は画像の保存に失敗した文言", () => {
    expect(toPostFormErrors(new ApiError(502, { error: "image_upload_failed" }))).toEqual({
      image: null,
      title: null,
      form: { kind: "message", message: UPLOAD_FAILED_MESSAGE },
    });
  });

  it("それ以外の 502（Render のプロキシの HTML など）はサーバーエラー", () => {
    expect(toPostFormErrors(new ApiError(502, "<html>")).form).toEqual({
      kind: "message",
      message: SERVER_MESSAGE,
    });
  });

  it("401 は失効（文言はトーストで出すので、ここでは種類だけ返す）", () => {
    expect(toPostFormErrors(new ApiError(401, { error: "unauthorized" })).form).toEqual({
      kind: "session_expired",
    });
  });

  it("timeout は「投稿されている場合がある」を出すための種類を返す", () => {
    expect(toPostFormErrors(new ApiTimeoutError(120_000)).form).toEqual({ kind: "timeout" });
    expect(POST_TIMEOUT_MESSAGE).toContain("投稿が完了している場合があります");
  });

  it("通信断は通信エラーの文言", () => {
    expect(toPostFormErrors(new TypeError("Failed to fetch")).form).toEqual({
      kind: "message",
      message: NETWORK_MESSAGE,
    });
  });

  it("500 はサーバーエラー", () => {
    expect(toPostFormErrors(new ApiError(500, null)).form).toEqual({
      kind: "message",
      message: SERVER_MESSAGE,
    });
  });

  it("その他の 4xx はステータスを添えた汎用の文言", () => {
    expect(toPostFormErrors(new ApiError(404, null)).form).toEqual({
      kind: "message",
      message: "操作を完了できませんでした（404）",
    });
  });
});
