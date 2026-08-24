# 一覧 API の page パラメータの丸め込み。PostsController / MeController が使う。
module Paginating
  extend ActiveSupport::Concern

  # kaminari は OFFSET = 12 * (page - 1) を組み立てるため、巨大な値を渡されると
  # int8 を溢れてアダプタが例外になる。認証不要の一覧が誰でも 500 にできてしまうので
  # 上限を設ける。12 * 100 万件ぶんあれば実用上の到達点より十分に先。
  MAX_PAGE = 1_000_000

  private

  # 数値以外・配列・巨大な値のいずれで来ても 1 ページ目〜上限に収める。
  # 0 以下や数値でない値は kaminari 自身が 1 ページ目に丸めるが、
  # 上限側と「配列を渡されて to_i が無い」ケースはこちらで潰す必要がある。
  def page_param
    params[:page].to_s.to_i.clamp(1, MAX_PAGE)
  end
end
