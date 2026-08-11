# 挑戦を JSON にする手順の共有。AttemptsController と LikesController が使う。
module AttemptRendering
  extend ActiveSupport::Concern

  private

  # AttemptSerializer は with_likes_count が SELECT 句で付ける別名属性に依存している。
  # 新規・更新直後やいいねの増減後のレコードには乗っていないので、そのスコープ経由で取り直す。
  # 0 を直接埋めないのは、シリアライザの前提を1か所でも崩すと後で気づけなくなるため。
  def attempt_json(attempt)
    fresh = Attempt.includes(:user).with_likes_count.find(attempt.id)
    AttemptSerializer.call(fresh, liked: liked?(fresh))
  end

  # 単体の挑戦に対する判定。一覧は Like.liked_attempt_ids を直接呼んで 1 クエリにまとめる。
  def liked?(attempt)
    Like.liked_attempt_ids(current_user, [ attempt.id ]).include?(attempt.id)
  end
end
