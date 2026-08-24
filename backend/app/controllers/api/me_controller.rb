module Api
  # ログイン中のユーザー自身のデータ。マイページ（7-6）の 4 タブとヘッダーを賄う。
  # 判定と絞り込みはモデルのスコープに寄せ、ここは HTTP の入出力だけを扱う。
  class MeController < ApplicationController
    include AttemptRendering
    include Paginating

    before_action :authenticate_user!

    # 「いま誰でログインしているか」と、マイページのヘッダーに出す統計。
    def show
      render json: UserSerializer.private_profile_with_stats(current_user)
    end

    def posts
      posts = current_user.posts.for_listing.recent.page(page_param)
      # 一覧ぶんのお気に入り済み判定を 1 クエリでまとめて引く（1 件ずつ引くと N+1 になる）。
      # 自分のお題もお気に入りできる（5-2）ので、ここは実際に引く必要がある。
      favorited_ids = Favorite.favorited_post_ids(current_user, posts.map(&:id))

      render json: {
        posts: posts.map { |post| PostSerializer.call(post, favorited: favorited_ids.include?(post.id)) },
        meta: PaginationSerializer.call(posts)
      }
    end

    def attempts = render_attempts(Attempt.listing_for_user(current_user, status: :published))

    private

    def render_attempts(relation)
      attempts = relation.page(page_param)
      # 一覧ぶんのいいね済み判定を 1 クエリでまとめて引く（1 件ずつ引くと N+1 になる）。
      #
      # 自分の挑戦にはいいねできない（5-1）ので実質いつも空集合が返るが、false を
      # 直接埋めない。それは別 issue のルールに寄りかかった推論で、5-5 でいいねの
      # 可視化を検討するときに黙って嘘になる（設計書参照）。
      liked_ids = Like.liked_attempt_ids(current_user, attempts.map(&:id))

      render json: {
        attempts: attempts.map { |attempt| my_attempt_json(attempt, liked_ids) },
        meta: PaginationSerializer.call(attempts)
      }
    end

    # マイページの挑戦カードは「どのお題への挑戦か」が要る。AttemptSerializer は変えず、
    # 呼び出し側で最小サマリを足す（お題詳細の挑戦一覧では post が自明なので付けない）。
    def my_attempt_json(attempt, liked_ids)
      attempt_list_json(attempt, liked_ids).merge(post: PostSummarySerializer.call(attempt.post))
    end
  end
end
