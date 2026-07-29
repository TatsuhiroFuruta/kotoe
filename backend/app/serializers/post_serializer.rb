# お題 1 件の表現。一覧・詳細・作成の応答で共通に使う。
#
# attempts_count / likes_count は Post.with_counts が SELECT 句で付ける別名属性なので、
# そのスコープを通っていない Post を渡すと ActiveModel::MissingAttributeError になる。
# 0 を既定値にして握りつぶさないのは、with_counts の付け忘れが「黙って 0 が並ぶ一覧」
# として表に出るより、その場で落ちたほうが直せるため。
class PostSerializer
  def self.call(post)
    {
      id: post.id,
      title: post.title,
      image_public_id: post.image_public_id,
      user: UserSerializer.public_profile(post.user),
      attempts_count: post.attempts_count,
      likes_count: post.likes_count,
      created_at: post.created_at.utc.iso8601
    }
  end
end
