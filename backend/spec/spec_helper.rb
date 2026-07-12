# すべての spec で読み込まれる（.rspec の `--require spec_helper`）。
# 起動を軽く保つため、Rails に依存する設定は rails_helper.rb 側に置く。
RSpec.configure do |config|
  config.expect_with :rspec do |expectations|
    expectations.include_chain_clauses_in_custom_matcher_descriptions = true
  end

  config.mock_with :rspec do |mocks|
    # 実在しないメソッドのスタブを禁止する。
    mocks.verify_partial_doubles = true
  end

  config.shared_context_metadata_behavior = :apply_to_host_groups

  # :focus を付けた example だけを走らせる（付いていなければ全件）。
  config.filter_run_when_matching :focus

  # `--only-failures` / `--next-failure` のための実行結果の記録先。
  config.example_status_persistence_file_path = "spec/examples.txt"

  # `describe` などのグローバルなメソッド追加を禁止し、RSpec.describe を強制する。
  config.disable_monkey_patching!

  # 遅い example を上位10件表示する。
  config.profile_examples = 10

  # 実行順をランダムにして、テスト間の順序依存を炙り出す。
  config.order = :random
  Kernel.srand config.seed
end
