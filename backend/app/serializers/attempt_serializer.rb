# 挑戦 1 件の表現。お題詳細の挑戦一覧で使う（4-2 以降の挑戦 API でも使い回す）。
#
# likes_count は Attempt.with_likes_count が SELECT 句で付ける別名属性なので、
# そのスコープを通っていない Attempt を渡すと ActiveModel::MissingAttributeError になる。
class AttemptSerializer
  def self.call(attempt)
    {
      id: attempt.id,
      description: attempt.description,
      generated_image_public_id: attempt.generated_image_public_id,
      status: attempt.status,
      failure_reason: attempt.failure_reason,
      similarity_score: attempt.similarity_score,
      user: UserSerializer.public_profile(attempt.user),
      likes_count: attempt.likes_count,
      created_at: attempt.created_at.utc.iso8601
    }
  end
end
