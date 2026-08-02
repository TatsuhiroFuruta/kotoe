require "rails_helper"

RSpec.describe GenerateImageJob do
  describe "#perform" do
    it "ダミー画像を上げて published にする" do
      attempt = create(:attempt, :generating)

      described_class.perform_now(attempt.id)

      attempt.reload
      expect(attempt.status).to eq("published")
      expect(attempt.generated_image_public_id).to eq("kotoe/test/generated/stubbed")
    end

    # 4-3 で本物の生成APIに差し替えたとき、お題画像のフォルダに書き込んでいないことを
    # ここで担保しておく。
    it "生成画像のフォルダ（kind: :generated）に上げる" do
      allow(Images::Uploader).to receive(:call).and_return("kotoe/test/generated/x")

      described_class.perform_now(create(:attempt, :generating).id)

      expect(Images::Uploader).to have_received(:call).with(anything, kind: :generated)
    end

    # 入口の1行で冪等性を担保する。generating の attempt しか掴まないので、
    # 以下はすべて「何もせず終わる」。
    it "削除済みの挑戦には何もしない" do
      attempt = create(:attempt, :generating)
      attempt.discard!

      expect { described_class.perform_now(attempt.id) }
        .not_to change { attempt.reload.status }
    end

    it "すでに published の挑戦には何もしない（二重実行）" do
      attempt = create(:attempt, :published)

      expect { described_class.perform_now(attempt.id) }
        .not_to change { attempt.reload.generated_image_public_id }
    end

    it "draft の挑戦には何もしない" do
      attempt = create(:attempt)

      expect { described_class.perform_now(attempt.id) }
        .not_to change { attempt.reload.status }
    end

    it "存在しない id でも落ちない" do
      expect { described_class.perform_now(0) }.not_to raise_error
    end
  end

  describe "キュー" do
    it "default キューに積まれる" do
      expect { described_class.perform_later(1) }
        .to have_enqueued_job(described_class).on_queue("default")
    end
  end
end
