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

  # 一覧で返すお題の読み込み方。listing（お題一覧）とマイページの各一覧が共有する。
  scope :for_listing, -> { kept.includes(:user).with_counts }

  # マイページのお気に入り一覧。並びは「お気に入りした順」なので favorites 側の時刻で
  # 並べる（お題の新着順にすると、古いお題を今お気に入りしても奥に埋もれる）。
  # 同着は id でタイブレークしてページ間の重複・抜けを防ぐ（recent と同じ理由）。
  #
  # kept で絞るのは、5-2 が削除済みお題への解除を 404 にしているため。出すと、
  # 解除ボタンが必ず 404 を返す行が画面に出る（設計書参照）。
  #
  # joins を足しても total_count は壊れない。favorites の (user_id, post_id) が
  # 複合ユニークなので、1 つのお題が 2 行に増えることがなく distinct は要らない。
  scope :favorited_by, ->(user) {
    for_listing.joins(:favorites).where(favorites: { user_id: user.id })
               .order(Favorite.arel_table[:created_at].desc, Favorite.arel_table[:id].desc)
  }

  # 一覧の組み立て口。コントローラはこれだけを呼ぶ。
  #
  # search_by_title を先頭に置いている。ransack は受け取った関係から Post.all を
  # 組み直す（現在のスコープは scoping 経由で引き継がれる）ので、実は後ろに置いても
  # 同じ SQL になる。それでも先頭に固定するのは、その引き継ぎの挙動に依存せずに
  # 読めるようにするため。
  def self.listing(q: nil, sort: nil)
    relation = search_by_title(q).for_listing

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
