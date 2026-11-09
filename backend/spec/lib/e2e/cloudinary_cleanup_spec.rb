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
