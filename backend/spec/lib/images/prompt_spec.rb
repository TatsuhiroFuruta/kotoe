require "rails_helper"

RSpec.describe Images::Prompt do
  describe ".call" do
    it "接頭辞のあとに描写文をそのまま置く" do
      expect(described_class.call("青い空と白い雲")).to eq("#{described_class::PREFIX}\n青い空と白い雲")
    end

    it "描写文を書き換えない" do
      expect(described_class.call("赤い車。文字は無い。")).to end_with("赤い車。文字は無い。")
    end

    # 素の描写文をそのまま投げると画像内への文字の描き込みや勝手なイラスト調への
    # 寄せが混ざり、「描写の忠実さを競う」という評価軸がブレる。
    it "描写にない要素を足さないよう指示する" do
      expect(described_class.call("空")).to include("描写に書かれていない要素を足さないこと")
    end

    it "文字を描き込まないよう指示する" do
      expect(described_class.call("空")).to include("文字・透かし・枠は描き込まないこと")
    end
  end
end
