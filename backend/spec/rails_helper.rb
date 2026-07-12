# Rails を読み込む spec 用のヘルパ。model / request / job spec はこれを require する。
require "spec_helper"
# docker compose が RAILS_ENV=development を渡してくるため、`||=` では上書きされない。
# spec は必ず test 環境（別DB）で走らせる。開発DBを壊さないための強制。
ENV["RAILS_ENV"] = "test"
require_relative "../config/environment"

# 本番の DB をテストで壊さないためのガード。
abort("The Rails environment is running in production mode!") if Rails.env.production?

require "rspec/rails"

# spec/support 配下のヘルパ（共有 example やカスタムマッチャ）を読み込む。
Rails.root.glob("spec/support/**/*.rb").sort_by(&:to_s).each { |f| require f }

# 未適用のマイグレーションがあれば、テスト用 DB のスキーマを作り直す。
begin
  ActiveRecord::Migration.maintain_test_schema!
rescue ActiveRecord::PendingMigrationError => e
  abort e.to_s.strip
end

RSpec.configure do |config|
  # FactoryBot を `FactoryBot.create` ではなく `create` で呼べるようにする。
  config.include FactoryBot::Syntax::Methods

  # 各 example をトランザクションで囲み、終了時にロールバックする。
  config.use_transactional_fixtures = true

  # spec の置き場所（spec/models、spec/requests など）から type を推測する。
  config.infer_spec_type_from_file_location!

  # バックトレースから Rails の gem 内のフレームを取り除く。
  config.filter_rails_from_backtrace!
end
