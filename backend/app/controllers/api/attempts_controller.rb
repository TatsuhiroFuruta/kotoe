module Api
  # 挑戦（Attempt）。生成の可否や回数の判定は Attempts::Generation に、JSON の形は
  # シリアライザに寄せ、ここは HTTP の入出力だけを扱う。
  class AttemptsController < ApplicationController
    before_action :authenticate_user!

    def create
      # 削除済み・存在しないお題は RecordNotFound → 404。
      post = Post.kept.find(params[:post_id])
      attempt = current_user.attempts.new(post: post, description: attempt_attributes[:description])

      return render_validation_errors(attempt) unless attempt.save

      render json: { attempt: attempt_json(attempt) }, status: :created
    end

    def update
      attempt = owned_attempt
      return render_error("attempt_not_draft") unless attempt.draft?

      attempt.description = attempt_attributes[:description]
      return render_validation_errors(attempt) unless attempt.save

      render json: { attempt: attempt_json(attempt) }
    end

    private

    # current_user.attempts に限定することで、所有チェックの書き忘れが起こりようがない。
    # 他人の挑戦・存在しない ID・削除済みは、すべて RecordNotFound → 404 になる。
    def owned_attempt
      current_user.attempts.kept.find(params[:id])
    end

    # params[:attempt] の型はクライアントが決められる。attempt=foo のようなスカラーを
    # 送られても dig で TypeError にせず、通常の検証エラー（422）として扱う。
    def attempt_attributes
      params[:attempt].respond_to?(:dig) ? params[:attempt] : {}
    end

    # AttemptSerializer は with_likes_count が SELECT 句で付ける別名属性に依存している。
    # 新規・更新直後のレコードには乗っていないので、そのスコープ経由で取り直す。
    # 0 を直接埋めないのは、シリアライザの前提を1か所でも崩すと後で気づけなくなるため。
    def attempt_json(attempt)
      AttemptSerializer.call(Attempt.includes(:user).with_likes_count.find(attempt.id))
    end

    def render_validation_errors(attempt)
      errors = attempt.errors.details.transform_values { |details| details.pluck(:error) }
      render json: { errors: errors }, status: :unprocessable_content
    end

    def render_error(code, extra = {})
      render json: { error: code }.merge(extra), status: :unprocessable_content
    end
  end
end
