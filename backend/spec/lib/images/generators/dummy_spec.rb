require "rails_helper"

RSpec.describe Images::Generators::Dummy do
  describe ".call" do
    it "ダミー画像を、先頭から読める File として yield する" do
      read = nil
      described_class.call("空の絵") { |file| read = file.read }

      expect(read).to eq(File.binread(described_class::IMAGE_PATH))
    end

    it "ブロックの戻り値をそのまま返す" do
      expect(described_class.call("空の絵") { "kotoe/test/generated/x" }).to eq("kotoe/test/generated/x")
    end

    it "プロンプトの内容にかかわらず同じ画像を返す" do
      first = described_class.call("赤", &:read)
      second = described_class.call("青", &:read)

      expect(first).to eq(second)
    end
  end
end
