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

    it "描写文から組み立てたプロンプトで生成する" do
      attempt = create(:attempt, :generating, description: "夕暮れの交差点")
      allow(Images::Generator).to receive(:call).and_return("kotoe/test/generated/x")

      described_class.perform_now(attempt.id)

      expect(Images::Generator).to have_received(:call).with(Images::Prompt.call("夕暮れの交差点"))
    end
  end

  describe "失敗の扱い" do
    # Cloudinary の一時障害（UploadError）とコードのバグ（それ以外）を別々に扱う。
    # 宣言順（rescue_from を先、retry_on を後）が壊れると UploadError も
    # StandardError 側に吸われて 1 回目で failed になるため、その順序をここで固定する。
    # 生成とアップロードは同じジョブの中にある。ジョブごと再実行すると OpenAI の生成まで
    # やり直され、同じ 1 枠に対して実費が 3 倍かかる。画像はもう手元にあるので、
    # アップロードだけを再試行する。
    it "UploadError はジョブを再実行せず、アップロードだけを再試行する" do
      stub_const("#{described_class}::UPLOAD_RETRY_WAIT", 0)
      attempt = create(:attempt, :generating)
      allow(Images::Uploader).to receive(:call).and_raise(Images::Uploader::UploadError)

      expect { described_class.perform_now(attempt.id) }
        .not_to have_enqueued_job(described_class)

      expect(Images::Uploader).to have_received(:call).exactly(3).times
    end

    # 「1 枠 ＝ 1 生成」はコストガードの前提（アプリ 50 枚/日 ＝ 月額最悪 $16.5 が
    # 前払いクレジット $20 を下回る）。ここが増幅すると穏やかなガードより先に残高が尽きる。
    it "Cloudinary が何度失敗しても生成は 1 回しか走らない" do
      stub_const("#{described_class}::UPLOAD_RETRY_WAIT", 0)
      attempt = create(:attempt, :generating)
      generations = 0
      allow(Images::Generator).to receive(:call) do |_prompt, &block|
        generations += 1
        block.call(StringIO.new("x"))
      end
      allow(Images::Uploader).to receive(:call).and_raise(Images::Uploader::UploadError)

      described_class.perform_now(attempt.id)

      expect(generations).to eq(1)
      expect(attempt.reload.status).to eq("failed")
    end

    it "UploadError を使い切ると failed になる" do
      stub_const("#{described_class}::UPLOAD_RETRY_WAIT", 0)
      attempt = create(:attempt, :generating)
      allow(Images::Uploader).to receive(:call).and_raise(Images::Uploader::UploadError)

      described_class.perform_now(attempt.id)

      expect(attempt.reload.status).to eq("failed")
    end

    # Images::Uploader は StandardError をすべて UploadError に包む（秘密情報を漏らさない
    # ため、元例外のクラス名だけを message に残す）。したがって本番の CLOUDINARY_URL の
    # 設定漏れのような「直さないと永久に失敗し続ける」障害もここに来る。attempt_id しか
    # 記録しないと、全ユーザーが枠を溶かしているのにログから原因が分からない。
    it "UploadError を使い切ったとき、原因をログに残す" do
      stub_const("#{described_class}::UPLOAD_RETRY_WAIT", 0)
      attempt = create(:attempt, :generating)
      allow(Images::Uploader).to receive(:call)
        .and_raise(Images::Uploader::UploadError, "Cloudinary upload failed: Cloudinary::Api::AuthorizationRequired")
      allow(Rails.logger).to receive(:warn)

      described_class.perform_now(attempt.id)

      # 再試行したことと、最終的に諦めたことの両方が追えるようにする。
      expect(Rails.logger).to have_received(:warn)
        .with(/再試行します attempt_id=#{attempt.id} try=\d+ .*Cloudinary::Api::AuthorizationRequired/)
        .twice
      expect(Rails.logger).to have_received(:warn)
        .with(/失敗しました attempt_id=#{attempt.id}.*Cloudinary::Api::AuthorizationRequired/)
        .once
    end

    # コードのバグは failed にしたうえで再送出する。ユーザーは失敗を見られ、
    # 開発者は solid_queue_failed_executions にエラーが残る。
    it "想定外の例外は failed にしてから再送出する" do
      attempt = create(:attempt, :generating)
      allow(Images::Uploader).to receive(:call).and_raise(ArgumentError, "boom")

      expect { described_class.perform_now(attempt.id) }.to raise_error(ArgumentError)
      expect(attempt.reload.status).to eq("failed")
    end

    # 同じ描写文なら必ずまた弾かれるので、リトライせずその場で終端にする。
    it "PermanentError はリトライせず failed にして理由を残す" do
      attempt = create(:attempt, :generating)
      allow(Images::Generator).to receive(:call)
        .and_raise(Images::Generator::PermanentError.new("content_policy"))

      expect { described_class.perform_now(attempt.id) }
        .not_to have_enqueued_job(described_class)

      attempt.reload
      expect(attempt.status).to eq("failed")
      expect(attempt.failure_reason).to eq("content_policy")
    end

    it "PermanentError の原因をログに残す" do
      attempt = create(:attempt, :generating)
      allow(Images::Generator).to receive(:call)
        .and_raise(Images::Generator::PermanentError.new("api_error", detail: "status=401"))
      allow(Rails.logger).to receive(:warn)

      described_class.perform_now(attempt.id)

      expect(Rails.logger).to have_received(:warn).with(/attempt_id=#{attempt.id}.*status=401/)
    end

    it "TransientError の 1 回目は failed にせずリトライする" do
      attempt = create(:attempt, :generating)
      allow(Images::Generator).to receive(:call)
        .and_raise(Images::Generator::TransientError.new("rate_limited"))

      expect { described_class.perform_now(attempt.id) }
        .to have_enqueued_job(described_class)
      expect(attempt.reload.status).to eq("generating")
    end

    # 回数を 2 にとどめるのはコストの理由。タイムアウトは「API が課金対象の生成を
    # 終えたのに待ちきれなかった」場合を含み、リトライすると同じ1枠に二重課金になる。
    it "TransientError を使い切ると failed になり理由が残る" do
      attempt = create(:attempt, :generating)
      allow(Images::Generator).to receive(:call)
        .and_raise(Images::Generator::TransientError.new("rate_limited"))

      perform_enqueued_jobs { described_class.perform_later(attempt.id) }

      attempt.reload
      expect(attempt.status).to eq("failed")
      expect(attempt.failure_reason).to eq("rate_limited")
    end

    it "UploadError を使い切ると failure_reason は upload_failed" do
      stub_const("#{described_class}::UPLOAD_RETRY_WAIT", 0)
      attempt = create(:attempt, :generating)
      allow(Images::Uploader).to receive(:call).and_raise(Images::Uploader::UploadError)

      described_class.perform_now(attempt.id)

      expect(attempt.reload.failure_reason).to eq("upload_failed")
    end

    it "想定外の例外の failure_reason は internal_error" do
      attempt = create(:attempt, :generating)
      allow(Images::Uploader).to receive(:call).and_raise(ArgumentError, "boom")

      expect { described_class.perform_now(attempt.id) }.to raise_error(ArgumentError)
      expect(attempt.reload.failure_reason).to eq("internal_error")
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
