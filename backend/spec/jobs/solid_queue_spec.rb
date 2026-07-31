require "rails_helper"

# Solid Queue のテーブルをアプリと同じデータベースに同居させている
# （docs/superpowers/specs/2026-07-31-issue-4-1-solid-queue-design.md）。
# 同居しているからこそ、この spec は transactional fixtures のロールバックに乗る。
# 別 DB へ移す・マイグレーションを取りこぼす、といった形で前提が崩れたらここで落ちる。
RSpec.describe "Solid Queue" do
  around do |example|
    original = ActiveJob::Base.queue_adapter
    ActiveJob::Base.queue_adapter = :solid_queue
    example.run
    ActiveJob::Base.queue_adapter = original
  end

  it "perform_later でジョブ行が作られる" do
    expect { PingJob.perform_later("hello") }.to change(SolidQueue::Job, :count).by(1)

    job = SolidQueue::Job.last
    expect(job.class_name).to eq("PingJob")
    expect(job.queue_name).to eq("default")
  end

  it "ジョブテーブルがアプリと同じ接続で読める" do
    expect(SolidQueue::Job.connection_db_config.name)
      .to eq(ApplicationRecord.connection_db_config.name)
  end
end
