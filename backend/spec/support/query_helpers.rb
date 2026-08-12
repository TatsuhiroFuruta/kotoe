# 実行された SELECT の本数を数えるヘルパ。N+1 を作り込んでいないことの検査に使う。
# rails_helper が spec/support 配下を自動で読み込む。
#
# 使い方は「件数を変えて 2 回測り、同じであることを見る」。絶対値で固定すると、
# 無関係な最適化やクエリの組み替えのたびに赤くなって意味が薄れる。
module QueryHelpers
  # SCHEMA（カラム情報の取得）と CACHE（クエリキャッシュのヒット）は
  # アプリのクエリではないので数えない。
  def count_select_queries
    count = 0
    counter = lambda do |_name, _start, _finish, _id, payload|
      count += 1 if payload[:sql].start_with?("SELECT") && !%w[SCHEMA CACHE].include?(payload[:name])
    end

    ActiveSupport::Notifications.subscribed(counter, "sql.active_record") { yield }
    count
  end
end

RSpec.configure do |config|
  config.include QueryHelpers, type: :request
end
