module Api
  # お題（Post）の CRUD。絞り込み・集計の判定はモデル（Post.listing）に、
  # JSON の形はシリアライザに寄せ、ここは HTTP の入出力だけを扱う。
  class PostsController < ApplicationController
    before_action :authenticate_user!, only: %i[create]

    def index
      posts = Post.listing(q: params[:q], sort: params[:sort]).page(params[:page])

      render json: {
        posts: posts.map { |post| PostSerializer.call(post) },
        meta: PaginationSerializer.call(posts)
      }
    end

    def create
      image = params.dig(:post, :image)
      post = current_user.posts.new(title: params.dig(:post, :title))

      errors = collect_errors(post, Images::Validation.call(image))
      return render json: { errors: errors }, status: :unprocessable_content if errors.any?

      post.image_public_id = Images::Uploader.call(image, kind: :post)
      post.save!

      # 新規レコードには with_counts の別名属性が乗っていないため、
      # 一覧と同じ表現を返せるよう取り直す。
      render json: { post: PostSerializer.call(Post.with_counts.find(post.id)) }, status: :created
    rescue Images::Uploader::UploadError
      render json: { error: "image_upload_failed" }, status: :bad_gateway
    end

    def show
      post = Post.kept.includes(:user).with_counts.find(params[:id])
      attempts = Attempt.listing_for(post).page(params[:page])

      render json: {
        post: PostSerializer.call(post),
        # 挑戦の並びは新着順で固定。いいね順（ベスト再現）は 6-1 で
        # ここに sort の分岐を足す。
        attempts: attempts.map { |attempt| AttemptSerializer.call(attempt) },
        meta: PaginationSerializer.call(attempts)
      }
    end

    private

    # 画像とタイトルのエラーをまとめて返す。片方ずつ返すと往復が増えるうえ、
    # 先にアップロードしてからタイトル未入力に気づくと、誰からも参照されない
    # 画像が Cloudinary に残る。
    #
    # 形は { field => [code] }。Api::Auth::RegistrationsController と揃えてある。
    def collect_errors(post, validation)
      # image_public_id はアップロード後に入るので、ここでは title のエラーだけを見る。
      post.valid?
      title_errors = post.errors.details[:title].pluck(:error)

      errors = {}
      errors[:title] = title_errors if title_errors.any?
      errors[:image] = [ validation.error_code ] unless validation.valid?
      errors
    end
  end
end
