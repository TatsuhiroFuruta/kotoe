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

  # 表彰台（ベスト再現）の枠数。デザイン上の「1位を中央に大きく」は3枠が前提。
  BEST_LIMIT = 3

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

  # likes_count は with_likes_count が SELECT 句で付ける別名。単体では使えないので
  # 必ず listing_for / best_for 経由で呼ぶこと（Post.popular と同じ理由・同じ形）。
  scope :popular, -> { order(Arel.sql("likes_count DESC")).order(created_at: :desc, id: :desc) }

  # お題詳細に出す挑戦の組み立て口。他人の下書きを見せないのがここの要点。
  #
  # 公開クエリの値は "likes"（お題一覧の "popular" と不揃いだが
  # docs/screen_and_api_design.md がそう定義している）。翻訳はここ1か所で行う。
  # 未知の値は Post.listing と同じくエラーにせず新着順に落とす。
  def self.listing_for(post, sort: nil)
    relation = kept.published.where(post: post).includes(:user).with_likes_count

    sort == "likes" ? relation.popular : relation.recent
  end

  # ベスト再現＝いいね順の先頭 BEST_LIMIT 件。定義をここ1か所に閉じることで、
  # best_attempts と attempts?sort=likes の並びが定義上ずれない。
  def self.best_for(post) = listing_for(post, sort: "likes").limit(BEST_LIMIT)

  # マイページの「自分の挑戦」「下書き」の組み立て口。listing_for（お題詳細）と対になる。
  #
  # お題は kept で絞らない。Post#discard は挑戦にカスケードしないので、削除済みお題の
  # 下に自分の挑戦が残る。ここで隠すと片付ける手段（DELETE /api/attempts/:id）に
  # 画面から辿り着けなくなる（4-4 案A の前提）。削除済みかどうかは
  # PostSummarySerializer が discarded として返し、フロントが描き分ける。
  #
  # includes(:post) はカードに出すお題サマリのため、includes(:user) は
  # AttemptSerializer が投稿者を出すため（常に本人なので preload は 1 クエリで済む）。
  def self.listing_for_user(user, status:)
    kept.where(user: user, status: status).includes(:user, :post).with_likes_count.recent
  end

  def self.likes_count_sql
    Like.where("likes.attempt_id = attempts.id").select("COUNT(*)").to_sql
  end
end
