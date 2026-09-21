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

  // URL パーサは全部が数字のホストを IPv4 として「正規化」する。"192.168.1" は
  // 拒否されず "192.168.0.1" に書き換えられるので、前方一致のつもりで書いた値が
  // 黙って別のホストになる。これはこの関数が消そうとしている失敗そのもの。
  it("書き換えられてしまう数値ホストは例外にする", () => {
    expect(() => parseAllowedDevHosts("192.168.1")).toThrow(/192\.168\.1/);
    expect(() => parseAllowedDevHosts("0x7f.1")).toThrow(/0x7f\.1/);
    expect(() => parseAllowedDevHosts("0177.0.0.1")).toThrow(/0177\.0\.0\.1/);
    expect(() => parseAllowedDevHosts("2130706433")).toThrow(/2130706433/);
    expect(() => parseAllowedDevHosts("192.168.1.010")).toThrow(/192\.168\.1\.010/);
  });

  // Next 側の matchWildcardDomain は 1 セグメントだけの "*" / "**" を明示的に拒否する
  // （ドメイン全体にマッチさせないため）。パーサは通してしまうので、ここで落とす。
  // 通してしまうと「設定したのに一致しない」がこの 1 ケースだけ残る。
  it("単独のワイルドカードは、Next 側で決して一致しないので例外にする", () => {
    expect(() => parseAllowedDevHosts("*")).toThrow(/\*/);
    expect(() => parseAllowedDevHosts("**")).toThrow(/\*/);
    // セグメントが 2 つ以上あるものは通す（Next 側も解釈する）。
    expect(parseAllowedDevHosts("*.local")).toEqual(["*.local"]);
  });
});
