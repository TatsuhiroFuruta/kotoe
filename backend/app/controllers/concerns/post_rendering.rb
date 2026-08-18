# お題を JSON にする手順の共有。PostsController / AttemptsController / FavoritesController が使う。
module PostRendering
  extend ActiveSupport::Concern

  private

  # PostSerializer は with_counts が SELECT 句で付ける別名属性に依存している。
  # 新規作成直後やお気に入りの増減後のレコードには乗っていないので、そのスコープ経由で取り直す。
  # 0 を直接埋めないのは、シリアライザの前提を1か所でも崩すと後で気づけなくなるため。
  def post_json(post)
    fresh = Post.includes(:user).with_counts.find(post.id)
    PostSerializer.call(fresh, favorited: favorited?(fresh))
  end

  # 単体のお題に対する判定。一覧は Favorite.favorited_post_ids を直接呼んで 1 クエリにまとめる。
  def favorited?(post)
    Favorite.favorited_post_ids(current_user, [ post.id ]).include?(post.id)
  end
end
