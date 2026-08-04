class Attempt < ApplicationRecord
  include Discard::Model

  belongs_to :post
  belongs_to :user
  has_many :likes, dependent: :destroy
  has_many :reports, dependent: :restrict_with_exception

  enum :status, { draft: "draft", generating: "generating", published: "published", failed: "failed" }

  # description はそのまま画像生成APIのプロンプトになるため上限を持つ。
  # 丁寧な描写でも 300〜500 文字、書き込むタイプで 800 文字前後という実測に対する余裕。
  # 後から緩めるのは安全（既存データが違反にならない）が、きつくするのは危険。
  MAX_DESCRIPTION_LENGTH = 1_000

  # 生成が失敗した理由。文言ではなくコードを持ち、翻訳はフロントの辞書が担当する。
  #
  # status と違って enum にしない。status は状態機械でスコープに意味があるが、
  # failure_reason は分岐にも一覧にも使わない付随情報で、enum にすると
  # Attempt.api_error のようなスコープが生えて紛らわしくなる。
  # generation_disabled は、ジョブが積まれたあとにキルスイッチが入った場合。
  # API の 503 と同じコードを使う（フロントの辞書を分けずに済む）。
  FAILURE_REASONS = %w[
    content_policy rate_limited api_error upload_failed internal_error generation_disabled
  ].freeze

  validates :description, presence: true, length: { maximum: MAX_DESCRIPTION_LENGTH }
  validates :status, presence: true
  validates :failure_reason, inclusion: { in: FAILURE_REASONS }, allow_nil: true

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
