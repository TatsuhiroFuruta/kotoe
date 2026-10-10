import { describe, expect, it } from "vitest";

import {
  ALLOWED_IMAGE_TYPES,
  IMAGE_ACCEPT,
  IMAGE_MAX_BYTES,
  checkImageFile,
} from "@/lib/posts/image-file-check";

const file = (size: number, type: string) => ({ size, type });

describe("checkImageFile", () => {
  it("上限はバックの Images::Validation::MAX_BYTES（5.megabytes）と同じ値", () => {
    expect(IMAGE_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it("5MB ちょうどは通す（バックも「超えたら」弾く）", () => {
    expect(checkImageFile(file(IMAGE_MAX_BYTES, "image/png"))).toBeNull();
  });

  it("1 バイトでも超えたら image_too_large", () => {
    expect(checkImageFile(file(IMAGE_MAX_BYTES + 1, "image/png"))).toBe("image_too_large");
  });

  it.each(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"])(
    "%s は通す",
    (type) => {
      expect(checkImageFile(file(1024, type))).toBeNull();
    },
  );

  it.each(["image/gif", "image/svg+xml", "application/pdf", "text/plain"])(
    "%s は image_type_not_allowed",
    (type) => {
      expect(checkImageFile(file(1024, type))).toBe("image_type_not_allowed");
    },
  );

  it("type が空なら形式は判定しない（Chrome・Firefox は HEIC で空になる。バックに任せる）", () => {
    expect(checkImageFile(file(1024, ""))).toBeNull();
  });

  it("type が application/octet-stream（種類不明）でも形式は判定しない（バックに任せる）", () => {
    expect(checkImageFile(file(1024, "application/octet-stream"))).toBeNull();
  });

  it("type が空でもサイズは判定する", () => {
    expect(checkImageFile(file(IMAGE_MAX_BYTES + 1, ""))).toBe("image_too_large");
  });

  it("サイズと形式の両方が違うときはサイズを返す（バックと同じ順序）", () => {
    expect(checkImageFile(file(IMAGE_MAX_BYTES + 1, "image/gif"))).toBe("image_too_large");
  });

  it("accept の値は許可する形式の一覧と同じ", () => {
    expect(IMAGE_ACCEPT.split(",")).toEqual([...ALLOWED_IMAGE_TYPES]);
  });
});
