class Attempt < ApplicationRecord
  include Discard::Model

  belongs_to :post
  belongs_to :user
  has_many :likes, dependent: :destroy
  has_many :reports, dependent: :restrict_with_exception

  enum :status, { draft: "draft", generating: "generating", published: "published", failed: "failed" }

  validates :description, presence: true
  validates :status, presence: true

  # いいね数。Post と同じ理由（discard を counter cache が検知できない）で
  # SELECT 句の相関サブクエリにする。
  scope :with_likes_count, -> {
    select("attempts.*", "(#{likes_count_sql}) AS likes_count")
  }

  # 同着の順序を一意に定める（Post.recent と同じ理由）。
  scope :recent, -> { order(created_at: :desc, id: :desc) }

  # お題詳細に出す挑戦の組み立て口。他人の下書きを見せないのがここの要点。
  def self.listing_for(post)
    kept.published.where(post: post).includes(:user).with_likes_count.recent
  end

  def self.likes_count_sql
    Like.where("likes.attempt_id = attempts.id").select("COUNT(*)").to_sql
  end
end
