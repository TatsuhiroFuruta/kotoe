require "rails_helper"

RSpec.describe Attempts::Generation do
  let(:user) { create(:user) }
  let(:attempt) { create(:attempt, user: user) }

  describe ".call" do
    it "draft を generating にして生成ジョブを積む" do
      expect { described_class.call(attempt) }
        .to have_enqueued_job(GenerateImageJob).with(attempt.id)

      attempt.reload
      expect(attempt.status).to eq("generating")
      expect(attempt.generated_at).to be_present
    end

    it "成功したら error_code が nil の Result を返す" do
      result = described_class.call(attempt)

      expect(result).to be_ok
      expect(result.error_code).to be_nil
    end

    # 二重送信（ボタン連打・2タブ）。どちらのリクエストも「まだ draft」の状態を読んでから
    # ロックに入るため、draft の判定をロックの外に置いたままだと 2 本目も通ってしまい、
    # 同じ attempt に対してジョブが 2 本積まれる（枠は 1 回しか減っていないのに、
    # 4-3 以降は実費の生成が 2 回走り、先に上がった画像は参照されないまま残る）。
    it "同じ下書きへの二重の generate は 2 本目を弾く" do
      first = Attempt.find(attempt.id)
      second = Attempt.find(attempt.id)

      described_class.call(first)

      result = nil
      expect { result = described_class.call(second) }
        .not_to have_enqueued_job(GenerateImageJob)
      expect(result.error_code).to eq("attempt_not_draft")
    end

    it "draft でなければ何もせず attempt_not_draft を返す" do
      published = create(:attempt, :published, user: user)

      result = nil
      expect { result = described_class.call(published) }
        .not_to have_enqueued_job(GenerateImageJob)

      expect(result.error_code).to eq("attempt_not_draft")
      expect(published.reload.status).to eq("published")
    end
  end

  describe "1日の上限" do
    # 上限に達するまで枠を使った状態を作る。generated_at が入っていることが
    # 「枠を消費した」という意味なので、status は問わない。
    def consume(count, user: self.user, at: Time.current)
      create_list(:attempt, count, user: user, status: "published", generated_at: at)
    end

    it "既定は 3 回" do
      expect(described_class.daily_limit).to eq(3)
    end

    it "上限に達すると generation_limit_reached を返し、何も起きない" do
      consume(3)

      result = nil
      expect { result = described_class.call(attempt) }
        .not_to have_enqueued_job(GenerateImageJob)

      expect(result.error_code).to eq("generation_limit_reached")
      expect(result.limit).to eq(3)
      expect(attempt.reload.status).to eq("draft")
      expect(attempt.generated_at).to be_nil
    end

    it "上限の 1 つ手前なら通る" do
      consume(2)

      expect(described_class.call(attempt)).to be_ok
    end

    # 削除しても回数は戻さない（無限リトライ防止とコスト対策）。
    it "削除済みの生成も回数に数える" do
      consume(3).each(&:discard!)

      expect(described_class.call(attempt).error_code).to eq("generation_limit_reached")
    end

    it "他人の生成は数えない" do
      consume(3, user: create(:user))

      expect(described_class.call(attempt)).to be_ok
    end

    it "生成していない下書きは数えない" do
      create_list(:attempt, 3, user: user)

      expect(described_class.call(attempt)).to be_ok
    end

    it "KOTOE_DAILY_GENERATION_LIMIT で上書きできる" do
      stub_limit_env("1")
      consume(1)

      expect(described_class.call(attempt).error_code).to eq("generation_limit_reached")
    end

    # Render のダッシュボードで環境変数を「空にして無効化する」のはよくある操作だが、
    # "".to_i は 0 なので、そのまま使うと全ユーザーの生成が黙って止まる。しかも
    # 応答は枠を使い切ったときと同じ 422 なので、原因の切り分けができない。
    it "空文字や数値でない値は既定値に落とす" do
      stub_limit_env("")
      expect(described_class.daily_limit).to eq(3)

      stub_limit_env("abc")
      expect(described_class.daily_limit).to eq(3)

      stub_limit_env("0")
      expect(described_class.daily_limit).to eq(3)
    end

    def stub_limit_env(value)
      allow(ENV).to receive(:fetch).and_call_original
      allow(ENV).to receive(:fetch).with("KOTOE_DAILY_GENERATION_LIMIT", 3).and_return(value)
    end
  end

  describe "日付の境界" do
    # 「1日」は JST の暦日（config.time_zone = "Asia/Tokyo"）。
    # 2026-08-02 12:00 JST を「今」として、前日 23:59 と当日 0:00 の扱いを固定する。
    let(:now) { Time.zone.local(2026, 8, 2, 12, 0, 0) }

    around do |example|
      travel_to(now) { example.run }
    end

    it "前日 23:59 JST の生成は数えない" do
      create_list(:attempt, 3, user: user, generated_at: Time.zone.local(2026, 8, 1, 23, 59, 59))

      expect(described_class.call(attempt)).to be_ok
    end

    it "当日 0:00 JST の生成は数える" do
      create_list(:attempt, 3, user: user, generated_at: Time.zone.local(2026, 8, 2, 0, 0, 0))

      expect(described_class.call(attempt).error_code).to eq("generation_limit_reached")
    end
  end

  # 4-1 の設計（docs/superpowers/specs/2026-07-31-issue-4-1-solid-queue-design.md の
  # 「トランザクションの一体性」）が実際に効いていることを見る。ジョブテーブルが
  # アプリと同じ DB に同居しているため、ロールバックすればジョブ行も一緒に消える。
  # test アダプタは enqueue を配列に積むだけで DB と連動しないので、ここだけ
  # solid_queue アダプタに差し替える（spec/jobs/solid_queue_spec.rb と同じ手）。
  describe "トランザクションの一体性" do
    around do |example|
      original = ActiveJob::Base.queue_adapter
      ActiveJob::Base.queue_adapter = :solid_queue
      example.run
      ActiveJob::Base.queue_adapter = original
    end

    it "enqueue した後にロールバックするとジョブ行も残らない" do
      allow(GenerateImageJob).to receive(:perform_later).and_wrap_original do |original, *args|
        original.call(*args)
        raise ActiveRecord::Rollback
      end

      expect { described_class.call(attempt) }.not_to change(SolidQueue::Job, :count)
      expect(attempt.reload.status).to eq("draft")
    end
  end
end
