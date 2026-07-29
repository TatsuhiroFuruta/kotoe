class Post < ApplicationRecord
  include Discard::Model

  belongs_to :user
  has_many :attempts, dependent: :restrict_with_exception
  has_many :favorites, dependent: :destroy

  validates :title, presence: true
  validates :image_public_id, presence: true

  # 一覧・詳細で返す挑戦数といいね合計。
  #
  # counter cache カラムは使えない。discard は discarded_at を立てる UPDATE であって
  # destroy ではないため、counter cache が減らず削除済みを数え続ける。
  # JOIN + GROUP BY も採らない。2 つの集計を同時に取ると直積で件数が壊れ、
  # さらに GROUP BY があると kaminari の総件数カウントと噛み合わない。
  # SELECT 句の相関サブクエリなら 1 クエリで両方取れて、この問題がどちらも起きない。
  scope :with_counts, -> {
    select("posts.*",
           "(#{attempts_count_sql}) AS attempts_count",
           "(#{likes_count_sql}) AS likes_count")
  }

  # 同着で順序が不定になると、ページをまたいで同じレコードが重複したり抜けたりする。
  # id までタイブレークして必ず一意に定める。
  scope :recent, -> { order(created_at: :desc, id: :desc) }

  # likes_count は with_counts が付ける SELECT の別名。単体では使えないので
  # 必ず listing 経由で呼ぶこと（Postgres は SELECT の別名で ORDER BY できる）。
  scope :popular, -> { order(Arel.sql("likes_count DESC")).order(created_at: :desc, id: :desc) }

  # ransack を使うのはここだけ。公開 API のクエリは平らな ?q= に固定してあるため、
  # ransack の述語（title_cont）は外に漏れない。
  scope :search_by_title, ->(query) { query.blank? ? all : ransack(title_cont: query).result }

  # 一覧の組み立て口。コントローラはこれだけを呼ぶ。
  # search_by_title を最初に置くのは、ransack に with_counts の独自 SELECT を
  # 見せないため（ransack は自前で関係を組み直す）。
  def self.listing(q: nil, sort: nil)
    relation = search_by_title(q).kept.includes(:user).with_counts

    sort == "popular" ? relation.popular : relation.recent
  end

  # ransack が触れてよい属性の許可リスト。指定しないと ransack 4 は例外を投げる。
  # title だけに絞り、discarded_at や user_id を条件に使われる余地を残さない。
  def self.ransackable_attributes(_auth_object = nil) = %w[title]
  def self.ransackable_associations(_auth_object = nil) = []

  # 集計条件（kept / published）は Attempt 側のスコープから組み立てる。
  # 生の WHERE を手書きしないので、published の定義が変わってもここが自動で追随する。
  def self.attempts_count_sql
    Attempt.kept.published.where("attempts.post_id = posts.id").select("COUNT(*)").to_sql
  end

  def self.likes_count_sql
    Like.joins(:attempt).merge(Attempt.kept.published)
        .where("attempts.post_id = posts.id").select("COUNT(*)").to_sql
  end
end
