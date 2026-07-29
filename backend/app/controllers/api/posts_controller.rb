module Api
  # お題（Post）の CRUD。絞り込み・集計の判定はモデル（Post.listing）に、
  # JSON の形はシリアライザに寄せ、ここは HTTP の入出力だけを扱う。
  class PostsController < ApplicationController
    def index
      posts = Post.listing(q: params[:q], sort: params[:sort]).page(params[:page])

      render json: {
        posts: posts.map { |post| PostSerializer.call(post) },
        meta: PaginationSerializer.call(posts)
      }
    end
  end
end
