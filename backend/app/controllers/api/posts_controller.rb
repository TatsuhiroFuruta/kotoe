module Api
  # お題（Post）の CRUD。絞り込み・集計の判定はモデル（Post.listing）に、
  # JSON の形はシリアライザに寄せ、ここは HTTP の入出力だけを扱う。
  class PostsController < ApplicationController
    include AttemptRendering
    include PostRendering
    include Paginating

    # title が文字列でも nil でもない（配列・ハッシュ）とき。to_s された値を保存させない。
    class InvalidTitle < StandardError; end

    before_action :authenticate_user!, only: %i[create update destroy]

    # 既定の 400 は Rails の PublicExceptions が返し、Accept が JSON のときしか JSON にならない。
    # apiFetch は Accept を付けない（ブラウザ既定の */*）ので、ここで JSON に揃える。
    # ApplicationController 全体にしないのは、devise のコントローラにも波及しうるため。
    rescue_from ActionController::ParameterMissing do
      render json: { error: "parameter_missing" }, status: :bad_request
    end

    rescue_from InvalidTitle do
      render json: { error: "parameter_invalid" }, status: :bad_request
    end

    def index
      posts = Post.listing(q: params[:q], sort: params[:sort]).page(page_param)
      # 一覧ぶんのお気に入り済み判定を 1 クエリでまとめて引く（1 件ずつ引くと N+1 になる）。
      # 未ログインなら空集合が返り、すべて false になる。
      favorited_ids = Favorite.favorited_post_ids(current_user, posts.map(&:id))

      render json: {
        posts: posts.map { |post| PostSerializer.call(post, favorited: favorited_ids.include?(post.id)) },
        meta: PaginationSerializer.call(posts)
      }
    end

    def create
      attributes = post_attributes
      image = attributes[:image]
      post = current_user.posts.new(title: attributes[:title])

      errors = collect_errors(post, Images::Validation.call(image))
      return render json: { errors: errors }, status: :unprocessable_content if errors.any?

      post.image_public_id = Images::Uploader.call(image, kind: :post)
      post.save!

      # 新規レコードには with_counts の別名属性が乗っていないため、
      # post_json が取り直してから表現を組み立てる（一覧と同じ形になる）。
      render json: { post: post_json(post) }, status: :created
    rescue Images::Uploader::UploadError
      render json: { error: "image_upload_failed" }, status: :bad_gateway
    end

    def show
      post = Post.kept.includes(:user).with_counts.find(params[:id])
      attempts = Attempt.listing_for(post, sort: params[:sort]).page(page_param)
      best_attempts = Attempt.best_for(post)
      # 一覧ぶんのいいね済み判定を 1 クエリでまとめて引く（1 件ずつ引くと N+1 になる）。
      # 表彰台と一覧は同じ挑戦を含みうるので、id を束ねて 1 回だけ引く。
      # 未ログインなら空集合が返り、すべて false になる。
      liked_ids = Like.liked_attempt_ids(current_user, attempts.map(&:id) | best_attempts.map(&:id))

      render json: {
        post: PostSerializer.call(post, favorited: favorited?(post)),
        # 表彰台は sort / page によらず常にいいね上位。一覧とは別のセクションなので、
        # 同じ挑戦が両方に現れる。一覧から除くと kaminari の total_count と OFFSET が
        # ずれ、ページ境界で重複・抜けが出る（設計書参照）。
        best_attempts: best_attempts.map { |attempt| attempt_list_json(attempt, liked_ids) },
        attempts: attempts.map { |attempt| attempt_list_json(attempt, liked_ids) },
        meta: PaginationSerializer.call(attempts)
      }
    end

    # 変えられるのは title だけ。image_public_id などは title_param しか通さないので、
    # 余計なキーを送られても書き換わらない。
    def update
      # destroy と同じく current_user.posts に限定し、他人・削除済み・存在しない ID は 404 にする。
      post = current_user.posts.kept.find(params[:id])

      if post.update(title: title_param)
        render json: { post: post_json(post) }
      else
        render_validation_errors(post)
      end
    end

    def destroy
      # current_user.posts に限定することで、所有チェックの書き忘れが起こりようがない。
      # 他人のお題・存在しない ID・削除済みは、すべて RecordNotFound → 404 になる。
      # 403 と分けないのは、お題自体が一覧・詳細で公開されており隠せる情報が無いため。
      current_user.posts.kept.find(params[:id]).discard!
      head :no_content
    end

    private

    # params[:post] の型はクライアントが決められる。スカラー（post=foo）や
    # 配列（post[]=foo）を送られても 500 にせず、通常の検証エラー（422）として扱う。
    #
    # respond_to?(:dig) では足りない。Array も dig に応答するため素通りし、
    # ["foo"][:title] が TypeError になる。受け取ってよい型だけを名指しする。
    def post_attributes
      params[:post].is_a?(ActionController::Parameters) ? params[:post] : {}
    end

    # title キーの有無を見て値を返す。nil / 空文字は「無題にする」という正当な指定なので、
    # params.require（nil・空文字を missing として弾く）は使えない。
    # キー自体が無い（post が無い・ハッシュでない場合も含む）ときは 400 parameter_missing。
    # 値が配列・ハッシュのときは、そのまま update に渡すと to_s された文字列が保存されるので
    # 400 parameter_invalid にする。
    def title_param
      attributes = post_attributes
      raise ActionController::ParameterMissing, :title unless attributes.key?(:title)

      title = attributes[:title]
      raise InvalidTitle unless title.nil? || title.is_a?(String)

      title
    end

    # 画像とタイトルのエラーをまとめて返す。片方ずつ返すと往復が増えるうえ、
    # 先にアップロードしてからタイトルの検証エラーに気づくと、誰からも参照されない
    # 画像が Cloudinary に残る。
    #
    # 形は { field => [code] }。Api::Auth::RegistrationsController と揃えてある。
    def collect_errors(post, validation)
      post.valid?

      # 「見る項目」ではなく「除く項目」を挙げる。image_public_id はアップロード後に
      # 入るのでこの段階では必ずエラーになるが、それ以外は素通しする。
      # title だけを拾う書き方にすると、Post にバリデーションが増えたときに
      # 黙って落ち、アップロード後の save! が 500 になって参照されない画像が
      # Cloudinary に残る（この順序で検証している目的そのものが崩れる）。
      errors = post.errors.details.except(:image_public_id)
                   .transform_values { |details| details.pluck(:error) }

      errors[:image] = [ validation.error_code ] unless validation.valid?
      errors
    end
  end
end
