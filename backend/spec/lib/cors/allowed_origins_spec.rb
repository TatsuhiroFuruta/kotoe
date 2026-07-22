require "rails_helper"

RSpec.describe Cors::AllowedOrigins do
  describe "#allow?" do
    context "完全一致リストのみ" do
      subject(:allowed) do
        described_class.new(origins: [ "http://localhost:3001", "https://kotoe.example.com" ])
      end

      it "リストに含まれるオリジンを許可する" do
        expect(allowed.allow?("http://localhost:3001")).to be true
        expect(allowed.allow?("https://kotoe.example.com")).to be true
      end

      it "リストにないオリジンを拒否する" do
        expect(allowed.allow?("https://evil.example.com")).to be false
      end

      it "スキームやポートが違えば拒否する" do
        expect(allowed.allow?("https://localhost:3001")).to be false
        expect(allowed.allow?("http://localhost:3000")).to be false
      end

      it "nil や空文字を拒否する" do
        expect(allowed.allow?(nil)).to be false
        expect(allowed.allow?("")).to be false
      end
    end

    context "設定値の正規化" do
      it "前後の空白と末尾のスラッシュを取り除いて比較する" do
        allowed = described_class.new(origins: [ "  https://kotoe.example.com/  " ])

        expect(allowed.allow?("https://kotoe.example.com")).to be true
      end

      it "空の要素を無視する" do
        allowed = described_class.new(origins: [ "", "  ", "https://kotoe.example.com" ])

        expect(allowed.allow?("")).to be false
        expect(allowed.allow?("https://kotoe.example.com")).to be true
      end
    end

    context "正規表現つき" do
      subject(:allowed) do
        described_class.new(
          origins: [ "https://kotoe.example.com" ],
          pattern: "https://kotoe-[a-z0-9-]+-kotoe-team\\.vercel\\.app"
        )
      end

      it "パターンに一致するプレビューURLを許可する" do
        expect(allowed.allow?("https://kotoe-git-feature-x-kotoe-team.vercel.app")).to be true
      end

      it "完全一致リストの側も引き続き許可する" do
        expect(allowed.allow?("https://kotoe.example.com")).to be true
      end

      it "チーム slug が違うプロジェクトを拒否する" do
        expect(allowed.allow?("https://kotoe-evil.vercel.app")).to be false
        expect(allowed.allow?("https://kotoe-evil-other-team.vercel.app")).to be false
      end
    end

    context "正規表現のアンカー" do
      # \A \z は実装側で付けるため、設定値に書かなくても部分一致で通り抜けない。
      subject(:allowed) do
        described_class.new(origins: [], pattern: "https://kotoe\\.example\\.com")
      end

      it "末尾に文字列を足したオリジンを拒否する" do
        expect(allowed.allow?("https://kotoe.example.com.evil.test")).to be false
      end

      it "先頭に文字列を足したオリジンを拒否する" do
        expect(allowed.allow?("https://evil.test/https://kotoe.example.com")).to be false
      end

      it "改行を挟んだオリジンを拒否する" do
        expect(allowed.allow?("https://evil.test\nhttps://kotoe.example.com")).to be false
      end

      it "ちょうど一致するオリジンは許可する" do
        expect(allowed.allow?("https://kotoe.example.com")).to be true
      end
    end

    context "正規表現がトップレベルの | を含む場合" do
      # | は Ruby の正規表現で最も優先順位が低い。\A#{pattern}\z のように
      # 括らずにアンカーを付けると、\A は最初のブランチにしか、\z は最後の
      # ブランチにしかかからない。その場合、最初のブランチに一致する接頭辞を
      # 持ちつつ末尾に任意の文字列を足したオリジン（攻撃者が取得できるドメイン）
      # が通ってしまう。非捕獲グループで括ってアンカーを両ブランチにかけることで防ぐ。
      subject(:allowed) do
        described_class.new(
          origins: [],
          pattern: "https://kotoe-[a-z0-9-]+-team\\.vercel\\.app|https://staging\\.kotoe\\.example\\.com"
        )
      end

      it "両方のブランチを許可する" do
        expect(allowed.allow?("https://kotoe-abc-team.vercel.app")).to be true
        expect(allowed.allow?("https://staging.kotoe.example.com")).to be true
      end

      it "最初のブランチの末尾に文字列を足した攻撃者ドメインを拒否する" do
        expect(allowed.allow?("https://kotoe-abc-team.vercel.app.attacker.test")).to be false
      end

      it "2番目のブランチの末尾に文字列を足したオリジンを拒否する" do
        expect(allowed.allow?("https://staging.kotoe.example.com.attacker.test")).to be false
      end
    end

    context "pattern が未設定" do
      it "空文字なら完全一致のみで判定する" do
        allowed = described_class.new(origins: [ "https://kotoe.example.com" ], pattern: "")

        expect(allowed.allow?("https://kotoe.example.com")).to be true
        expect(allowed.allow?("https://kotoe-git-x-kotoe-team.vercel.app")).to be false
      end

      it "nil なら完全一致のみで判定する" do
        allowed = described_class.new(origins: [ "https://kotoe.example.com" ], pattern: nil)

        expect(allowed.allow?("https://kotoe-git-x-kotoe-team.vercel.app")).to be false
      end
    end

    context "設定が空" do
      it "何も許可しない" do
        allowed = described_class.new(origins: [], pattern: nil)

        expect(allowed.allow?("https://kotoe.example.com")).to be false
      end
    end
  end

  describe "#configured?" do
    it "完全一致リストのみ設定されていれば true を返す" do
      allowed = described_class.new(origins: [ "https://kotoe.example.com" ], pattern: nil)

      expect(allowed.configured?).to be true
    end

    it "正規表現のみ設定されていれば true を返す" do
      allowed = described_class.new(origins: [], pattern: "https://kotoe\\.example\\.com")

      expect(allowed.configured?).to be true
    end

    it "両方設定されていれば true を返す" do
      allowed = described_class.new(
        origins: [ "https://kotoe.example.com" ],
        pattern: "https://staging\\.kotoe\\.example\\.com"
      )

      expect(allowed.configured?).to be true
    end

    it "どちらも設定されていなければ false を返す" do
      allowed = described_class.new(origins: [], pattern: nil)

      expect(allowed.configured?).to be false
    end
  end

  describe ".new" do
    it "不正な正規表現なら RegexpError を投げる" do
      expect {
        described_class.new(origins: [], pattern: "https://kotoe-[")
      }.to raise_error(RegexpError)
    end
  end

  describe ".from_env" do
    it "カンマ区切りのリストと正規表現を読み取る" do
      allowed = described_class.from_env(
        "CORS_ALLOWED_ORIGINS" => "http://localhost:3001, https://kotoe.example.com",
        "CORS_ALLOWED_ORIGIN_REGEX" => "https://kotoe-[a-z0-9-]+-kotoe-team\\.vercel\\.app"
      )

      expect(allowed.allow?("http://localhost:3001")).to be true
      expect(allowed.allow?("https://kotoe.example.com")).to be true
      expect(allowed.allow?("https://kotoe-git-x-kotoe-team.vercel.app")).to be true
      expect(allowed.allow?("https://evil.example.com")).to be false
    end

    it "環境変数が未設定なら何も許可しない" do
      allowed = described_class.from_env({})

      expect(allowed.allow?("http://localhost:3001")).to be false
    end
  end

  describe ".current" do
    # .current はメモ化されており、リセットしないとテストコンテナの実 ENV から
    # 組み立てたインスタンスがスイートの以降のテストに残り続けてしまう。
    after { described_class.instance_variable_set(:@current, nil) }

    it "ENV から組み立てたインスタンスを返す" do
      expect(described_class.current).to be_a(described_class)
    end

    it "同じインスタンスを返す（メモ化）" do
      expect(described_class.current).to equal(described_class.current)
    end
  end
end
