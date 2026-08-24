class User < ApplicationRecord
  # 最小構成。パスワードリセット(recoverable)・メール確認(confirmable)は
  # メール送信基盤が要るため MVP では持たない（必要になったら migration で追加する）。
  # validatable が email の形式・一意性と password の長さ（6文字以上）を担保する。
  devise :database_authenticatable, :registerable, :validatable,
         :jwt_authenticatable, jwt_revocation_strategy: JwtDenylist

  has_many :posts, dependent: :restrict_with_exception
  has_many :attempts, dependent: :restrict_with_exception
  has_many :likes, dependent: :destroy
  has_many :favorites, dependent: :destroy
  has_many :reports, foreign_key: :reporter_id, inverse_of: :reporter, dependent: :restrict_with_exception

  validates :name, presence: true

  # マイページのプロフィールヘッダーに出す統計。集計条件は各タブの一覧と揃えてあり、
  # kept_posts_count は GET /api/me/posts、published_attempts_count は
  # GET /api/me/attempts の meta.total_count と一致する（設計書参照）。
  def kept_posts_count = posts.kept.count

  def published_attempts_count = attempts.kept.published.count

  # 自分の挑戦が集めたいいねの総数。お題の削除状態は見ない（得た票は消えないし、
  # me/attempts の母集合と揃える）。集計条件は Attempt のスコープから組み立てるので、
  # published の定義が変わってもここが自動で追随する。
  def likes_received_count
    Like.joins(:attempt).merge(Attempt.kept.published).where(attempts: { user_id: id }).count
  end
end
