require "rails_helper"

RSpec.describe PingJob do
  describe "#perform" do
    it "受け取ったメッセージをログに出す" do
      allow(Rails.logger).to receive(:info)

      described_class.perform_now("hello")

      expect(Rails.logger).to have_received(:info).with("[PingJob] hello")
    end

    it "引数を省略すると pong を出す" do
      allow(Rails.logger).to receive(:info)

      described_class.perform_now

      expect(Rails.logger).to have_received(:info).with("[PingJob] pong")
    end
  end

  describe "キュー" do
    it "default キューに積まれる" do
      expect { described_class.perform_later("hi") }
        .to have_enqueued_job(described_class).on_queue("default")
    end
  end
end
