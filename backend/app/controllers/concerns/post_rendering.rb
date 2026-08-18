# お題を JSON にする手順の共有。PostsController / AttemptsController / FavoritesController が使う。
module PostRendering
  extend ActiveSupport::Concern

  private

  # PostSerializer は with_counts が SELECT 句で付ける別名属性に依存している。
  # 新規作成直後やお気に入りの増減後のレコードには乗っていないので、そのスコープ経由で取り直す。
  # 0 を直接埋めないのは、シリアライザの前提を1か所でも崩すと後で気づけなくなるため。
  #
  # kept で絞るのは、ここが「お題を1件返す」共通の入口になるため。現在の呼び出し元は
  # すべて手前で絞っているが、絞らない呼び出し元が増えると、他のすべての経路が 404 を
  # 返す削除済みのお題を、ここだけ 200 で返してしまう。
  def post_json(post)
    fresh = Post.kept.includes(:user).with_counts.find(post.id)
    PostSerializer.call(fresh, favorited: favorited?(fresh))
  end

  # 単体のお題に対する判定。一覧は Favorite.favorited_post_ids を直接呼んで 1 クエリにまとめる。
  def favorited?(post)
    Favorite.favorited_post_ids(current_user, [ post.id ]).include?(post.id)
  end
end
