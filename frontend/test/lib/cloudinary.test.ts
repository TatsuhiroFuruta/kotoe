import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cloudinaryUrl, cloudinaryUrlOrNull } from "@/lib/cloudinary";

const OPTIONS = { width: 640, aspect: "4:3" } as const;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "demo");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cloudinaryUrl", () => {
  it("変換つきの配信 URL を組み立てる", () => {
    expect(cloudinaryUrl("kotoe/production/posts/abc123", OPTIONS)).toBe(
      "https://res.cloudinary.com/demo/image/upload/c_fill,ar_4:3,w_640,f_auto,q_auto/kotoe/production/posts/abc123",
    );
  });

  it("縦横比と幅を変換に反映する", () => {
    expect(cloudinaryUrl("a/b", { width: 320, aspect: "1:1" })).toBe(
      "https://res.cloudinary.com/demo/image/upload/c_fill,ar_1:1,w_320,f_auto,q_auto/a/b",
    );
  });

  it("public_id の / はパスの区切りとして残し、各セグメントの ? # % はエンコードする", () => {
    // ? や # がそのまま残ると、そこから後ろがクエリ／フラグメントになって
    // Cloudinary に届く public_id が変わる。
    expect(cloudinaryUrl("kotoe/x?y#z%", OPTIONS)).toBe(
      "https://res.cloudinary.com/demo/image/upload/c_fill,ar_4:3,w_640,f_auto,q_auto/kotoe/x%3Fy%23z%25",
    );
  });

  it.each(["", "/a", "a/", "a//b", "a/./b", "a/../b", "..", "//evil.example/x", "https://evil.example/x"])(
    "空・. ・.. のセグメントを含む %j は受け付けない",
    (publicId) => {
      // encodeURIComponent は . と .. をそのまま残すので、URL の正規化で
      // パスが上へ辿られてしまう。エンコードでは無害化できないので拒否する。
      expect(() => cloudinaryUrl(publicId, OPTIONS)).toThrow();
    },
  );

  it("public_id にどんな文字列が来てもオリジンは res.cloudinary.com に固定される", () => {
    // src に入る値なので、javascript: や別オリジンになってはいけない（CLAUDE.md の XSS）。
    for (const publicId of ["javascript:alert(1)", "data:text/html,x", "a/b:c", "@evil.example"]) {
      expect(new URL(cloudinaryUrl(publicId, OPTIONS)).origin).toBe("https://res.cloudinary.com");
    }
  });

  it.each([0, -1, 1.5, Number.NaN])("幅 %j は受け付けない", (width) => {
    expect(() => cloudinaryUrl("a/b", { width, aspect: "4:3" })).toThrow();
  });

  it("cloud name が未設定なら例外を投げる（黙って壊れた URL を配らない）", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "");

    expect(() => cloudinaryUrl("a/b", OPTIONS)).toThrow("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME");
  });
});

describe("cloudinaryUrlOrNull", () => {
  it("組み立てられるときは cloudinaryUrl と同じ URL を返す", () => {
    expect(cloudinaryUrlOrNull("a/b", OPTIONS)).toBe(cloudinaryUrl("a/b", OPTIONS));
  });

  it.each(["", "a/../b"])(
    "組み立てられない public_id %j では例外にせず null を返し、原因を console.error に残す",
    (publicId) => {
      // 描画中に例外が出ると、error boundary が無いのでヘッダーごとアプリが落ちる。
      // 1 件の不正なデータで残りの 11 件まで見られなくしない。
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(cloudinaryUrlOrNull(publicId, OPTIONS)).toBeNull();
      expect(consoleError).toHaveBeenCalled();

      consoleError.mockRestore();
    },
  );

  it("cloud name が未設定でも null を返す（本番ビルドは next.config が先に止める）", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(cloudinaryUrlOrNull("a/b", OPTIONS)).toBeNull();

    consoleError.mockRestore();
  });
});
