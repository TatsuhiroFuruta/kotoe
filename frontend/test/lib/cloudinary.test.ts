import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cloudinaryDownloadUrl,
  cloudinaryDownloadUrlOrNull,
  cloudinaryUrl,
  cloudinaryUrlOrNull,
  postImageUrlOrNull,
} from "@/lib/cloudinary";

const OPTIONS = { width: 640, aspect: "4:3" } as const;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "demo");
});

afterEach(() => {
  vi.unstubAllEnvs();
  // console.error の差し替えを戻す。テストの末尾で mockRestore() を呼ぶ書き方だと、
  // 途中の expect が失敗した時点でそこまで到達せず、後続のテストまで
  // console.error が黙ったままになる。afterEach は失敗しても必ず走る。
  vi.restoreAllMocks();
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

  it("aspect を省くと切り抜かず、幅×幅の正方形に縦横比を保って収める（c_fit）", () => {
    // お題の元画像は描写の対象そのもの。4:3 に切り抜くと描写すべき部分が見えなくなる。
    // 高さも上限を持たせるのは、縦に極端に長い画像を実寸のまま転送しないため。
    expect(cloudinaryUrl("a/b", { width: 1280 })).toBe(
      "https://res.cloudinary.com/demo/image/upload/c_fit,w_1280,h_1280,f_auto,q_auto/a/b",
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

  it("aspect を省いた指定もそのまま cloudinaryUrl に渡す", () => {
    expect(cloudinaryUrlOrNull("a/b", { width: 1280 })).toBe(
      "https://res.cloudinary.com/demo/image/upload/c_fit,w_1280,h_1280,f_auto,q_auto/a/b",
    );
  });

  it.each(["", "a/../b"])(
    "組み立てられない public_id %j では例外にせず null を返し、原因を console.error に残す",
    (publicId) => {
      // 描画中に例外が出ると、error boundary が無いのでヘッダーごとアプリが落ちる。
      // 1 件の不正なデータで残りの 11 件まで見られなくしない。
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(cloudinaryUrlOrNull(publicId, OPTIONS)).toBeNull();
      expect(consoleError).toHaveBeenCalledTimes(1);
    },
  );

  it("cloud name が未設定でも null を返す（本番ビルドは next.config が先に止める）", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "");
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(cloudinaryUrlOrNull("a/b", OPTIONS)).toBeNull();
  });
});

describe("cloudinaryDownloadUrl", () => {
  const DOWNLOAD = { filename: "kotoe-attempt-12" } as const;

  it("原寸の PNG を添付ファイルとして返す URL を組み立てる", () => {
    // 生成画像は WebP で保存している（4-3）。.webp のまま落とすと macOS のプレビューで
    // 開けない環境があるので f_png、ブラウザに表示させず保存させるので fl_attachment。
    expect(cloudinaryDownloadUrl("kotoe/production/attempts/abc", DOWNLOAD)).toBe(
      "https://res.cloudinary.com/demo/image/upload/f_png,fl_attachment:kotoe-attempt-12/kotoe/production/attempts/abc",
    );
  });

  it("縮小・切り抜きの変換を含めない（ダウンロードは原寸）", () => {
    const transformation = new URL(cloudinaryDownloadUrl("a/b", DOWNLOAD)).pathname.split("/")[4];

    expect(transformation).toBe("f_png,fl_attachment:kotoe-attempt-12");
  });

  it.each(["", "a,b", "a/b", "a:b", "a b", "..", "日本語", "a.png"])(
    "保存名 %j は受け付けない（変換文字列の区切りを混ぜさせない）",
    (filename) => {
      expect(() => cloudinaryDownloadUrl("a/b", { filename })).toThrow();
    },
  );

  it.each(["", "/a", "a//b", "a/../b"])(
    "public_id %j は cloudinaryUrl と同じく受け付けない",
    (publicId) => {
      expect(() => cloudinaryDownloadUrl(publicId, DOWNLOAD)).toThrow();
    },
  );

  it("public_id にどんな文字列が来てもオリジンは res.cloudinary.com に固定される", () => {
    // href に入る値なので、javascript: や別オリジンになってはいけない（CLAUDE.md の XSS）。
    for (const publicId of ["javascript:alert(1)", "data:text/html,x", "@evil.example"]) {
      expect(new URL(cloudinaryDownloadUrl(publicId, DOWNLOAD)).origin).toBe(
        "https://res.cloudinary.com",
      );
    }
  });

  it("cloud name が未設定なら例外を投げる", () => {
    vi.stubEnv("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME", "");

    expect(() => cloudinaryDownloadUrl("a/b", DOWNLOAD)).toThrow(
      "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME",
    );
  });
});

describe("cloudinaryDownloadUrlOrNull", () => {
  it("組み立てられるときは cloudinaryDownloadUrl と同じ URL を返す", () => {
    expect(cloudinaryDownloadUrlOrNull("a/b", { filename: "x" })).toBe(
      cloudinaryDownloadUrl("a/b", { filename: "x" }),
    );
  });

  it("組み立てられないときは null を返し、原因を console.error に残す", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(cloudinaryDownloadUrlOrNull("a/../b", { filename: "x" })).toBeNull();
    expect(cloudinaryDownloadUrlOrNull("a/b", { filename: "a,b" })).toBeNull();
    expect(consoleError).toHaveBeenCalledTimes(2);
  });
});

describe("postImageUrlOrNull", () => {
  it("お題の元画像を切り抜かずに 1280 で返す（ヒーローと比較ビューで派生画像を共有する）", () => {
    expect(postImageUrlOrNull("kotoe/production/posts/abc123")).toBe(
      cloudinaryUrl("kotoe/production/posts/abc123", { width: 1280 }),
    );
  });

  it("URL を組み立てられなければ null", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(postImageUrlOrNull("kotoe/../x")).toBeNull();
    // 握り潰さず原因を残す（cloudinaryUrlOrNull と同じ性質）。
    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});
