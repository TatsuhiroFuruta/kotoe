require "rails_helper"

RSpec.describe Images::Generators::Openai do
  let(:image) { "fake-webp-binary".b }
  let(:success_body) { { data: [ { b64_json: Base64.strict_encode64(image) } ] }.to_json }

  # ENV の差し替えは spec/lib/attempts/generation_spec.rb と同じ手を使う。
  before do
    allow(ENV).to receive(:fetch).and_call_original
    allow(ENV).to receive(:fetch).with("OPENAI_API_KEY").and_return("sk-test")
  end

  def stub_generation(status: 200, body: nil)
    stub_request(:post, "https://api.openai.com/v1/images/generations")
      .to_return(status: status, body: body, headers: { "Content-Type" => "application/json" })
  end

  describe ".call" do
    it "デコードした画像を、先頭から読める File として yield する" do
      stub_generation(body: success_body)

      read = nil
      described_class.call("空の絵") { |file| read = file.read }

      expect(read).to eq(image)
    end

    it "ブロックの戻り値をそのまま返す" do
      stub_generation(body: success_body)

      expect(described_class.call("空の絵") { "kotoe/test/generated/x" }).to eq("kotoe/test/generated/x")
    end

    # ジョブが ensure で後始末する責任を負わずに済むよう、ブロック形式で必ず消す。
    it "ブロックを抜けたら一時ファイルを消す" do
      stub_generation(body: success_body)

      path = described_class.call("空の絵", &:path)

      expect(File.exist?(path)).to be(false)
    end

    # 確定値。勝手に変えるとコストと出力品質が変わる（設計ドキュメント参照）。
    it "モデル・サイズ・品質・出力形式・圧縮率・moderation を指定して送る" do
      stub_generation(body: success_body)

      described_class.call("空の絵") { nil }

      expect(WebMock).to have_requested(:post, "https://api.openai.com/v1/images/generations")
        .with(
          headers: { "Authorization" => "Bearer sk-test", "Content-Type" => "application/json" },
          body: {
            model: "gpt-image-2",
            prompt: "空の絵",
            size: "1024x1024",
            quality: "low",
            output_format: "webp",
            output_compression: 90,
            moderation: "auto",
            n: 1
          }
        )
    end
  end
end
