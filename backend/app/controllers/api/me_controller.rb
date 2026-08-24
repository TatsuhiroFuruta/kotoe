module Api
  # ログイン中のユーザー自身のデータ。マイページ（7-6）の 4 タブとヘッダーを賄う。
  # 判定と絞り込みはモデルのスコープに寄せ、ここは HTTP の入出力だけを扱う。
  class MeController < ApplicationController
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
  end
end
