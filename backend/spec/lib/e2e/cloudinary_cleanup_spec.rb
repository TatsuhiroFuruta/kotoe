require "rails_helper"

RSpec.describe E2e::CloudinaryCleanup do
  before { allow(Cloudinary::Api).to receive(:delete_resources_by_prefix) }

  it "kotoe/e2e/ で始まる接頭辞の画像を消す（末尾に / を付けて run-10 を巻き込まない）" do
    allow(Cloudinary::Api).to receive(:delete_resources_by_prefix)
      .and_return({ "deleted" => { "kotoe/e2e/run-1/a" => "deleted", "kotoe/e2e/run-1/b" => "deleted" } })

    expect(described_class.call("kotoe/e2e/run-1")).to eq 2
    expect(Cloudinary::Api).to have_received(:delete_resources_by_prefix)
      .with("kotoe/e2e/run-1/", resource_type: "image").once
  end

  it "消えていないもの（not_found）は件数に数えない" do
    allow(Cloudinary::Api).to receive(:delete_resources_by_prefix)
      .and_return({ "deleted" => { "kotoe/e2e/run-1/a" => "deleted", "kotoe/e2e/run-1/b" => "not_found" } })

    expect(described_class.call("kotoe/e2e/run-1")).to eq 1
  end

  it "kotoe/e2e/ 以外の接頭辞では何も消さずに ArgumentError" do
    [ "kotoe/production", "kotoe/e2e", "kotoe/e2e/", "", nil, "kotoe/e2e/../production",
      "kotoe/e2e/a/b", "kotoe/e2e/run-1/", "kotoe/e2e/run 1" ].each do |prefix|
      expect { described_class.call(prefix) }.to raise_error(ArgumentError), "#{prefix.inspect} が通った"
    end
    expect(Cloudinary::Api).not_to have_received(:delete_resources_by_prefix)
  end

  # 2 つの定数はわざと独立させている（削除の範囲がアップロードの規則に連動して広がらないように）。
  # 実際に使う保存先（CI・run-local.sh・compose の既定値）が、上げる側と消す側の両方で通ることを確かめる。
  it "実際に使う保存先の形は、アップロード側と後片付け側の両方で受け付ける" do
    [ "kotoe/e2e/ci-123456-1", "kotoe/e2e/local-1731050000", "kotoe/e2e/manual" ].each do |folder|
      expect(folder).to match(Images::Uploader::E2E_FOLDER), "アップロード側が #{folder} を受け付けない"
      expect(folder).to match(described_class::ALLOWED_PREFIX), "後片付け側が #{folder} を受け付けない"
    end
  end

  it "応答が partial（次ページあり）なら next_cursor を渡して繰り返し、合計件数を返す" do
    allow(Cloudinary::Api).to receive(:delete_resources_by_prefix).and_return(
      { "deleted" => { "a" => "deleted", "b" => "deleted" }, "partial" => true, "next_cursor" => "cur1" },
      { "deleted" => { "c" => "deleted" } }
    )

    expect(described_class.call("kotoe/e2e/run-1")).to eq 3
    expect(Cloudinary::Api).to have_received(:delete_resources_by_prefix)
      .with("kotoe/e2e/run-1/", resource_type: "image").once
    expect(Cloudinary::Api).to have_received(:delete_resources_by_prefix)
      .with("kotoe/e2e/run-1/", resource_type: "image", next_cursor: "cur1").once
  end
end
