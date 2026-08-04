require "rails_helper"

RSpec.describe Images::Generator do
  def stub_provider_env(value)
    allow(ENV).to receive(:fetch).and_call_original
    allow(ENV).to receive(:fetch).with("KOTOE_IMAGE_PROVIDER").and_return(value)
  end

  describe ".provider_name" do
    # 実費を払うのは本番だけ。ローカル・CI・E2E はダミーで回る。
    it "既定は dummy（test 環境）" do
      expect(described_class.provider_name).to eq("dummy")
    end

    it "production の既定は openai" do
      allow(Rails).to receive(:env).and_return(ActiveSupport::StringInquirer.new("production"))

      expect(described_class.provider_name).to eq("openai")
    end

    # プロンプトを調整するときにローカルで本物を試せるようにしておく。
    it "KOTOE_IMAGE_PROVIDER で上書きできる" do
      stub_provider_env("openai")

      expect(described_class.provider_name).to eq("openai")
    end
  end

  describe ".call" do
    it "既定ではダミーに委譲する" do
      expect(described_class.call("空の絵", &:read)).to eq(File.binread(Images::Generators::Dummy::IMAGE_PATH))
    end

    it "openai を指定すると Openai に委譲する" do
      stub_provider_env("openai")
      allow(Images::Generators::Openai).to receive(:call).and_return("kotoe/test/generated/x")

      expect(described_class.call("空の絵")).to eq("kotoe/test/generated/x")
      expect(Images::Generators::Openai).to have_received(:call).with("空の絵")
    end

    # 設定ミスで黙ってダミーが本番に出ると、全ユーザーに同じ画像が配られて
    # しかも枠は消費される。気づけるように落とす。
    it "知らないプロバイダ名は起動時ではなく呼び出しで落とす" do
      stub_provider_env("midjourney")

      expect { described_class.call("空の絵") { nil } }.to raise_error(ArgumentError, /midjourney/)
    end
  end
end
