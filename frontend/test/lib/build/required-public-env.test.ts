import { describe, expect, it } from "vitest";

import { assertRequiredPublicEnv } from "@/lib/build/required-public-env";

describe("assertRequiredPublicEnv", () => {
  it("cloud name が設定されていれば何もしない", () => {
    expect(() =>
      assertRequiredPublicEnv({ NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: "demo" }),
    ).not.toThrow();
  });

  it.each([undefined, "", "   "])(
    "cloud name が %j ならビルドを止める（描画中に例外になり、アプリ全体が落ちるため）",
    (value) => {
      expect(() =>
        assertRequiredPublicEnv({ NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: value }),
      ).toThrow("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME");
    },
  );
});
