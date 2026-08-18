class Favorite < ApplicationRecord
  belongs_to :user
  belongs_to :post

  validates :user_id, uniqueness: { scope: :post_id }

  # 表示するお題のうち、そのユーザーがお気に入り済みのものを id の Set で返す。
  # 一覧で 1 件ずつ exists? を呼ぶと N+1 になるため、id 集合に対して 1 クエリで引く。
  # 未ログイン（user が nil）は常に空集合＝すべて false。
  def self.favorited_post_ids(user, post_ids)
    return Set.new if user.nil? || post_ids.empty?

    where(user: user, post_id: post_ids).pluck(:post_id).to_set
  end
end
