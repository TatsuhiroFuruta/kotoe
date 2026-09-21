import { describe, expect, it } from "vitest";

import { parseAllowedDevHosts } from "@/lib/dev/allowed-dev-hosts";

describe("parseAllowedDevHosts", () => {
  // 未設定なら next.config.ts 側が allowedDevOrigins ごと省く。
  // 他の開発者・CI・本番の挙動を現状から変えないための入口。
  it("未設定・空文字・空白のみなら空配列を返す", () => {
    expect(parseAllowedDevHosts(undefined)).toEqual([]);
    expect(parseAllowedDevHosts("")).toEqual([]);
    expect(parseAllowedDevHosts("   ")).toEqual([]);
  });

  it("ホスト名はそのまま通す", () => {
    expect(parseAllowedDevHosts("192.168.1.10")).toEqual(["192.168.1.10"]);
    expect(parseAllowedDevHosts("my-mac.local")).toEqual(["my-mac.local"]);
  });

  // ここが本題。Next はホスト名としか比較しないので、オリジン形式のまま渡すと
  // 無言で効かない。隣に書く NEXT_PUBLIC_API_BASE_URL からコピペしても動くようにする。
  it("オリジン形式で書かれてもホスト名だけを取り出す", () => {
    expect(parseAllowedDevHosts("http://192.168.1.10:3001")).toEqual(["192.168.1.10"]);
    expect(parseAllowedDevHosts("https://my-mac.local")).toEqual(["my-mac.local"]);
  });

  // "my-mac.local:3001" は URL パーサに素で渡すと "my-mac.local:" がスキーム扱いになり、
  // hostname が空文字になる。スキームを補ってから解析する必要がある。
  it("host:port で書かれてもホスト名だけを取り出す", () => {
    expect(parseAllowedDevHosts("192.168.1.10:3001")).toEqual(["192.168.1.10"]);
    expect(parseAllowedDevHosts("my-mac.local:3001")).toEqual(["my-mac.local"]);
  });

  // Next 側（csrf-protection.js の isCsrfOriginAllowed）がドット区切りの
  // ワイルドカードを解釈する。正規化で壊さないこと。
  it("ワイルドカードを壊さない", () => {
    expect(parseAllowedDevHosts("192.168.*.*")).toEqual(["192.168.*.*"]);
  });

  it("大文字のホスト名は小文字化する", () => {
    expect(parseAllowedDevHosts("My-Mac.local")).toEqual(["my-mac.local"]);
  });

  it("カンマ区切りで複数指定でき、空要素は捨てる", () => {
    expect(parseAllowedDevHosts("192.168.1.10, my-mac.local")).toEqual([
      "192.168.1.10",
      "my-mac.local",
    ]);
    expect(parseAllowedDevHosts("192.168.1.10,,my-mac.local,")).toEqual([
      "192.168.1.10",
      "my-mac.local",
    ]);
  });

  // 黙って捨てると「設定したのに無反応」に戻る。dev 専用の設定なので落として気づかせる。
  it("解釈できない値は例外にする（メッセージに元の値を含む）", () => {
    expect(() => parseAllowedDevHosts("not a host")).toThrow(/not a host/);
  });
});
