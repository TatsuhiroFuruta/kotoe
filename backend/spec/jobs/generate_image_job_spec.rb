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

  describe "失敗の扱い" do
    # Cloudinary の一時障害（UploadError）とコードのバグ（それ以外）を別々に扱う。
    # 宣言順（rescue_from を先、retry_on を後）が壊れると UploadError も
    # StandardError 側に吸われて 1 回目で failed になるため、その順序をここで固定する。
    it "UploadError の 1 回目は failed にせずリトライする" do
      attempt = create(:attempt, :generating)
      allow(Images::Uploader).to receive(:call).and_raise(Images::Uploader::UploadError)

      expect { described_class.perform_now(attempt.id) }
        .to have_enqueued_job(described_class)
      expect(attempt.reload.status).to eq("generating")
    end

    it "UploadError を使い切ると failed になる" do
      attempt = create(:attempt, :generating)
      allow(Images::Uploader).to receive(:call).and_raise(Images::Uploader::UploadError)

      perform_enqueued_jobs { described_class.perform_later(attempt.id) }

      expect(attempt.reload.status).to eq("failed")
    end

    # Images::Uploader は StandardError をすべて UploadError に包む（秘密情報を漏らさない
    # ため、元例外のクラス名だけを message に残す）。したがって本番の CLOUDINARY_URL の
    # 設定漏れのような「直さないと永久に失敗し続ける」障害もここに来る。attempt_id しか
    # 記録しないと、全ユーザーが枠を溶かしているのにログから原因が分からない。
    it "UploadError を使い切ったとき、原因をログに残す" do
      attempt = create(:attempt, :generating)
      allow(Images::Uploader).to receive(:call)
        .and_raise(Images::Uploader::UploadError, "Cloudinary upload failed: Cloudinary::Api::AuthorizationRequired")
      allow(Rails.logger).to receive(:warn)

      perform_enqueued_jobs { described_class.perform_later(attempt.id) }

      expect(Rails.logger).to have_received(:warn)
        .with(/attempt_id=#{attempt.id}.*Cloudinary::Api::AuthorizationRequired/)
    end

    # コードのバグは failed にしたうえで再送出する。ユーザーは失敗を見られ、
    # 開発者は solid_queue_failed_executions にエラーが残る。
    it "想定外の例外は failed にしてから再送出する" do
      attempt = create(:attempt, :generating)
      allow(Images::Uploader).to receive(:call).and_raise(ArgumentError, "boom")

      expect { described_class.perform_now(attempt.id) }.to raise_error(ArgumentError)
      expect(attempt.reload.status).to eq("failed")
    end

    it "生成枠は failed でも戻さない" do
      attempt = create(:attempt, :generating)
      allow(Images::Uploader).to receive(:call).and_raise(ArgumentError, "boom")

      expect { described_class.perform_now(attempt.id) }.to raise_error(ArgumentError)
      expect(attempt.reload.generated_at).to be_present
    end
  end

  describe "キュー" do
    it "default キューに積まれる" do
      expect { described_class.perform_later(1) }
        .to have_enqueued_job(described_class).on_queue("default")
    end
  end
end
