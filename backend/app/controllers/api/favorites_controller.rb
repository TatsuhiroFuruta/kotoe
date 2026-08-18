module Api
  # お気に入り（Favorite）。トグルは冪等で、同じリクエストを何度送っても状態が変わらない。
  # POST は「このお題を、自分がお気に入りしている状態にせよ」という意味になる。
  #
  # いいね（5-1）と違い、所有者チェックは無い。お気に入りは公開されず集計もされず
  # 順位にも効かない自分だけのブックマークなので、自分のお題をストックするのは正当な使い方。
  class FavoritesController < ApplicationController
    include IdempotentToggle
    include PostRendering

    before_action :authenticate_user!

    def create
      post = favoritable_post

      toggle_on(current_user.favorites, post: post) do
        render json: { post: post_json(post) }
      end
    end

    private

    # お気に入りできるのは生きているお題だけ。削除済み・存在しない ID は
    # RecordNotFound → 404 になる。お題には published に相当する状態が無いので、
    # 5-1 の likeable_attempt のような二段構えは要らない。
    def favoritable_post
      Post.kept.find(params[:post_id])
    end
  end
end
