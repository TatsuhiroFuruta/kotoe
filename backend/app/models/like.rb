class Like < ApplicationRecord
  belongs_to :user
  belongs_to :attempt

  validates :user_id, uniqueness: { scope: :attempt_id }

  # 表示する挑戦のうち、そのユーザーがいいね済みのものを id の Set で返す。
  # 一覧で 1 件ずつ exists? を呼ぶと N+1 になるため、id 集合に対して 1 クエリで引く。
  # 未ログイン（user が nil）は常に空集合＝すべて false。
  def self.liked_attempt_ids(user, attempt_ids)
    return Set.new if user.nil? || attempt_ids.empty?

    where(user: user, attempt_id: attempt_ids).pluck(:attempt_id).to_set
  end
end
